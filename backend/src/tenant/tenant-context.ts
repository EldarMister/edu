import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';

/**
 * Контекст тенанта (кафе) на время запроса. cafeId кладётся после авторизации
 * (JwtStrategy) или из токена стола (QR-меню). Хранится в AsyncLocalStorage,
 * поэтому доступен в любом сервисе/запросе без проброса параметров.
 * Если cafeId нет (вход, публичные эндпоинты, фоновые задачи) — авто-скоуп
 * НЕ применяется (мягкий режим): ничего не ломается при одном кафе.
 */
export interface TenantStore {
  cafeId?: string;
}

const storage = new AsyncLocalStorage<TenantStore>();

export function runWithTenant<T>(store: TenantStore, fn: () => T): T {
  return storage.run(store, fn);
}

export function getCafeId(): string | undefined {
  return storage.getStore()?.cafeId;
}

/** Проставить cafeId в текущий контекст (если контекст вообще есть). */
export function setCafeId(cafeId: string | null | undefined): void {
  const store = storage.getStore();
  if (store) store.cafeId = cafeId ?? undefined;
}

/** Все таблицы, привязанные к кафе (имеют колонку cafe_id). Cafe — НЕ тенант. */
const TENANT_MODELS = new Set<string>([
  'User', 'Hall', 'Table', 'Category', 'Dish', 'SetComponent', 'DishVariant',
  'Order', 'OrderAction', 'WaiterShift', 'ShiftCashReport', 'OrderItem',
  'OrderItemSetComponent', 'Payment', 'KitchenEvent', 'PenaltyReward', 'Incident',
  'AuditLog', 'Settings', 'PushSubscription', 'ReceiptPrintRequest',
  'QrTableSession', 'QrGuest', 'QrSessionItem', 'Ingredient', 'RecipeItem',
  'Purchase', 'PurchaseItem', 'StockMovement',
]);

/** Ключи вложенных операций записи Prisma — по ним отличаем relation-write от Json-поля. */
const WRITE_OP_KEYS = new Set([
  'create', 'createMany', 'connectOrCreate', 'connect', 'update', 'updateMany',
  'upsert', 'delete', 'deleteMany', 'set', 'disconnect',
]);

type AnyObj = Record<string, unknown>;

function isPlainObject(v: unknown): v is AnyObj {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/** Обёртка relation-write: { create | connectOrCreate | upsert | ... } (все ключи — write-ops). */
function isRelationWrite(v: unknown): v is AnyObj {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => WRITE_OP_KEYS.has(k));
}

/** Рекурсивно проставляет cafeId в данные записи и во все вложенные create. */
function injectCafeId(record: unknown, cafeId: string): void {
  if (!isPlainObject(record)) return;
  if (record.cafeId == null) record.cafeId = cafeId;
  for (const key of Object.keys(record)) {
    if (key === 'cafeId') continue;
    const val = record[key];
    if (isRelationWrite(val)) processRelationWrite(val, cafeId);
  }
}

function processRelationWrite(wrapper: AnyObj, cafeId: string): void {
  const create = wrapper.create;
  if (Array.isArray(create)) create.forEach((c) => injectCafeId(c, cafeId));
  else if (create != null) injectCafeId(create, cafeId);

  const createMany = wrapper.createMany as AnyObj | undefined;
  if (createMany && createMany.data != null) {
    const rows = createMany.data;
    if (Array.isArray(rows)) rows.forEach((r) => { if (isPlainObject(r) && r.cafeId == null) r.cafeId = cafeId; });
    else if (isPlainObject(rows) && rows.cafeId == null) rows.cafeId = cafeId;
  }

  const coc = wrapper.connectOrCreate;
  const cocArr = Array.isArray(coc) ? coc : coc != null ? [coc] : [];
  cocArr.forEach((x) => { if (isPlainObject(x) && x.create != null) injectCafeId(x.create, cafeId); });

  const upsert = wrapper.upsert;
  const upsArr = Array.isArray(upsert) ? upsert : upsert != null ? [upsert] : [];
  upsArr.forEach((x) => {
    if (!isPlainObject(x)) return;
    if (x.create != null) injectCafeId(x.create, cafeId);
    if (x.update != null) injectCafeId(x.update, cafeId);
  });
}

/**
 * Prisma-middleware авто-скоупа по кафе.
 * Покрывает: списочные/агрегатные чтения и массовые записи (where += cafeId),
 * а также проставляет cafeId в create/createMany/upsert/update (включая вложенные create).
 * НЕ трогает: findUnique/findUniqueOrThrow/update/delete по уникальному where
 * (Prisma не примет cafeId в WhereUniqueInput; id/ключи — глобальные UUID).
 * Строгую изоляцию single-record и raw-SQL добиваем в Фазе 3.
 */
export const tenantPrismaMiddleware: Prisma.Middleware = async (params, next) => {
  const cafeId = getCafeId();
  if (!cafeId || !params.model || !TENANT_MODELS.has(params.model)) {
    return next(params);
  }

  const args = (params.args ?? {}) as AnyObj;

  switch (params.action) {
    case 'findFirst':
    case 'findFirstOrThrow':
    case 'findMany':
    case 'count':
    case 'aggregate':
    case 'groupBy':
    case 'updateMany':
    case 'deleteMany':
      args.where = { ...(args.where as AnyObj), cafeId };
      params.args = args;
      break;

    case 'create':
      injectCafeId(args.data, cafeId);
      params.args = args;
      break;

    case 'createMany': {
      const data = args.data;
      if (Array.isArray(data)) data.forEach((r) => { if (isPlainObject(r) && r.cafeId == null) r.cafeId = cafeId; });
      else if (isPlainObject(data) && data.cafeId == null) data.cafeId = cafeId;
      params.args = args;
      break;
    }

    case 'update':
      // where уникальный — не трогаем; вложенные create в data получают cafeId.
      injectCafeId(args.data, cafeId);
      params.args = args;
      break;

    case 'upsert':
      injectCafeId(args.create, cafeId);
      injectCafeId(args.update, cafeId);
      params.args = args;
      break;

    default:
      // findUnique / findUniqueOrThrow / delete — оставляем как есть.
      break;
  }

  return next(params);
};
