"""
Silero TTS микросервис для озвучки кухни (self-hosted, бесплатный).

Основная модель: v4_ru + speaker baya.
Fallback:        v3_1_ru + speaker baya (только если v4_ru не загрузилась/упала).

Сервис ТОЛЬКО синтезирует переданный текст в WAV. Формирование текста
(номер прописью, точки между блюдами, voiceName блюд) — на стороне backend.

Эндпоинты:
  GET  /health        — статус и загруженные модели.
  POST /synthesize    — { text, model?, speaker?, sample_rate? } -> audio/wav.
"""
from __future__ import annotations

import io
import os
import time
import logging
from typing import Optional
from urllib.request import urlretrieve

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("silero-tts")

# ---- Конфигурация ----
MODELS_DIR = os.environ.get("TTS_MODELS_DIR", os.path.join(os.path.dirname(__file__), "models"))
DEFAULT_MODEL = os.environ.get("TTS_MODEL", "v4_ru")          # основная модель
FALLBACK_MODEL = os.environ.get("TTS_FALLBACK_MODEL", "v3_1_ru")
DEFAULT_SPEAKER = os.environ.get("TTS_SPEAKER", "baya")
# 24000 Гц — критично для скорости: на 48000 синтез в ~10x медленнее (дорогой
# вокодер-апсемплинг), а для кухонных колонок качества 24 кГц достаточно.
DEFAULT_SAMPLE_RATE = int(os.environ.get("TTS_SAMPLE_RATE", "24000"))
# Количество потоков CPU для torch — критично для скорости на сервере.
# ВАЖНО: на сервере (Railway/контейнер) os.cpu_count() возвращает число ядер ХОСТА
# (часто 32+), хотя контейнеру выделена доля CPU. Если отдать torch столько потоков —
# начинается жёсткая конкуренция за CPU и синтез замедляется в десятки раз
# (наблюдалось 22–26 c вместо <1 c). Поэтому ограничиваем разумным числом.
_cpu = os.cpu_count() or 2
THREADS = int(os.environ.get("TTS_THREADS", str(min(_cpu, 4))))

# Разрешённые русские модели. v5* намеренно НЕ поддерживаются (см. ТЗ).
MODEL_URLS = {
    "v4_ru": "https://models.silero.ai/models/tts/ru/v4_ru.pt",
    "v3_1_ru": "https://models.silero.ai/models/tts/ru/v3_1_ru.pt",
}

torch.set_num_threads(THREADS)
DEVICE = torch.device("cpu")

_models: dict[str, torch.nn.Module] = {}

# Один постоянный поток для всего синтеза. torch инициализируется лениво ПО ПОТОКАМ,
# поэтому прогрев и запросы должны идти на одном и том же потоке — иначе первый
# реальный запрос снова холодный (~5 c). Заодно синтез строго последовательный.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tts")


def _ensure_model_file(name: str) -> str:
    os.makedirs(MODELS_DIR, exist_ok=True)
    path = os.path.join(MODELS_DIR, f"{name}.pt")
    if not os.path.exists(path):
        url = MODEL_URLS[name]
        log.info("Скачивание модели %s из %s ...", name, url)
        urlretrieve(url, path)
        log.info("Модель %s сохранена в %s", name, path)
    return path


def _load_model(name: str) -> torch.nn.Module:
    if name in _models:
        return _models[name]
    if name not in MODEL_URLS:
        raise ValueError(f"Неподдерживаемая модель: {name}")
    path = _ensure_model_file(name)
    t0 = time.time()
    model = torch.package.PackageImporter(path).load_pickle("tts_models", "model")
    model.to(DEVICE)
    _models[name] = model
    log.info("Модель %s загружена за %.2f c", name, time.time() - t0)
    return model


def _synthesize(text: str, model_name: str, speaker: str, sample_rate: int) -> bytes:
    model = _load_model(model_name)
    audio = model.apply_tts(text=text, speaker=speaker, sample_rate=sample_rate)
    # audio — это 1D torch.Tensor float32 в диапазоне [-1, 1].
    import soundfile as sf

    buf = io.BytesIO()
    sf.write(buf, audio.numpy(), sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def _synthesize_with_fallback(text: str, primary: str, speaker: str, sample_rate: int) -> tuple[bytes, str, float]:
    """Основная модель → при ошибке fallback (v3_1_ru). Возвращает (wav, модель, секунды)."""
    t0 = time.time()
    try:
        return _synthesize(text, primary, speaker, sample_rate), primary, time.time() - t0
    except Exception as exc:  # noqa: BLE001
        log.error("Модель %s упала: %s. Fallback → %s.", primary, exc, FALLBACK_MODEL)
        wav = _synthesize(text, FALLBACK_MODEL, speaker, sample_rate)
        return wav, FALLBACK_MODEL, time.time() - t0


class SynthRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    model: Optional[str] = None
    speaker: Optional[str] = None
    sample_rate: Optional[int] = None


@asynccontextmanager
async def lifespan(_app: "FastAPI"):
    """Прогрев на ТОМ ЖЕ постоянном потоке-исполнителе, где пойдут запросы."""
    loop = asyncio.get_event_loop()
    # torch кэширует примитивы за ~2 первых синтеза — греем НЕСКОЛЬКИМИ текстами
    # разной длины, чтобы первый РЕАЛЬНЫЙ заказ был уже быстрым (<1 c), а не холодным.
    warmups = [
        "Новый заказ. Номер пятьдесят четыре. Состав заказа: борщ. салат. котлета. суп. чай.",
        "Новый заказ. Номер сто двадцать три. Состав заказа: лагман. манты. самсы. плов. шашлык. компот.",
        "Заказ номер семьдесят два отменён.",
    ]
    try:
        t0 = time.time()
        for w in warmups:
            await loop.run_in_executor(
                _executor, _synthesize_with_fallback, w, DEFAULT_MODEL, DEFAULT_SPEAKER, DEFAULT_SAMPLE_RATE
            )
        log.info("Прогрев модели %s (%d фраз) завершён за %.2f c.", DEFAULT_MODEL, len(warmups), time.time() - t0)
    except Exception as exc:  # noqa: BLE001
        log.warning("Не удалось прогреть %s: %s", DEFAULT_MODEL, exc)
    yield
    _executor.shutdown(wait=False)


app = FastAPI(title="Silero Kitchen TTS", version="1.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "default_model": DEFAULT_MODEL,
        "fallback_model": FALLBACK_MODEL,
        "speaker": DEFAULT_SPEAKER,
        "loaded": list(_models.keys()),
        "threads": THREADS,
    }


@app.post("/synthesize")
async def synthesize(req: SynthRequest) -> Response:
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Пустой текст")
    speaker = req.speaker or DEFAULT_SPEAKER
    sample_rate = req.sample_rate or DEFAULT_SAMPLE_RATE
    primary = req.model or DEFAULT_MODEL

    loop = asyncio.get_event_loop()
    try:
        wav, used, took = await loop.run_in_executor(
            _executor, _synthesize_with_fallback, text, primary, speaker, sample_rate
        )
    except Exception as exc:  # noqa: BLE001
        log.error("Синтез не удался (включая fallback): %s", exc)
        raise HTTPException(status_code=503, detail="TTS недоступен") from exc

    log.info("Синтез (%s): %.2f c, %d симв., %d байт", used, took, len(text), len(wav))
    return Response(
        content=wav,
        media_type="audio/wav",
        headers={"X-TTS-Model": used, "X-TTS-Seconds": f"{took:.3f}"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8001")))
