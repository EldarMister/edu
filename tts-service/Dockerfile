# Silero Kitchen TTS — self-hosted, CPU-only.
FROM python:3.11-slim

WORKDIR /app

# Системные зависимости для soundfile (libsndfile).
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# CPU-сборка torch (без CUDA — меньше образ, не нужен GPU).
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Модели кэшируются здесь; смонтируйте volume, чтобы не качать при каждом старте.
ENV TTS_MODELS_DIR=/app/models
VOLUME ["/app/models"]

EXPOSE 8001
# 1 воркер: модель тяжёлая, держим один процесс. Параллелизм — через torch threads.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
