# EDU POS Mobile (React Native / Expo)

Мобильный клиент EDU POS для ролей **WAITER / KITCHEN / BAR**. Это **новый клиент** к существующему
backend (NestJS + PostgreSQL + Socket.IO) — отдельной базы/бекенда нет. PWA продолжает работать как раньше.

## Стек

- Expo (React Native) + TypeScript
- React Navigation (native-stack + bottom-tabs)
- TanStack Query (серверный кэш) + Zustand (auth/cart)
- Axios (REST) + socket.io-client (realtime)
- expo-secure-store (токены) + expo-notifications (native push)

## Настройка окружения

Адрес backend задаётся в `.env`:

```
EXPO_PUBLIC_API_URL=https://edu-production-056d.up.railway.app
```

- На реальном телефоне `localhost` недоступен — указывайте публичный URL (Railway/Render)
  или LAN IP вашего ПК (например `http://192.168.0.10:3000`), если backend запущен локально
  и телефон в той же Wi-Fi.
- `/api` добавляется в коде, в URL его писать не нужно.

## Запуск (dev)

```bash
cd mobile
npm install
npx expo start            # затем 'a' (Android) / 'i' (iOS) / QR в Expo Go
```

> Если версии пакетов не совпадут с установленным SDK — выполните `npx expo install --fix`.

Push-уведомления требуют **dev build** (Expo Go их не поддерживает в SDK 53+):

```bash
npx expo prebuild         # создаст android/ и ios/
npx expo run:android      # debug build на устройство/эмулятор
```

## Сборка релиза

```bash
npm i -g eas-cli
eas build -p android --profile preview   # APK для теста
eas build -p android --profile production # AAB
```
Перед сборкой задайте `extra.eas.projectId` в `app.json` (создаётся `eas init`).

## Структура

```
src/
├── components/      UI-примитивы, индикатор соединения
├── config/          env (API URL)
├── hooks/           useRealtimeSync (инвалидация кэша по событиям)
├── lib/             axios (api), queryClient
├── navigation/      Root + Waiter/Kitchen/Bar навигаторы
├── screens/         auth, waiter, kitchen, profile, staff
├── services/
│   ├── api/         auth, waiter, kitchen (мутации/запросы)
│   ├── socket/      socket.io клиент + имена событий
│   └── push/        регистрация native push
├── store/           auth (secure), cart
├── theme/           палитра/отступы (повторяет PWA)
├── types/           DTO (зеркало backend)
└── utils/           форматирование, idempotency, сеты
```

## Backend: что нужно применить для native push (Этап 8)

Добавлена модель `UserDevice` и endpoints `/api/push/devices` (POST/DELETE).
**Миграция ещё не применена** — выполнить с разрешения владельца БД:

```bash
cd backend
npx prisma generate
# применить к нужной базе (dev/прод — по отдельности):
DATABASE_URL="<url>" npx prisma migrate deploy
```
Миграция: `prisma/migrations/20260624140000_user_device_native_push`.
Web Push (PWA) не затрагивается — каналы независимы.

## Совместимость с PWA

- Те же endpoints, JWT (access/refresh), Socket.IO события и комнаты.
- Заказы/столы/смены/меню — общие; действия синхронизируются в обе стороны.
- QR-меню гостей остаётся web-интерфейсом; mobile только видит QR-заказы (`source: 'qr'`).
