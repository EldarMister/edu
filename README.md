# EDU POS

EDU POS - полноценная POS/PWA-система для кафе и ресторанов с четырьмя рабочими контурами:

- официант;
- кухня;
- бар;
- админ/владелец.

Проект покрывает весь операционный цикл заведения: от старта смены и создания заказа до оплаты, печати чека, сверки банковских платежей, журнала действий и управления каталогом в реальном времени.

## Из чего состоит проект

- `backend` - NestJS API, Prisma, PostgreSQL, JWT, Socket.IO, Web Push, бизнес-логика заказов, оплаты, печати и отчетности.
- `frontend` - React/Vite PWA с отдельными интерфейсами для официанта, кухни, бара, администратора и владельца.
- `tts-service` - self-hosted FastAPI микросервис на Silero TTS для голосовой озвучки заказов и событий.

## Что реально умеет система

### Общая платформа

- Авторизация по телефону и паролю.
- JWT access/refresh flow.
- Роли `WAITER`, `KITCHEN`, `BAR`, `ADMIN`, `OWNER`.
- Автоматический вход в домашний интерфейс своей роли.
- Защищенные backend routes и frontend-маршруты.
- Глобальная обработка ошибок API.
- Socket.IO realtime без ручного обновления страницы.
- PWA-режим: installable frontend, service worker, offline-aware UI.
- Индикатор соединения и offline banner.
- Система звуков и голосовых уведомлений.
- Web Push уведомления при наличии VAPID-ключей.
- Toast-уведомления и системные модалки.
- Версионирование frontend и модалка о доступном обновлении.
- Поддержка русского и кыргызского языка интерфейса.

### Официант

- Старт и завершение смены.
- Профиль официанта с текущим статусом смены.
- Личный кабинет официанта со статистикой, выручкой и историей заказов.
- Включение push-уведомлений и тест звука.
- Выбор зала и стола.
- Блокировка чужих занятых столов.
- Цветовые статусы столов и легенда статусов.
- Отдельная корзина на каждый стол.
- Безопасный перенос черновой корзины на другой стол.
- Поиск по меню и категориям.
- Работа с обычными блюдами, вариантами блюда и сетами.
- Кастомизация сетов: удаление и замена компонентов.
- Пометка позиции `С собой`.
- Комментарий к позиции и к заказу.
- Создание нового заказа.
- Создание заказа только с позициями `без отправки`, когда кухня/бар не нужны.
- Добавление новых блюд в уже существующий заказ.
- Редактирование заказа до принятия кухней.
- Отмена заказа с причиной и undo-таймером перед финальной отправкой на сервер.
- Просмотр активных заказов и сортировка по приоритету внимания.
- Перевод заказа по этапам:
  - отправлен на кухню;
  - забран с кухни;
  - подан гостям;
  - переведен к оплате.
- Обработка частичного отказа кухни по отдельным позициям:
  - продолжить без позиции;
  - убрать конкретную отказанную позицию;
  - заменить конкретную отказанную позицию другим блюдом;
  - хранение связи `что отказали -> чем заменили`.
- Отмена готового/поданного блюда прямо из заказа с причиной.
- Действия со столом:
  - закрыть стол;
  - перенести заказ на другой стол;
  - передать стол другому официанту на смене.

### Оплата и чек

- Оплата QR-кодом.
- Оплата наличными.
- Оплата картой.
- Смешанная оплата одного платежа несколькими способами.
- Разделение счета на несколько платежей.
- Редактирование суммы отдельных платежей при разделении счета.
- Раздельная оплата отображается отдельно от смешанной оплаты.
- Доступные способы оплаты приходят из owner settings.
- Проверка, что QR нельзя использовать без загруженного QR-кода.
- Модалка оплаты с QR, наличными и картой.
- Печать `Счета` для гостя.
- Печать финального чека.
- Поток печати через администратора:
  - официант создает заявку;
  - администратор подтверждает;
  - официант получает статус;
  - отдельным событием приходит именно факт печати.
- Нумерация чеков устойчива к удалению истории.
- После оплаты стол освобождается автоматически.

### Кухня и бар

- Отдельные интерфейсы `/kitchen` и `/bar`.
- Разделение цехов через `PrepStation`:
  - `kitchen`;
  - `bar`;
  - `none`.
- В кухню уходят только кухонные позиции.
- В бар уходят только барные позиции.
- Позиции `none` не озвучиваются и не попадают в кухню/бар.
- Вкладки заказов:
  - новые;
  - в работе;
  - готовые;
  - отказанные.
- Real-time получение новых заказов.
- Fallback refresh для подстраховки realtime.
- Работа только со своими позициями заказа, без лишнего шума.
- Поддержка комментариев к заказу и к позициям.
- Отметка `С собой` у нужных позиций.
- Отдельное управление готовностью компонентов сета.
- Принятие заказа в работу.
- Отметка заказа готовым.
- Отказ всего заказа.
- Отказ отдельной позиции с причиной.
- Запись kitchen events в базу.
- Stop-list с поиском и переключением доступности блюд.
- Изменения стоп-листа сразу уходят официантам.

### Голосовая озвучка

- Self-hosted Silero TTS, без Web Speech API.
- Очередь озвучки без перебивания фраз.
- Голосовая озвучка новых заказов для кухни и бара.
- Голосовая озвучка событий официанту.
- Использование `voiceName` у блюда, если нужно отдельное произношение.
- В озвучке учитываются номер заказа, номер стола, зал и состав заказа.
- При добавлении новых блюд в действующий заказ озвучиваются именно новые позиции.
- При отказах и заменах озвучиваются конкретные блюда, а не абстрактные сообщения.
- Замена может проговариваться в формате `старое блюдо -> новое блюдо`.

### Администратор

- Рабочая админка без owner-only аналитики.
- Экран заказов:
  - список заказов;
  - сводка по статусам;
  - поиск;
  - фильтры по статусу, способу оплаты, официанту и периоду;
  - просмотр деталей;
  - отмена заказа.
- Экран `Печать чека`:
  - входящие заявки от официантов;
  - подтверждение;
  - отклонение;
  - отметка фактической печати.
- Управление залами и столами.
- Управление категориями, блюдами, вариантами блюд и сетами.
- Массовый перенос блюд между категориями.
- Изменение порядка категорий.
- Полное удаление блюда из меню с сохранением истории заказов по snapshot-данным.
- Управление персоналом:
  - создание;
  - редактирование;
  - деактивация;
  - мягкое удаление, если есть история заказов;
  - видимость сотрудников на смене.
- Отчет по официантам.
- Отчет по сменам.
- Фиксация суммы сданной наличности по смене.

### Владелец

- Все возможности администратора.
- Dashboard статистики:
  - выручка за сегодня;
  - выручка за период;
  - количество заказов;
  - средний чек;
  - тренды;
  - график выручки;
  - распределение по способам оплаты;
  - топ блюд;
  - топ официантов.
- Периоды статистики:
  - today;
  - week;
  - month;
  - all;
  - custom.
- Журнал действий с фильтрами и old/new values.
- Сверка оплат по банковской выписке:
  - загрузка `xlsx`;
  - загрузка `pdf`;
  - сопоставление с POS-оплатами;
  - разные временные допуски;
  - статусы расхождений.
- Настройки заведения:
  - название;
  - адрес;
  - телефоны;
  - текст в чеке;
  - язык системы;
  - включение/выключение способов оплаты;
  - загрузка QR;
  - удаление QR;
  - статус принтера.
- Автосохранение настроек без кнопки `Сохранить изменения`.
- Изменения owner/admin сразу разлетаются в другие интерфейсы через realtime.

## Важные продуктовые сценарии

### 1. Разделение счета

Система поддерживает не только обычную оплату, но и разделение заказа на несколько независимых платежей.

- каждый платеж может иметь свой способ оплаты;
- суммы платежей можно редактировать;
- один платеж может быть смешанным;
- весь заказ при этом считается `раздельной оплатой`, а не `смешанной`.

Правило отображения:

- один способ оплаты на весь заказ -> `QR-код` / `Наличные` / `Карта`;
- один платеж закрыт несколькими способами -> `Смешанная`;
- заказ закрыт несколькими платежами -> `Раздельная оплата`.

### 2. Частичный отказ кухни

Если кухня отказала не весь заказ, а только отдельные позиции:

- заказ переходит в сценарий частичного отказа;
- официант видит активные блюда отдельно от отказанных;
- решение принимается по каждой отказанной позиции отдельно;
- можно заменить позицию или убрать ее из заказа;
- итоговая сумма считается только по активным блюдам.

### 3. Печать счета и чека

Печать построена как отдельный workflow:

1. официант создает заявку;
2. заявка попадает администратору;
3. администратор подтверждает или отклоняет;
4. после реальной печати приходит событие `printed`;
5. официант получает живое уведомление без ручного обновления.

Это разделяет `заявка принята` и `документ реально распечатан`.

### 4. Real-time синхронизация без перезахода

Изменения владельца и администратора сразу отражаются у других ролей:

- обновление настроек оплаты;
- загрузка и удаление QR-кода;
- изменение категорий и блюд;
- изменение стоп-листа;
- создание, удаление и редактирование столов и залов;
- изменения меню, сетов и вариантов;
- входящие заявки на печать и статусы печати;
- обновления заказов и статусов столов.

## Технологии

### Backend

- Node.js
- TypeScript
- NestJS
- Prisma
- PostgreSQL
- Socket.IO
- JWT / Passport JWT
- bcrypt
- class-validator / class-transformer
- web-push
- xlsx
- pdf-parse
- @nestjs/schedule

### Frontend

- React 18
- TypeScript
- Vite
- Tailwind CSS
- React Router
- TanStack Query
- Zustand
- Axios
- Socket.IO Client
- vite-plugin-pwa

### TTS service

- FastAPI
- PyTorch
- Torchaudio ecosystem
- Silero TTS
- soundfile

## Структура проекта

```text
edu pos/
├── backend/
│   ├── prisma/
│   │   ├── migrations/
│   │   ├── schema.prisma
│   │   └── seed.ts
│   └── src/
│       ├── admin/                   # заказы, каталог, персонал, статистика, сверка
│       ├── audit/                   # журнал действий
│       ├── auth/                    # login / refresh / me / JWT
│       ├── categories/              # публичные категории
│       ├── common/                  # guards, decorators, filters
│       ├── dishes/                  # публичные блюда
│       ├── halls/                   # активные залы
│       ├── kitchen/                 # кухня, бар, стоп-лист, статусы
│       ├── orders/                  # создание и жизненный цикл заказов
│       ├── payments/                # оплата, split, mixed, чек
│       ├── push/                    # browser push
│       ├── realtime/                # Socket.IO rooms/events
│       ├── receipt-prints/          # workflow печати
│       ├── settings/                # настройки заведения
│       ├── tables/                  # закрытие, перенос, передача стола
│       ├── tts/                     # интеграция с TTS
│       ├── users/
│       └── waiter-shifts/
├── frontend/
│   ├── public/
│   │   ├── icon.png
│   │   ├── icon1.png
│   │   ├── push-sw.js
│   │   └── sounds/
│   └── src/
│       ├── components/
│       ├── features/
│       │   ├── admin/
│       │   ├── auth/
│       │   ├── bar/
│       │   ├── kitchen/
│       │   ├── settings/
│       │   └── waiter/
│       ├── lib/
│       ├── routes/
│       ├── services/
│       ├── store/
│       └── types/
├── tts-service/
└── ТЗ/
```

## Роли и маршруты

| Роль | Маршрут | Интерфейс |
| --- | --- | --- |
| `WAITER` | `/waiter` | Официант |
| `KITCHEN` | `/kitchen` | Кухня |
| `BAR` | `/bar` | Бар |
| `ADMIN` | `/admin` | Администратор |
| `OWNER` | `/owner` | Владелец |

Если пользователь уже авторизован, `login` пропускается, а маршрут `*` ведет в домашний интерфейс его роли.

## Основные backend API

Все backend routes идут под префиксом `/api`.

### Auth

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/me`

### Публичные данные

- `GET /api/halls`
- `GET /api/tables`
- `GET /api/categories`
- `GET /api/dishes`
- `GET /api/settings`
- `GET /api/settings/qr`

### Официант и заказ

- `GET /api/waiter/shifts/current`
- `POST /api/waiter/shifts/start`
- `POST /api/waiter/shifts/end`
- `POST /api/orders`
- `GET /api/orders/active`
- `GET /api/orders/cabinet`
- `GET /api/orders/:id`
- `POST /api/orders/:id/items`
- `PATCH /api/orders/:id`
- `POST /api/orders/:id/cancel`
- `POST /api/orders/:id/picked-up`
- `POST /api/orders/:id/rejected-items/:itemId/remove`
- `POST /api/orders/:id/rejected-items/:itemId/replace`
- `POST /api/orders/:id/items/:itemId/cancel`
- `POST /api/orders/:id/resolve-partial-rejection`
- `POST /api/orders/:id/served`
- `POST /api/orders/:id/to-payment`
- `POST /api/tables/:id/close`
- `POST /api/tables/:id/move`
- `POST /api/tables/:id/transfer`
- `GET /api/tables/available-waiters`

### Кухня / бар

- `GET /api/kitchen/orders?tab=new|in_work|ready|rejected`
- `POST /api/kitchen/orders/:id/accept`
- `POST /api/kitchen/orders/:id/ready`
- `POST /api/kitchen/orders/:id/reject`
- `POST /api/kitchen/orders/:id/items/:itemId/reject`
- `GET /api/kitchen/stop-list`
- `PATCH /api/kitchen/stop-list`

### Оплата и чек

- `POST /api/payments`
- `GET /api/payments/:orderId/receipt`
- `POST /api/receipt-prints`
- `GET /api/receipt-prints/pending`
- `POST /api/receipt-prints/:id/approve`
- `POST /api/receipt-prints/:id/reject`
- `POST /api/receipt-prints/:id/printed`

### Админ / владелец

- `GET /api/admin/orders/overview`
- `GET /api/admin/orders`
- `GET /api/admin/orders/:id`
- `GET /api/admin/tables/overview`
- `GET /api/admin/halls`
- `POST /api/admin/halls`
- `PATCH /api/admin/halls/:id`
- `DELETE /api/admin/halls/:id`
- `POST /api/admin/tables`
- `PATCH /api/admin/tables/:id`
- `DELETE /api/admin/tables/:id`
- `GET /api/admin/menu/overview`
- `GET /api/admin/categories`
- `POST /api/admin/categories`
- `PATCH /api/admin/categories/:id`
- `DELETE /api/admin/categories/:id`
- `POST /api/admin/categories/reorder`
- `POST /api/admin/categories/:id/move-dishes`
- `GET /api/admin/dishes`
- `POST /api/admin/dishes`
- `PATCH /api/admin/dishes/:id`
- `DELETE /api/admin/dishes/:id`
- `GET /api/admin/sets`
- `POST /api/admin/sets`
- `PATCH /api/admin/sets/:id`
- `GET /api/admin/staff/overview`
- `GET /api/admin/staff`
- `POST /api/admin/staff`
- `PATCH /api/admin/staff/:id`
- `DELETE /api/admin/staff/:id`
- `GET /api/admin/staff/reports/waiters`
- `GET /api/admin/staff/reports/shifts`
- `POST /api/admin/staff/:id/cash-report`
- `GET /api/admin/statistics`
- `POST /api/admin/reconciliation`
- `GET /api/admin/settings`
- `PATCH /api/admin/settings`
- `GET /api/audit-logs`
- `GET /api/audit-logs/filters`

### Push

- `GET /api/push/public-key`
- `POST /api/push/subscribe`
- `DELETE /api/push/subscribe`

## Real-time события

Socket.IO используется для синхронизации ролей без ручного обновления страницы.

### Комнаты

- `role:kitchen`
- `role:admin`
- `role:admin-only`
- `waiter:{waiterId}`

### События

- `order:new`
- `order:status_changed`
- `kitchen:new_order`
- `waiter:order_ready`
- `waiter:order_rejected`
- `waiter:shift_started`
- `waiter:shift_ended`
- `table:status_changed`
- `tables:updated`
- `menu:updated`
- `settings:updated`
- `notification:new`
- `receipt_print_request_created`
- `receipt_print_request_approved`
- `receipt_print_request_rejected`
- `receipt_print_request_printed`

## Основные модели данных

- `User`
- `Hall`
- `Table`
- `Category`
- `Dish`
- `DishVariant`
- `SetComponent`
- `Order`
- `OrderItem`
- `OrderItemSetComponent`
- `OrderAction`
- `WaiterShift`
- `ShiftCashReport`
- `Payment`
- `KitchenEvent`
- `AuditLog`
- `Settings`
- `PushSubscription`
- `ReceiptPrintRequest`
- `PenaltyReward`
- `Incident`

## Статусы

### Статусы заказа

- `draft`
- `sent_to_kitchen`
- `accepted_by_kitchen`
- `cooking`
- `ready`
- `picked_up`
- `served`
- `waiting_payment`
- `paid`
- `rejected`
- `partially_rejected`
- `cancelled`

### Статусы позиции заказа

- `new`
- `accepted`
- `cooking`
- `ready`
- `rejected`
- `served`
- `cancelled`

### Статусы стола

- `free`
- `occupied`
- `sent_to_kitchen`
- `accepted`
- `cooking`
- `ready`
- `served`
- `waiting_payment`
- `paid`

### Способы оплаты

- `qr`
- `cash`
- `card`
- `mixed`

`mixed` используется только когда один платеж закрыт несколькими способами. Если заказ разбит на несколько отдельных платежей, это уже сценарий `раздельной оплаты`.

## Переменные окружения

### Backend: `backend/.env`

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME?schema=public

JWT_ACCESS_SECRET=change-me-access-secret
JWT_REFRESH_SECRET=change-me-refresh-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

PORT=3000
CORS_ORIGIN=http://localhost:5173

VAPID_SUBJECT=mailto:admin@example.com
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

### Frontend: `frontend/.env`

```env
VITE_API_URL=http://localhost:3000
```

### TTS service

Пример важных переменных:

```env
PORT=8001
TTS_MODEL=v4_ru
TTS_FALLBACK_MODEL=v3_1_ru
TTS_SPEAKER=baya
TTS_SAMPLE_RATE=24000
TTS_THREADS=4
```

## Установка и запуск

### Backend

```bash
cd backend
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

Backend будет доступен по адресу `http://localhost:3000/api`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend будет доступен по адресу `http://localhost:5173`.

### TTS service

```bash
cd tts-service
pip install -r requirements.txt
python app.py
```

TTS service по умолчанию поднимается на `http://localhost:8001`.

## Seed-данные

### Пользователи

| Роль | Имя | Телефон | Пароль |
| --- | --- | --- | --- |
| Официант | Иванов И. | `+70000000001` | `waiter123` |
| Кухня | Петров А. | `+70000000002` | `kitchen123` |
| Админ | Сидоров С. | `+70000000003` | `admin123` |
| Владелец | Кузнецов В. | `+70000000004` | `owner123` |

### Залы и столы

- `Зал`: столы `1-15`, `19`, `20`, `21`
- `Терраса`: столы `1-4`

### Меню

Seed создает базовые категории и стартовый набор блюд для тестирования потока:

- супы;
- горячие блюда;
- салаты;
- напитки;
- десерты.

## Полезные команды

### Backend

```bash
npm run start:dev
npm run build
npm run start:prod
npm run prisma:generate
npm run prisma:migrate
npm run prisma:deploy
npm run prisma:seed
npm run prisma:studio
```

### Frontend

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## Проверка перед релизом

```bash
cd backend
npm run build

cd ../frontend
npm run build
```

## Что важно помнить при разработке

- История заказов хранится по snapshot-полям, поэтому блюда и категории можно удалять без поломки старых заказов.
- Изменения меню, стоп-листа, настроек, столов и залов должны проверяться сразу в нескольких ролях, потому что проект сильно завязан на realtime.
- `voiceName` у блюда влияет на озвучку кухни и официанта.
- `PrepStation.none` означает, что позиция не должна попадать на кухню или в бар.
- QR-оплата зависит не только от toggle, но и от загруженного QR-изображения.
- Автосохранение owner settings работает без отдельной кнопки подтверждения.
- Печатный поток делит статусы `approved` и `printed`, это нельзя смешивать в UI и логике уведомлений.
