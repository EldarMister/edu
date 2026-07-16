"""
Silero TTS микросервис для озвучки кухни (self-hosted, бесплатный).

Основная модель: v5_2_ru + speaker baya.
Fallback:        v4_ru + speaker baya (только если v5_2_ru не загрузилась/упала).

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
import threading
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
DEFAULT_MODEL = os.environ.get("TTS_MODEL", "v5_2_ru")          # основная модель
FALLBACK_MODEL = os.environ.get("TTS_FALLBACK_MODEL", "v4_ru")
DEFAULT_SPEAKER = os.environ.get("TTS_SPEAKER", "baya")
# 24000 Гц — критично для скорости: на 48000 синтез в ~10x медленнее (дорогой
# вокодер-апсемплинг), а для кухонных колонок качества 24 кГц достаточно.
DEFAULT_SAMPLE_RATE = int(os.environ.get("TTS_SAMPLE_RATE", "24000"))
# Количество потоков CPU для torch — критично для скорости на сервере.
# На Railway сервису выделены 8 vCPU, поэтому 8 потоков дают модели всю доступную
# вычислительную мощность. Не используем os.cpu_count(): внутри контейнера он часто
# показывает ядра хоста (32+), а не лимит сервиса; это вызывало конкуренцию потоков
# и синтез по 22–26 секунд вместо <1 секунды.
_cpu = os.cpu_count() or 4
THREADS = int(os.environ.get("TTS_THREADS", str(min(8, _cpu))))
if THREADS < 1:
    raise ValueError("TTS_THREADS должен быть не меньше 1")
# Silero v3/v4 имеют предел длины одного синтеза (~1000 симв.): на длинном тексте
# apply_tts падает или режет фразу. Длинные заказы (много блюд) бьём на куски по
# границам предложений и склеиваем аудио — иначе озвучка таких заказов молчит.
MAX_CHUNK_CHARS = int(os.environ.get("TTS_MAX_CHUNK_CHARS", "800"))
# Пауза между склеенными кусками (сек), чтобы речь не «слипалась».
CHUNK_GAP_SEC = float(os.environ.get("TTS_CHUNK_GAP_SEC", "0.25"))

# Разрешённые русские модели: v5_2_ru как основная, v4_ru как fallback.
MODEL_URLS = {
    "v5_2_ru": "https://models.silero.ai/models/tts/ru/v5_2_ru.pt",
    "v4_ru": "https://models.silero.ai/models/tts/ru/v4_ru.pt",
}

torch.set_num_threads(THREADS)
DEVICE = torch.device("cpu")

_models: dict[str, torch.nn.Module] = {}

# Один постоянный поток для всего синтеза. torch инициализируется лениво ПО ПОТОКАМ,
# поэтому прогрев и запросы должны идти на одном и том же потоке — иначе первый
# реальный запрос снова холодный (~5 c). Второй worker сейчас не нужен: текущая
# нагрузка далека от насыщения, а вторая копия вычислений повысит RSS и цену RAM.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tts")

# Метрики очереди защищены lock-ом, потому что endpoint работает в asyncio-потоке,
# а сам синтез — в постоянном worker-потоке.
_metrics_lock = threading.Lock()
_requests_in_flight = 0
_active_syntheses = 0
_peak_requests_in_flight = 0


def _current_rss_bytes() -> int:
    """Текущая RSS процесса в Linux-контейнере без дополнительной зависимости."""
    try:
        with open("/proc/self/statm", encoding="utf-8") as statm:
            resident_pages = int(statm.read().split()[1])
        return resident_pages * os.sysconf("SC_PAGE_SIZE")
    except (FileNotFoundError, IndexError, OSError, ValueError):
        return 0


def _metrics_snapshot() -> dict[str, int]:
    with _metrics_lock:
        return {
            "requests_in_flight": _requests_in_flight,
            "active_syntheses": _active_syntheses,
            "peak_requests_in_flight": _peak_requests_in_flight,
        }


def _request_started() -> None:
    global _requests_in_flight, _peak_requests_in_flight
    with _metrics_lock:
        _requests_in_flight += 1
        _peak_requests_in_flight = max(_peak_requests_in_flight, _requests_in_flight)


def _request_finished() -> None:
    global _requests_in_flight
    with _metrics_lock:
        _requests_in_flight = max(0, _requests_in_flight - 1)


def _worker_started() -> None:
    global _active_syntheses
    with _metrics_lock:
        _active_syntheses += 1


def _worker_finished() -> None:
    global _active_syntheses
    with _metrics_lock:
        _active_syntheses = max(0, _active_syntheses - 1)


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


def _split_text(text: str, limit: int = MAX_CHUNK_CHARS) -> list[str]:
    """Делит длинный текст на куски ≤ limit символов по границам предложений.

    Текст озвучки строится backend-ом с точками между блюдами («борщ. салат. суп»),
    поэтому режем по «. ». Если одно предложение длиннее лимита — режем по словам.
    """
    text = text.strip()
    if len(text) <= limit:
        return [text]

    # Восстанавливаем точку после split, чтобы интонация конца фразы сохранялась.
    sentences = [s.strip() for s in text.split(". ") if s.strip()]
    chunks: list[str] = []
    current = ""
    for i, sentence in enumerate(sentences):
        piece = sentence if i == len(sentences) - 1 else f"{sentence}."
        # Одно предложение длиннее лимита — дробим по словам.
        if len(piece) > limit:
            if current:
                chunks.append(current.strip())
                current = ""
            words = piece.split(" ")
            buf = ""
            for w in words:
                if len(buf) + len(w) + 1 > limit and buf:
                    chunks.append(buf.strip())
                    buf = ""
                buf = f"{buf} {w}".strip()
            if buf:
                current = buf
            continue
        if len(current) + len(piece) + 1 > limit and current:
            chunks.append(current.strip())
            current = ""
        current = f"{current} {piece}".strip()
    if current:
        chunks.append(current.strip())
    return chunks or [text]


def _synthesize(text: str, model_name: str, speaker: str, sample_rate: int) -> bytes:
    model = _load_model(model_name)
    import soundfile as sf

    chunks = _split_text(text)
    # apply_tts возвращает 1D torch.Tensor float32 в диапазоне [-1, 1].
    pieces: list[torch.Tensor] = []
    gap = torch.zeros(int(sample_rate * CHUNK_GAP_SEC))
    for i, chunk in enumerate(chunks):
        audio = model.apply_tts(text=chunk, speaker=speaker, sample_rate=sample_rate)
        if i > 0:
            pieces.append(gap)
        pieces.append(audio)
    audio = pieces[0] if len(pieces) == 1 else torch.cat(pieces)

    buf = io.BytesIO()
    sf.write(buf, audio.numpy(), sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def _synthesize_with_fallback(text: str, primary: str, fallback: str, speaker: str, sample_rate: int) -> tuple[bytes, str, float]:
    """Основная модель → при ошибке fallback. Возвращает (wav, модель, секунды)."""
    t0 = time.time()
    try:
        return _synthesize(text, primary, speaker, sample_rate), primary, time.time() - t0
    except Exception as exc:  # noqa: BLE001
        log.error("Модель %s упала: %s. Fallback → %s.", primary, exc, fallback)
        wav = _synthesize(text, fallback, speaker, sample_rate)
        return wav, fallback, time.time() - t0


def _synthesize_from_queue(
    queued_at: float,
    text: str,
    primary: str,
    fallback: str,
    speaker: str,
    sample_rate: int,
) -> tuple[bytes, str, float, float]:
    """Синтез на worker-потоке с точным временем ожидания очереди."""
    worker_started_at = time.perf_counter()
    queue_wait = worker_started_at - queued_at
    _worker_started()
    try:
        wav, used, synth_took = _synthesize_with_fallback(
            text, primary, fallback, speaker, sample_rate
        )
        return wav, used, synth_took, queue_wait
    finally:
        _worker_finished()


class SynthRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    model: Optional[str] = None
    fallback_model: Optional[str] = None
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
        "Блюдо крылышки готово. Стол номер один.",
        "Заказ номер пять готово. Стол номер три. Заберите.",
        "Готовы блюда: борщ, котлета. Стол номер два.",
    ]
    try:
        t0 = time.time()
        for w in warmups:
            await loop.run_in_executor(
                _executor, _synthesize_with_fallback, w, DEFAULT_MODEL, FALLBACK_MODEL, DEFAULT_SPEAKER, DEFAULT_SAMPLE_RATE
            )
        log.info("Прогрев модели %s (%d фраз) завершён за %.2f c.", DEFAULT_MODEL, len(warmups), time.time() - t0)
    except Exception as exc:  # noqa: BLE001
        log.warning("Не удалось прогреть %s: %s", DEFAULT_MODEL, exc)
    yield
    _executor.shutdown(wait=False)


app = FastAPI(title="Silero Kitchen TTS", version="1.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    rss_bytes = _current_rss_bytes()
    return {
        "status": "ok",
        "default_model": DEFAULT_MODEL,
        "fallback_model": FALLBACK_MODEL,
        "speaker": DEFAULT_SPEAKER,
        "loaded": list(_models.keys()),
        "threads": THREADS,
        "metrics": {
            **_metrics_snapshot(),
            "rss_bytes": rss_bytes,
            "rss_mib": round(rss_bytes / (1024 * 1024), 1),
        },
    }


@app.post("/synthesize")
async def synthesize(req: SynthRequest) -> Response:
    request_started_at = time.perf_counter()
    _request_started()
    text = req.text.strip()
    if not text:
        _request_finished()
        raise HTTPException(status_code=400, detail="Пустой текст")
    speaker = req.speaker or DEFAULT_SPEAKER
    if speaker == "ksenia":
        speaker = "kseniya"
    sample_rate = req.sample_rate or DEFAULT_SAMPLE_RATE
    primary = req.model or DEFAULT_MODEL
    fallback = req.fallback_model or FALLBACK_MODEL

    loop = asyncio.get_event_loop()
    queued_at = time.perf_counter()
    try:
        wav, used, took, queue_wait = await loop.run_in_executor(
            _executor,
            _synthesize_from_queue,
            queued_at,
            text,
            primary,
            fallback,
            speaker,
            sample_rate,
        )
    except Exception as exc:  # noqa: BLE001
        total_took = time.perf_counter() - request_started_at
        metrics = _metrics_snapshot()
        log.error(
            "Синтез не удался (включая fallback): %s. total=%.3f c, "
            "in_flight=%d, active=%d, peak=%d",
            exc,
            total_took,
            metrics["requests_in_flight"],
            metrics["active_syntheses"],
            metrics["peak_requests_in_flight"],
        )
        _request_finished()
        raise HTTPException(status_code=503, detail="TTS недоступен") from exc

    total_took = time.perf_counter() - request_started_at
    rss_bytes = _current_rss_bytes()
    metrics = _metrics_snapshot()
    try:
        log.info(
            "Синтез (%s): synth=%.3f c, queue=%.3f c, total=%.3f c, "
            "%d симв., %d байт, rss=%.1f MiB, in_flight=%d, active=%d, peak=%d",
            used,
            took,
            queue_wait,
            total_took,
            len(text),
            len(wav),
            rss_bytes / (1024 * 1024),
            metrics["requests_in_flight"],
            metrics["active_syntheses"],
            metrics["peak_requests_in_flight"],
        )
        return Response(
            content=wav,
            media_type="audio/wav",
            headers={
                "X-TTS-Model": used,
                "X-TTS-Seconds": f"{took:.3f}",
                "X-TTS-Queue-Seconds": f"{queue_wait:.3f}",
                "X-TTS-Total-Seconds": f"{total_took:.3f}",
                "X-TTS-RSS-MiB": f"{rss_bytes / (1024 * 1024):.1f}",
                "X-TTS-In-Flight": str(metrics["requests_in_flight"]),
            },
        )
    finally:
        _request_finished()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8001")))
