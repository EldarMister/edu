# EDU POS Delivery API v1

API включается владельцем кафе в настройках **Онлайн-заказы / Доставка**. Там же
выпускается ключ. Каждый запрос должен содержать заголовок:

```http
X-API-Key: edu_live_...
Content-Type: application/json
```

Базовый путь: `/api/integration/v1`.

## Создать заказ

`POST /orders`

```json
{
  "externalOrderId": "APP-1048",
  "customerName": "Айжан",
  "customerPhone": "+996700000000",
  "deliveryAddress": "Бишкек, ул. Киевская 10",
  "comment": "Позвонить по приезде",
  "items": [
    {
      "dishId": "id-из-menu",
      "variantId": "необязательный-id-варианта",
      "quantity": 2,
      "comment": "Без лука"
    }
  ]
}
```

`externalOrderId` уникален в пределах кафе. Повторный запрос с тем же значением
не создаёт дубль, а возвращает уже существующий заказ.

Названия и цены из внешнего приложения не принимаются. EDU POS проверяет `dishId`,
`variantId`, доступность, остатки и самостоятельно рассчитывает сумму.

## Получить заказ и прогресс

`GET /orders/{externalOrderId}`

```json
{
  "id": "pos-order-id",
  "externalOrderId": "APP-1048",
  "orderNumber": "42",
  "source": "delivery",
  "status": "cooking",
  "completed": false,
  "progress": {
    "itemsTotal": 3,
    "itemsReady": 1,
    "itemsRejected": 0
  },
  "items": [
    {
      "dishId": "...",
      "variantId": null,
      "name": "Бургер",
      "quantity": 2,
      "readyQuantity": 0,
      "status": "cooking",
      "rejectReason": null
    }
  ]
}
```

Основные статусы заказа:

- `sent_to_kitchen` — новый, ожидает принятия;
- `accepted_by_kitchen` — принят кухней;
- `cooking` — готовится;
- `partially_rejected` — часть позиций отклонена;
- `ready` — полностью готов и находится в «Завершённых» на кухне;
- `rejected` — весь заказ отклонён;
- `cancelled` — заказ отменён.

Статусы позиций: `new`, `accepted`, `cooking`, `ready`, `rejected`, `cancelled`,
`served`.

## Получить меню

`GET /menu`

Возвращает активные категории, блюда, варианты, цены, скидки и `isAvailable`.
При создании заказа следует использовать только идентификаторы из этого ответа.

## Получить стоп-лист

`GET /stop-list`

Возвращает активные блюда с `isAvailable: false`. Внешнее приложение должно
скрыть или заблокировать их для заказа. Актуальность можно периодически проверять
через `/stop-list` либо повторно получать `/menu`.

## Ошибки

- `400` — некорректный состав или недостаточно остатка;
- `401` — ключ отсутствует, неверен или отключён;
- `403` — кафе/интеграция отключены;
- `404` — внешний заказ не найден;
- `429` — превышен лимит запросов.
