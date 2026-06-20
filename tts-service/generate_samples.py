"""
Генерация ПРЕДЗАПИСАННЫХ озвучек тестовых сценариев кухни.

Цель: тест озвучки на кухне должен проигрываться из статических файлов,
БЕЗ запроса на TTS. Скрипт синтезирует каждый фиксированный сценарий для
каждого голоса и сохраняет MP3 в frontend/public/kitchen-voice/.

Запуск (из каталога tts-service):
  ./venv/Scripts/python.exe generate_samples.py

Источник сценариев — frontend/src/services/kitchenVoiceScenarios.json
(тот же, что импортирует фронтенд — единый источник правды).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

import imageio_ffmpeg

# Синтез переиспользуем из самого сервиса (модель/чанкование/fallback идентичны проду).
from app import DEFAULT_MODEL, FALLBACK_MODEL, DEFAULT_SAMPLE_RATE, _synthesize_with_fallback

HERE = os.path.dirname(os.path.abspath(__file__))
SCENARIOS_JSON = os.path.normpath(
    os.path.join(HERE, "..", "frontend", "src", "services", "kitchenVoiceScenarios.json")
)
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "frontend", "public", "kitchen-voice"))

# Голоса должны совпадать с KITCHEN_SPEAKERS на фронте.
SPEAKERS = ["baya", "kseniya", "xenia", "eugene", "aidar"]
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def wav_to_mp3(wav_bytes: bytes, out_path: str) -> None:
    """Кодирует WAV (из памяти) в MP3 64 kbps моно через ffmpeg (stdin → файл)."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    proc = subprocess.run(
        [FFMPEG, "-y", "-loglevel", "error", "-i", "pipe:0",
         "-codec:a", "libmp3lame", "-b:a", "64k", "-ac", "1", out_path],
        input=wav_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr.decode('utf-8', 'ignore')[:300]}")


def main() -> int:
    with open(SCENARIOS_JSON, "r", encoding="utf-8") as fh:
        scenarios = json.load(fh)["scenarios"]

    print(f"Сценариев: {len(scenarios)}, голосов: {len(SPEAKERS)} → {len(scenarios) * len(SPEAKERS)} файлов")
    print(f"Модель: {DEFAULT_MODEL} (fallback {FALLBACK_MODEL}), выход: {OUT_DIR}")

    used_model = DEFAULT_MODEL
    t_all = time.time()
    for speaker in SPEAKERS:
        for sc in scenarios:
            t0 = time.time()
            wav, used, _ = _synthesize_with_fallback(
                sc["text"], DEFAULT_MODEL, FALLBACK_MODEL, speaker, DEFAULT_SAMPLE_RATE
            )
            used_model = used
            out = os.path.join(OUT_DIR, speaker, f"{sc['id']}.mp3")
            wav_to_mp3(wav, out)
            size_kb = os.path.getsize(out) // 1024
            print(f"  {speaker}/{sc['id']}.mp3  ({used}, {size_kb} КБ, {time.time() - t0:.2f} c)")

    manifest = {
        "format": "mp3",
        "model": used_model,
        "speakers": SPEAKERS,
        "scenarioIds": [s["id"] for s in scenarios],
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)

    print(f"Готово за {time.time() - t_all:.1f} c. Манифест: {os.path.join(OUT_DIR, 'manifest.json')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
