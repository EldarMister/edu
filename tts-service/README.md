# Silero Kitchen TTS

Self-hosted, бесплатная озвучка кухни (русский) на [Silero TTS](https://github.com/snakers4/silero-models).

- **Основная модель:** `v5_2_ru` + speaker `baya`
- **Fallback:** `v4_ru` + speaker `baya` (только если v5_2_ru упала)
- **Sample rate:** `24000` Гц — критично для скорости (на 48000 синтез в ~10x медленнее).
- Голоса для `v5_2_ru`: `aidar`, `baya`, `kseniya`, `xenia`, `eugene`.

Сервис только **синтезирует** переданный текст в WAV. Формирование текста
(номер прописью, точки между блюдами, `voiceName` блюд) — на стороне backend (NestJS).

## Замеры (CPU, 12 потоков, прогретая модель)

| Текст | 48000 Гц | 24000 Гц |
|---|---|---|
| 6 блюд (≈11 c аудио) | 5.6 c | **0.5 c** |
| 4 блюда (≈7.6 c аудио) | — | **0.2–0.5 c** |

→ на 24 кГц укладываемся в 1–3 c для заказа из 5–8 блюд.

На Railway сервис использует 8 vCPU и `TTS_THREADS=8`. Один worker намеренно
сохраняется: он держит одну прогретую модель в памяти; очередь и одновременную
нагрузку сервис записывает в лог каждого синтеза.

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
- `POST /synthesize` `{ "text": "...", "model"?: "v5_2_ru", "fallback_model"?: "v4_ru", "speaker"?: "baya", "sample_rate"?: 24000 }`
  → `audio/wav`. Заголовки ответа: `X-TTS-Model`, `X-TTS-Seconds`.

## Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `8001` | Порт сервиса |
| `TTS_MODEL` | `v5_2_ru` | Основная модель |
| `TTS_FALLBACK_MODEL` | `v4_ru` | Fallback |
| `TTS_SPEAKER` | `baya` | Голос |
| `TTS_SAMPLE_RATE` | `24000` | Частота |
| `TTS_THREADS` | `8` (не выше лимита vCPU) | Потоки torch |
| `TTS_MODELS_DIR` | `./models` | Кэш моделей |

## Метрики производительности

Каждый успешный синтез пишет в лог `synth`, `queue`, `total`, `rss`,
`in_flight`, `active` и `peak`:

- `synth` — время генерации аудио;
- `queue` — ожидание свободного worker;
- `total` — полный серверный ответ от входа в endpoint до формирования WAV;
- `rss` — реальная занятая процессом память после синтеза;
- `in_flight` / `peak` — одновременные запросы и их пик после запуска.

Эти же значения (`queue`, `total`, `rss`, `in_flight`) возвращаются в заголовках
`X-TTS-*`; `GET /health` возвращает текущие счётчики и RSS.

Backend (NestJS) обращается к этому сервису по `TTS_SERVICE_URL` (см. `backend/src/tts`).
