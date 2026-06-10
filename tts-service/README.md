# Silero Kitchen TTS

Self-hosted, бесплатная озвучка кухни (русский) на [Silero TTS](https://github.com/snakers4/silero-models).

- **Основная модель:** `v4_ru` + speaker `baya`
- **Fallback:** `v3_1_ru` + speaker `baya` (только если v4_ru упала)
- **Sample rate:** `24000` Гц — критично для скорости (на 48000 синтез в ~10x медленнее).
- v5-модели не используются.

Сервис только **синтезирует** переданный текст в WAV. Формирование текста
(номер прописью, точки между блюдами, `voiceName` блюд) — на стороне backend (NestJS).

## Замеры (CPU, 12 потоков, прогретая модель)

| Текст | 48000 Гц | 24000 Гц |
|---|---|---|
| 6 блюд (≈11 c аудио) | 5.6 c | **0.5 c** |
| 4 блюда (≈7.6 c аудио) | — | **0.2–0.5 c** |

→ на 24 кГц укладываемся в 1–3 c для заказа из 5–8 блюд.

## Запуск (Docker)

```bash
docker build -t kitchen-tts .
docker run -p 8001:8001 -v $(pwd)/models:/app/models kitchen-tts
```

Первый старт скачивает `v4_ru.pt` (~40 МБ) и прогревает модель. Volume `models/`
кэширует модель между перезапусками.

## Запуск (локально)

```bash
python -m venv venv
venv/Scripts/pip install -r requirements.txt   # + torch CPU
venv/Scripts/uvicorn app:app --host 0.0.0.0 --port 8001
```

## API

- `GET /health` → статус, загруженные модели.
- `POST /synthesize` `{ "text": "...", "model"?: "v4_ru", "speaker"?: "baya", "sample_rate"?: 24000 }`
  → `audio/wav`. Заголовки ответа: `X-TTS-Model`, `X-TTS-Seconds`.

## Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `8001` | Порт сервиса |
| `TTS_MODEL` | `v4_ru` | Основная модель |
| `TTS_FALLBACK_MODEL` | `v3_1_ru` | Fallback |
| `TTS_SPEAKER` | `baya` | Голос |
| `TTS_SAMPLE_RATE` | `24000` | Частота |
| `TTS_THREADS` | число CPU | Потоки torch |
| `TTS_MODELS_DIR` | `./models` | Кэш моделей |

Backend (NestJS) обращается к этому сервису по `TTS_SERVICE_URL` (см. `backend/src/tts`).
