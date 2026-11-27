import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, WarehouseDocument, WarehouseDocumentItem, WarehouseDocumentKind, WarehouseWriteoffReason } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { AuditAction } from '../audit/audit.constants';
import { getCafeId } from '../tenant/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWarehouseDocumentDto, EditPostedWriteoffDto, UpdateWarehouseDocumentDto, WriteoffPreviewDto, WriteoffReasonDto, warehouseWriteoffReasons } from './documents.dto';
import { assertInventoryCutoff, inventoryHistoricalPlan, parseInventoryCountedAt } from './inventory-historical-plan';
import { inventoryPeriodContext } from './inventory-period-context';
import { postStockMovement } from './stock-posting';
import { parseStockEffectiveAt } from './stock-effective-time';
import { replayHistoricalStock } from './historical-stock-replay';
import { inventoryReversalBlockedReason, nextInventoryPeriods } from './closed-inventory-period';
import { lockIngredients, lockWarehouseCatalog } from './stock-lock';
import { assertUnitMatchesType, costFromBase, fromBase, normalizeUnit, toBase, UnitCode, unitLabel } from './units';
import { getWarehouseBalance, resolveWarehouse, warehouseBalances, warehouseDocumentFilter, WarehouseLocation } from './warehouse-location';
import { lockRecipeGraph } from './recipe-resolution';
import { assertWarehousePermission } from './warehouse-permissions';
import { previewWriteoffSources, readWriteoffSnapshot, resolveWriteoffSources, serializeWriteoffSources, sourceInputs, writeoffDishAvailability, writeoffDishUnit, writeoffStockLines } from './writeoff-resolution';
import { writeTransferAct } from './transfer-act-xlsx';
import { writeInventoryWorkbook } from './inventory-xlsx';
import { warehouseDateColumn, warehouseMoneyFormat, warehouseRegisterColumns, warehouseRegisterRows,
  writeWarehouseRegister, type WarehouseRegisterExportDto } from './warehouse-register-xlsx';

type Actor = Pick<AuthUser, 'id' | 'role' | 'name' | 'cafeId'> & Partial<Pick<AuthUser, 'permissions'>>;
type DocumentWithReason = WarehouseDocument & { writeoffReason?: { name: string } | null };
type Document = DocumentWithReason & { items: WarehouseDocumentItem[] };
type StockLine = Omit<WarehouseDocumentItem, 'documentId' | 'cafeId' | 'reopenedQuantity'>;
const writeoffReasonSelect = { select: { name: true } } as const;
const documentInclude = { items: { orderBy: [{ name: 'asc' }, { ingredientId: 'asc' }] }, writeoffReason: writeoffReasonSelect } satisfies Prisma.WarehouseDocumentInclude;
const maxQuantity = new Prisma.Decimal('99999999999.999');
const zero = new Prisma.Decimal(0);
const inventoryCostReset = 'inventory_zero_cost';
const writeoffDeletionNote = 'Удаление списания';
const writeoffDeletionMovementReason = 'writeoff_delete';
const transactionOptions = { timeout: 30_000 };
const transferRegisterColumns = {
  date: warehouseDateColumn,
  products: { label: 'Наименование', width: 52 },
  note: { label: 'Комментарий', width: 42 },
  amount: { label: 'Сумма', width: 17, format: warehouseMoneyFormat },
  employee: { label: 'Сотрудник', width: 28 },
  warehouses: { label: 'Склады', width: 38 },
};
const writeoffRegisterColumns = {
  ...transferRegisterColumns,
  products: { label: 'Товары', width: 52 },
  warehouses: { label: 'Склад', width: 28 },
  categories: { label: 'Категории', width: 34 },
  reason: { label: 'Причина', width: 32 },
  status: { label: 'Статус', width: 24 },
};

function documentEffectiveAt(kind: WarehouseDocumentKind, value: string | null | undefined) {
  if (value != null && kind !== 'transfer' && kind !== 'writeoff') {
    throw new BadRequestException('Складская дата доступна для перемещений и списаний');
  }
  return parseStockEffectiveAt(value);
}

@Injectable()
export class WarehouseDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async reasons(includeArchived = false) {
    const cafeId = this.cafeId();
    const [custom, settings] = await Promise.all([
      this.prisma.writeoffReason.findMany({
        where: { cafeId, ...(includeArchived ? {} : { archivedAt: null }) }, orderBy: { normalizedName: 'asc' },
      }),
      this.prisma.settings.findUnique({ where: { cafeId }, select: {
        expenseWriteoffReasons: true, archivedBuiltinWriteoffReasons: true,
      } }),
    ]);
    const expenses = new Set<string>(settings?.expenseWriteoffReasons);
    const archived = new Set<string>(settings?.archivedBuiltinWriteoffReasons);
    return [
      ...Object.entries(warehouseWriteoffReasons).filter(([id]) => includeArchived || !archived.has(id))
        .map(([id, label]) => ({ id, label, expense: expenses.has(id), custom: false, archived: archived.has(id) })),
      ...custom.map(({ id, name, expense, archivedAt }) => ({ id, label: name, expense, custom: true, archived: !!archivedAt })),
    ];
  }

  async saveWriteoffReason(dto: WriteoffReasonDto, id?: string) {
    const cafeId = this.cafeId();
    const name = dto.name.trim().replace(/\s+/gu, ' ');
    const normalize = (value: string) => value.toLocaleLowerCase('ru');
    const normalizedName = normalize(name);
    if (!name) throw new BadRequestException('Укажите название причины');
    const matchingBuiltin = (Object.keys(warehouseWriteoffReasons) as WarehouseWriteoffReason[])
      .find((key) => normalize(warehouseWriteoffReasons[key]) === normalizedName);
    if (normalize('Без причины') === normalizedName || (matchingBuiltin && !await this.prisma.settings.findFirst({
      where: { cafeId, archivedBuiltinWriteoffReasons: { has: matchingBuiltin } }, select: { id: true },
    }))) {
      throw new ConflictException('Причина с таким названием уже есть');
    }
    const data = { name, normalizedName, expense: dto.expense };
    try {
      const saved = id
        ? await this.prisma.writeoffReason.update({ where: { cafeId_id: { cafeId, id }, archivedAt: null }, data })
        : await this.prisma.writeoffReason.create({ data: { cafeId, ...data } });
      return { id: saved.id, label: saved.name, expense: saved.expense, custom: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new ConflictException('Причина с таким названием уже есть');
        if (error.code === 'P2025') throw new NotFoundException('Причина списания не найдена');
      }
      throw error;
    }
  }

  async removeWriteoffReason(id: string) {
    const cafeId = this.cafeId();
    if (Object.prototype.hasOwnProperty.call(warehouseWriteoffReasons, id)) {
      const builtin = id as WarehouseWriteoffReason;
      await this.prisma.$transaction(async (tx) => {
        await tx.settings.upsert({ where: { cafeId }, create: { cafeId }, update: {} });
        await tx.settings.updateMany({
          where: { cafeId, NOT: { archivedBuiltinWriteoffReasons: { has: builtin } } },
          data: { archivedBuiltinWriteoffReasons: { push: builtin } },
        });
      });
      return { ok: true };
    }
    const result = await this.prisma.writeoffReason.updateMany({
      where: { cafeId, id }, data: { archivedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Причина списания не найдена');
    return { ok: true };
  }

  async list(warehouseId?: string, kind?: WarehouseDocumentKind, search?: string, ids?: string[], includeDeletedWriteoffs = false) {
    if (ids?.length === 0) return [];
    const cafeId = this.cafeId();
    if (warehouseId !== undefined) await this.warehouse(this.prisma, warehouseId);
    const text = search?.trim();
    const includeDeleted = includeDeletedWriteoffs && kind === 'writeoff';
    const sourceMatches = text && (kind === undefined || kind === 'writeoff')
      ? await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT d.id FROM warehouse_documents d
        WHERE d.cafe_id = ${cafeId} AND d.kind = 'writeoff'
        ${includeDeleted ? Prisma.empty : Prisma.sql`AND d.deleted_at IS NULL`}
        ${warehouseId === undefined ? Prisma.empty : Prisma.sql`AND d.warehouse_id = ${warehouseId}`}
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.source_lines->'lines') = 'array'
            THEN d.source_lines->'lines' ELSE '[]'::jsonb END) AS source_line
          WHERE strpos(lower(source_line->>'name'), lower(${text})) > 0
             OR strpos(lower(source_line->>'details'), lower(${text})) > 0
        )
      ` : [];
    const where: Prisma.WarehouseDocumentWhereInput = { cafeId, kind, deletedAt: includeDeleted ? undefined : null, id: ids && { in: ids },
      ...(kind === 'transfer' && warehouseId ? { OR: [{ warehouseId }, { destinationWarehouseId: warehouseId }] } : { warehouseId }),
      ...(text ? { AND: [{ OR: [
        { note: { contains: text, mode: 'insensitive' } },
        { createdByName: { contains: text, mode: 'insensitive' } },
        { postedByName: { contains: text, mode: 'insensitive' } },
        { writeoffReason: { name: { contains: text, mode: 'insensitive' } } },
        { items: { some: { name: { contains: text, mode: 'insensitive' } } } },
        ...(sourceMatches.length ? [{ id: { in: sourceMatches.map(({ id }) => id) } }] : []),
      ] }] } : {}),
    };
    const [documents, totals] = await this.prisma.$transaction([
      this.prisma.warehouseDocument.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { items: { select: { name: true, ingredientId: true }, orderBy: [{ name: 'asc' }, { ingredientId: 'asc' }] },
          writeoffReason: writeoffReasonSelect },
      }),
      this.prisma.$queryRaw<Array<{ id: string; itemsCount: number; varianceValue: Prisma.Decimal | null }>>`
        SELECT d.id, COUNT(i.ingredient_id)::int AS "itemsCount",
          CASE WHEN (d.kind = 'inventory' OR d.effective_at IS NOT NULL) AND d.status IN ('draft', 'submitted') THEN NULL
            WHEN BOOL_AND(i.cost_known OR i.difference = 0) THEN ROUND(SUM(i.difference * i.unit_cost), 2) ELSE NULL END AS "varianceValue"
        FROM warehouse_documents d
        LEFT JOIN warehouse_document_items i ON i.cafe_id = d.cafe_id AND i.document_id = d.id
        WHERE d.cafe_id = ${cafeId}
        ${includeDeleted ? Prisma.empty : Prisma.sql`AND d.deleted_at IS NULL`}
        ${warehouseId === undefined ? Prisma.empty : kind === 'transfer'
          ? Prisma.sql`AND (d.warehouse_id = ${warehouseId} OR d.destination_warehouse_id = ${warehouseId})`
          : Prisma.sql`AND d.warehouse_id = ${warehouseId}`}
        ${kind === undefined ? Prisma.empty : Prisma.sql`AND d.kind = ${kind}::"WarehouseDocumentKind"`}
        ${ids ? Prisma.sql`AND d.id IN (${Prisma.join(ids)})` : Prisma.empty}
        GROUP BY d.id
      `,
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const categorySources = documents.flatMap((document) => {
      const sources = readWriteoffSnapshot(document.sourceLines);
      return sources ? sources.lines.map(({ kind, sourceId }) => ({ kind, sourceId }))
        : document.items.map(({ ingredientId }) => ({ kind: 'ingredient' as const, sourceId: ingredientId }));
    });
    const [categoryIngredients, categoryDishes] = await Promise.all([
      this.prisma.ingredient.findMany({ where: { cafeId, id: { in: [...new Set(categorySources.filter(({ kind }) => kind === 'ingredient').map(({ sourceId }) => sourceId))] } },
        select: { id: true, name: true, category: true } }),
      this.prisma.dish.findMany({ where: { cafeId, id: { in: [...new Set(categorySources.filter(({ kind }) => kind === 'dish').map(({ sourceId }) => sourceId))] } },
        select: { id: true, name: true, category: { select: { name: true } } } }),
    ]);
    const ingredientCatalog = new Map(categoryIngredients.map((ingredient) => [ingredient.id, ingredient]));
    const dishCatalog = new Map(categoryDishes.map((dish) => [dish.id, dish]));
    const byId = new Map(totals.map(({ id, ...summary }) => [id, summary]));
    return documents.map((document) => {
      const summary = byId.get(document.id);
      const sources = readWriteoffSnapshot(document.sourceLines);
      const sourceItems = sources?.lines ?? document.items.map(({ ingredientId, name }) => ({
        kind: 'ingredient' as const, sourceId: ingredientId, name,
      }));
      const categories = sourceItems.map(({ kind, sourceId }) => kind === 'dish'
        ? dishCatalog.get(sourceId)?.category.name : ingredientCatalog.get(sourceId)?.category);
      const writeoffProducts = document.kind === 'writeoff' ? [...new Map(sourceItems.map(({ kind, sourceId, name }) => {
        const product = (kind === 'dish' ? dishCatalog : ingredientCatalog).get(sourceId);
        return [`${kind}:${sourceId}`, { kind, sourceId, name: product?.name ?? name }];
      })).values()] : undefined;
      return { ...this.summary(document, sources?.lines.length ?? summary?.itemsCount ?? 0, summary?.varianceValue ?? null),
        writeoffProducts,
        categories: [...new Set(categories.filter((category): category is string => !!category))].sort((a, b) => a.localeCompare(b, 'ru')),
        productNames: (ids ? (sources?.lines ?? document.items) : (sources?.lines ?? document.items).slice(0, 3)).map(({ name }) => name) };
    });
  }

  async transferRegister(dto: WarehouseRegisterExportDto, showCosts: boolean) {
    const columns = warehouseRegisterColumns<keyof typeof transferRegisterColumns>(dto.columns, transferRegisterColumns, showCosts ? undefined : 'amount');
    const rows = warehouseRegisterRows(dto.ids, await this.list(undefined, 'transfer', undefined, dto.ids));
    const warehouseIds = [...new Set(rows.flatMap(({ warehouseId, destinationWarehouseId }) =>
      destinationWarehouseId ? [warehouseId, destinationWarehouseId] : [warehouseId]))];
    const locations = columns.includes('warehouses') ? await this.prisma.warehouse.findMany({
      where: { cafeId: this.cafeId(), id: { in: warehouseIds } }, select: { id: true, name: true },
    }) : [];
    const names = new Map(locations.map(({ id, name }) => [id, name]));
    return writeWarehouseRegister('Перемещения', columns.map((key) => transferRegisterColumns[key]), rows.map((row) => {
      const cells = {
        date: row.effectiveAt ?? row.postedAt ?? row.createdAt,
        products: row.productNames.join(', '),
        note: row.note,
        amount: row.varianceValue == null ? null : Math.abs(row.varianceValue),
        employee: row.postedByName ?? row.createdByName,
        warehouses: [row.warehouseId, row.destinationWarehouseId].map((id) => id ? names.get(id) ?? 'Склад' : null).filter(Boolean).join(' → '),
      };
      return columns.map((key) => cells[key]);
    }));
  }

  async writeoffRegister(dto: WarehouseRegisterExportDto, showCosts: boolean) {
    const columns = warehouseRegisterColumns<keyof typeof writeoffRegisterColumns>(
      dto.columns, writeoffRegisterColumns, showCosts ? undefined : 'amount', false,
    );
    const rows = warehouseRegisterRows(dto.ids, await this.list(undefined, 'writeoff', undefined, dto.ids, true));
    if (rows.some(({ deletedAt }) => deletedAt) && !columns.includes('status')) columns.push('status');
    const locations = columns.includes('warehouses') ? await this.prisma.warehouse.findMany({
      where: { cafeId: this.cafeId(), id: { in: [...new Set(rows.map(({ warehouseId }) => warehouseId))] } },
      select: { id: true, name: true },
    }) : [];
    const names = new Map(locations.map(({ id, name }) => [id, name]));
    return writeWarehouseRegister('Списания', columns.map((key) => writeoffRegisterColumns[key]), rows.map((row) => {
      const cells = {
        date: row.effectiveAt ?? row.postedAt ?? row.createdAt,
        warehouses: names.get(row.warehouseId) ?? 'Склад',
        products: row.productNames.join(', '),
        categories: row.categories.join(', '),
        note: row.note,
        amount: row.varianceValue == null ? null : Math.abs(row.varianceValue),
        employee: row.postedByName ?? row.createdByName,
        reason: row.reasonLabel ?? 'Без причины',
        status: row.deletedAt ? 'Удалено' : { draft: 'Черновик', submitted: 'На утверждении', posted: 'Проведено', reversed: 'Сторнировано' }[row.status],
      };
      return columns.map((key) => cells[key]);
    }));
  }

  async writeoffOptions(effectiveAt?: string) {
    const cafeId = this.cafeId();
    const date = documentEffectiveAt('writeoff', effectiveAt);
    const [ingredients, dishes, revisions] = await Promise.all([
      this.prisma.ingredient.findMany({ where: { cafeId, isActive: true }, orderBy: { name: 'asc' },
        select: { id: true, name: true, category: true, displayUnit: true, kind: true, preparationMode: true } }),
      this.prisma.dish.findMany({ where: { cafeId, ...writeoffDishAvailability(date), isSet: date ? undefined : false, catalogKind: { not: 'goods' } }, orderBy: { name: 'asc' },
        select: { id: true, name: true, isSet: true, isWeighted: true, weightedMeasure: true,
          category: { select: { name: true } }, variants: { select: { id: true, name: true } } } }),
      date ? this.prisma.recipeRevision.findMany({ where: { cafeId, createdAt: { gt: date } }, distinct: ['dishId'],
        orderBy: [{ dishId: 'asc' }, { createdAt: 'asc' }, { version: 'asc' }], select: { dishId: true, snapshot: true } }) : [],
    ]);
    const historical = new Map(revisions.map((row) => [row.dishId, row.snapshot]));
    return { ingredients: ingredients.map(({ displayUnit, ...item }) => ({ ...item, unit: unitLabel(normalizeUnit(displayUnit)), unitCode: displayUnit })),
      dishes: dishes.flatMap((dish) => {
        const raw = historical.get(dish.id);
        const snapshot = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
        const metadata = snapshot?.writeoffBasis;
        const basis = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
        if (basis.isSet ?? dish.isSet) return [];
        const variants = Array.isArray(snapshot?.variants) ? snapshot.variants.flatMap((item) =>
          item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string' && typeof item.name === 'string' ? [{ id: item.id, name: item.name }] : []) : dish.variants;
        const isWeighted = typeof basis.isWeighted === 'boolean' ? basis.isWeighted : dish.isWeighted;
        return [{ id: dish.id, name: typeof basis.name === 'string' ? basis.name : dish.name, isWeighted, variants, category: dish.category.name,
          unitCode: writeoffDishUnit({ isWeighted, weightedMeasure: typeof basis.weightedMeasure === 'string' ? basis.weightedMeasure : dish.weightedMeasure }) }];
      }) };
  }

  async writeoffPreview(dto: WriteoffPreviewDto) {
    return this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx, true);
      const warehouse = await this.warehouse(tx, dto.warehouseId);
      const saved = dto.documentId ? await this.load(tx, dto.documentId) : null;
      if (saved && (saved.kind !== 'writeoff' || (saved.status !== 'posted' && saved.warehouseId !== warehouse.id)))
        throw new BadRequestException('Документ должен относиться к списанию на выбранном складе');
      const previousDate = saved?.effectiveAt ?? (saved?.status === 'posted' ? saved.postedAt : undefined);
      const date = dto.effectiveAt === undefined ? previousDate : documentEffectiveAt('writeoff', dto.effectiveAt);
      const preserveMatching = saved?.status === 'posted' && saved.warehouseId === warehouse.id &&
        previousDate?.getTime() === date?.getTime();
      const snapshot = await resolveWriteoffSources(tx, warehouse, dto.sourceLines, false, true,
        readWriteoffSnapshot(saved?.sourceLines ?? null), date, preserveMatching);
      return previewWriteoffSources(tx, warehouse, snapshot);
    }, { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async get(id: string, includeInventoryContext = false, inventoryIngredientId?: string, includeDeletedWriteoffs = false) {
    return this.prisma.$transaction(async (tx) => this.preview(tx, await this.load(tx, id, includeDeletedWriteoffs), includeInventoryContext, inventoryIngredientId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async transferAct(id: string, showCosts: boolean) {
    const { document, sender, recipient } = await this.prisma.$transaction(async (tx) => {
      const document = await this.load(tx, id);
      if (document.kind !== 'transfer' || !document.destinationWarehouseId) throw new NotFoundException('Перемещение не найдено');
      if (document.status !== 'posted' && document.status !== 'reversed') {
        throw new BadRequestException('Акт доступен после проведения перемещения');
      }
      const [sender, recipient] = await Promise.all([this.warehouse(tx, document.warehouseId), this.warehouse(tx, document.destinationWarehouseId)]);
      return { document, sender, recipient };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return writeTransferAct(document, sender.name, recipient.name, showCosts);
  }

  async inventoryWorkbook(id: string, showCosts: boolean) {
    const { inventory, warehouse } = await this.prisma.$transaction(async (tx) => {
      const document = await this.load(tx, id);
      if (document.kind !== 'inventory') throw new NotFoundException('Инвентаризация не найдена');
      const [inventory, warehouse] = await Promise.all([
        this.preview(tx, document, true), this.warehouse(tx, document.warehouseId),
      ]);
      return { inventory, warehouse };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return writeInventoryWorkbook(inventory, warehouse.name, inventory.inventoryContext, showCosts);
  }

  async create(actor: Actor, dto: CreateWarehouseDocumentDto) {
    const cafeId = this.assertActor(actor);
    if (!['inventory', 'writeoff', 'transfer', 'supplier_return'].includes(dto.kind)) throw new BadRequestException('Выберите тип документа');
    if (dto.kind === 'inventory' && dto.mode !== 'full' && dto.mode !== 'partial') {
      throw new BadRequestException('Выберите вид инвентаризации');
    }
    if (dto.kind !== 'inventory' && dto.mode != null) throw new BadRequestException('Вид инвентаризации неприменим к списанию');
    const countedAt = parseInventoryCountedAt(dto.kind, dto.countedAt);
    const effectiveAt = documentEffectiveAt(dto.kind, dto.effectiveAt);
    if (dto.sourceLines && (dto.kind !== 'writeoff' || dto.items)) throw new BadRequestException('Составные строки доступны только для списания и заменяют список ингредиентов');
    return this.prisma.$transaction(async (tx) => {
      if (dto.requestKey) {
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`warehouse-request:${cafeId}:${dto.requestKey}`}))) AS request_lock`;
        const existing = await tx.warehouseDocument.findUnique({ where: { cafeId_requestKey: { cafeId, requestKey: dto.requestKey } }, include: documentInclude });
        if (existing) {
          if (existing.deletedAt) throw new ConflictException('Списание уже удалено');
          const reason = await this.reason(tx, dto.kind, dto.reason, dto.writeoffReasonId, existing);
          if (existing.kind !== dto.kind || existing.warehouseId !== dto.warehouseId || existing.destinationWarehouseId !== (dto.destinationWarehouseId ?? null) || existing.sourcePurchaseId !== (dto.sourcePurchaseId ?? null)
            || (countedAt !== undefined && existing.countedAt?.getTime() !== countedAt?.getTime())
            || existing.effectiveAt?.getTime() !== effectiveAt?.getTime()
            || (dto.kind === 'writeoff' && (existing.reason !== reason.reason || existing.writeoffReasonId !== reason.writeoffReasonId))) {
            throw new ConflictException('Ключ повторного запроса уже использован для другого документа');
          }
          if (dto.sourceLines) {
            const snapshot = readWriteoffSnapshot(existing.sourceLines);
            if (!snapshot || snapshot.lines.length !== dto.sourceLines.length || dto.sourceLines.some((input) => {
              const saved = snapshot.lines.find((line) => line.sourceLineId === input.sourceLineId);
              return !saved || saved.kind !== input.kind || saved.sourceId !== input.sourceId || saved.variantId !== input.variantId
                || saved.quantity !== input.quantity || saved.unit !== normalizeUnit(input.unit ?? saved.unit)
                || saved.packageId !== input.packageId
                || (input.details !== undefined && (saved.details ?? '') !== (input.details?.trim() ?? ''))
                || (input.recipeSignature && saved.recipeSignature !== input.recipeSignature);
            })) {
              throw new ConflictException('Ключ повторного запроса уже использован для другого состава списания');
            }
          }
          if (dto.items && dto.kind !== 'inventory' && (dto.items.length !== existing.items.length || dto.items.some((line) => {
            const saved = existing.items.find((item) => item.ingredientId === line.ingredientId);
            return line.quantity === null || !saved?.quantity?.eq(new Prisma.Decimal(toBase(line.quantity, normalizeUnit(saved.unit))).toDecimalPlaces(3));
          }))) throw new ConflictException('Ключ повторного запроса уже использован с другими позициями');
          return existing.reopenedAt ? this.preview(tx, existing) : this.finalize(tx, actor, existing.id, dto.finalize);
        }
      }
      const reason = await this.reason(tx, dto.kind, dto.reason, dto.writeoffReasonId);
      const warehouse = await this.warehouse(tx, dto.warehouseId);
      if (dto.kind === 'transfer') {
        if (!dto.destinationWarehouseId || dto.destinationWarehouseId === warehouse.id) throw new BadRequestException('Выберите другой склад-получатель');
        await this.warehouse(tx, dto.destinationWarehouseId);
      } else if (dto.destinationWarehouseId) throw new BadRequestException('Склад-получатель доступен только для перемещения');
      if (dto.kind === 'supplier_return') {
        if (!dto.sourcePurchaseId) throw new BadRequestException('Выберите исходный приход');
        await this.sourcePurchase(tx, dto.sourcePurchaseId, warehouse);
      } else if (dto.sourcePurchaseId) throw new BadRequestException('Исходный приход доступен только для возврата поставщику');
      const document = await tx.warehouseDocument.create({
        data: {
          cafeId, warehouseId: warehouse.id, kind: dto.kind, mode: dto.mode ?? null, countedAt, effectiveAt,
          ...reason, note: dto.note?.trim() || null,
          destinationWarehouseId: dto.destinationWarehouseId, sourcePurchaseId: dto.sourcePurchaseId, requestKey: dto.requestKey,
          createdById: actor.id, createdByName: actor.name,
        },
        include: documentInclude,
      });
      let inputs = dto.items ?? [];
      if (dto.sourceLines) {
        await lockRecipeGraph(tx, true);
        const snapshot = await resolveWriteoffSources(tx, warehouse, dto.sourceLines, !!dto.finalize, !dto.finalize, null, effectiveAt);
        await tx.warehouseDocument.update({ where: { id: document.id }, data: { sourceLines: snapshot as unknown as Prisma.InputJsonValue } });
        inputs = await writeoffStockLines(tx, snapshot);
      }
      await this.saveLines(tx, warehouse, document, inputs, false);
      return this.finalize(tx, actor, document.id, dto.finalize);
    }, transactionOptions);
  }

  async update(actor: Actor, id: string, dto: UpdateWarehouseDocumentDto) {
    this.assertActor(actor);
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDocument(tx, id, dto.revision, 'draft');
      if (document.reopenedAt) return this.updateReopenedInventory(tx, actor, document, dto);
      const warehouse = await this.warehouse(tx, document.warehouseId);
      const countedAt = parseInventoryCountedAt(document.kind, dto.countedAt);
      const effectiveAt = documentEffectiveAt(document.kind, dto.effectiveAt);
      if (dto.sourceLines && (document.kind !== 'writeoff' || dto.items)) throw new BadRequestException('Составные строки доступны только для списания и заменяют список ингредиентов');
      if (document.sourceLines && dto.items) throw new BadRequestException('Сохраните исходные строки списания, а не рассчитанные ингредиенты');
      if (dto.recount && document.kind !== 'inventory') throw new BadRequestException('Пересчёт доступен только для инвентаризации');
      const previous = readWriteoffSnapshot(document.sourceLines);
      const dateChanged = effectiveAt !== undefined && effectiveAt?.getTime() !== document.effectiveAt?.getTime();
      const reasonProvided = dto.writeoffReasonId !== undefined || dto.reason != null
        || (dto.reason === null && !document.writeoffReasonId);
      const sourceLines = dto.sourceLines ?? (dateChanged && previous ? sourceInputs(previous).map((line) => ({ ...line, recipeSignature: undefined })) : null);
      if (sourceLines) {
        await lockRecipeGraph(tx, true);
        const snapshot = await resolveWriteoffSources(tx, warehouse, sourceLines, !!dto.finalize, !dto.finalize, previous, effectiveAt === undefined ? document.effectiveAt : effectiveAt);
        const items = await writeoffStockLines(tx, snapshot, document.items);
        await this.saveLines(tx, warehouse, document, items, false);
        await tx.warehouseDocument.update({ where: { id }, data: { sourceLines: snapshot as unknown as Prisma.InputJsonValue } });
      } else if (dto.items || dto.recount || countedAt !== undefined) {
        const items = dto.items ?? document.items.map((item) => ({
          ingredientId: item.ingredientId,
          quantity: item.quantity == null ? null : fromBase(Number(item.quantity), normalizeUnit(item.unit)),
        }));
        await this.saveLines(tx, warehouse, countedAt === undefined ? document : { ...document, countedAt }, items, dto.recount === true);
      }
      await tx.warehouseDocument.update({
        where: { id, cafeId: document.cafeId },
        data: {
          revision: { increment: 1 },
          countedAt,
          effectiveAt,
          note: dto.note === undefined ? undefined : dto.note?.trim() || null,
          ...(reasonProvided ? await this.reason(tx, document.kind, dto.reason, dto.writeoffReasonId, document) : {}),
        },
        include: documentInclude,
      });
      return this.finalize(tx, actor, id, dto.finalize);
    }, transactionOptions);
  }

  async submit(actor: Actor, id: string, revision?: number) {
    this.assertActor(actor);
    return this.prisma.$transaction((tx) => this.submitInTransaction(tx, actor, id, revision), transactionOptions);
  }

  private async submitInTransaction(tx: Prisma.TransactionClient, actor: Actor, id: string, revision?: number) {
    const document = await this.lockDocument(tx, id, revision, 'draft');
    if (document.reopenedAt) throw new BadRequestException('Проведите исправленную инвентаризацию повторно');
    await this.validateSourceSnapshot(tx, document);
    await this.validateLines(tx, document);
    return this.preview(tx, await tx.warehouseDocument.update({
      where: { id, cafeId: document.cafeId },
      data: {
        status: 'submitted', revision: { increment: 1 }, submittedAt: new Date(),
        submittedById: actor.id, submittedByName: actor.name,
      },
      include: documentInclude,
    }));
  }

  async reopen(actor: Actor, id: string, revision?: number) {
    this.assertActor(actor, true);
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDocument(tx, id, revision, ['submitted', 'posted']);
      if (document.status === 'posted') {
        if (document.kind !== 'inventory') throw new BadRequestException('Переоткрыть можно только проведённую инвентаризацию');
        if (actor.role !== Role.OWNER && !actor.permissions?.actions?.warehouseCount) {
          throw new ForbiddenException('Для редактирования нужен доступ к инвентаризации');
        }
        this.assertInventoryRevision(revision);
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${'inventory-open:' + document.warehouseId}))) AS reopen_lock`;
        if (await tx.warehouseDocument.findFirst({
          where: { cafeId: document.cafeId, warehouseId: document.warehouseId, reopenedAt: { not: null } }, select: { id: true },
        })) {
          throw new ConflictException('По этому складу уже открыта инвентаризация на редактирование. Сначала проведите её.');
        }
        await lockIngredients(tx, document.items.map(({ ingredientId }) => ingredientId));
        const posted = await this.load(tx, id);
        if (!posted.postedAt || !posted.items.length || posted.items.some((item) => !item.quantity || !item.expected)) {
          throw new ConflictException('В журнале отсутствуют подтверждённые результаты инвентаризации');
        }
        const reopenedAt = new Date();
        await this.auditInventoryEdit(tx, actor, posted, 'WAREHOUSE_INVENTORY_REOPENED', 'Инвентаризация открыта на редактирование');
        return this.preview(tx, await tx.warehouseDocument.update({ where: { id, cafeId: document.cafeId },
          data: { status: 'draft', reopenedAt, revision: { increment: 1 } }, include: documentInclude }));
      }
      return this.preview(tx, await tx.warehouseDocument.update({
        where: { id, cafeId: document.cafeId },
        data: { status: 'draft', revision: { increment: 1 } },
        include: documentInclude,
      }));
    }, transactionOptions);
  }

  private assertInventoryRevision(revision?: number) {
    if (revision === undefined) throw new BadRequestException('Обновите данные инвентаризации перед редактированием');
  }

  private async updateReopenedInventory(tx: Prisma.TransactionClient, actor: Actor, document: Document, dto: UpdateWarehouseDocumentDto) {
    this.assertInventoryRevision(dto.revision);
    this.assertActor(actor, true);
    const cutoffAt = document.countedAt ?? document.postedAt!;
    if ((dto.countedAt !== undefined && parseInventoryCountedAt('inventory', dto.countedAt)?.getTime() !== cutoffAt.getTime())
      || dto.recount || dto.effectiveAt != null || dto.sourceLines || dto.reason != null || dto.writeoffReasonId != null) {
      throw new BadRequestException('При повторном проведении дата, вид и список позиций инвентаризации остаются прежними');
    }
    if (dto.finalize === 'submit') throw new BadRequestException('Проведите исправленную инвентаризацию повторно');
    await lockIngredients(tx, document.items.map(({ ingredientId }) => ingredientId));
    if (dto.items) {
      const values = new Map(dto.items.map(({ ingredientId, quantity }) => [ingredientId, quantity]));
      if (dto.items.length !== document.items.length || values.size !== document.items.length
        || document.items.some(({ ingredientId }) => !values.has(ingredientId))) {
        throw new BadRequestException('Список позиций проведённой инвентаризации нельзя изменить');
      }
      for (const item of document.items) {
        const quantity = values.get(item.ingredientId);
        if (quantity == null) throw new BadRequestException('Укажите фактический остаток для всех позиций, включая нулевые');
        await tx.warehouseDocumentItem.update({
          where: { documentId_ingredientId: { documentId: document.id, ingredientId: item.ingredientId }, cafeId: document.cafeId },
          data: { reopenedQuantity: this.quantity(quantity, normalizeUnit(item.unit), 'inventory') },
        });
      }
    }
    if (dto.finalize === 'post') {
      const corrected = await this.load(tx, document.id);
      const recordedAt = new Date();
      await this.auditInventoryEdit(tx, actor, corrected, 'WAREHOUSE_INVENTORY_REPOSTED', 'Инвентаризация проведена повторно');
      const changed = corrected.items.filter(({ quantity, reopenedQuantity }) => reopenedQuantity && !reopenedQuantity.eq(quantity!));
      if (changed.length) {
        await replayHistoricalStock(tx, { cafeId: document.cafeId, effectiveAt: cutoffAt, insertedMovementIds: [],
          inventoryRepost: { id: document.id, ingredientIds: changed.map(({ ingredientId }) => ingredientId),
            recordedAt, actorId: actor.id, actorName: actor.name, note: dto.note === undefined ? document.note : dto.note?.trim() || null } });
      }
      await tx.warehouseDocumentItem.updateMany({
        where: { cafeId: document.cafeId, documentId: document.id, reopenedQuantity: { not: null } },
        data: { reopenedQuantity: null },
      });
    }
    return this.preview(tx, await tx.warehouseDocument.update({
      where: { id: document.id, cafeId: document.cafeId },
      data: { revision: { increment: 1 }, note: dto.note === undefined ? undefined : dto.note?.trim() || null,
        ...(dto.finalize === 'post' ? { status: 'posted', reopenedAt: null, postedById: actor.id, postedByName: actor.name } : {}) },
      include: documentInclude,
    }));
  }

  private auditInventoryEdit(tx: Prisma.TransactionClient, actor: Actor, document: Document, actionType: string, description: string) {
    return tx.auditLog.create({ data: { cafeId: document.cafeId, userId: actor.id, userName: actor.name, userRole: actor.role,
      actionType, description, entityType: 'WAREHOUSE_DOCUMENT', entityId: document.id,
      oldValue: { note: document.note, items: document.items.map(({ ingredientId, expected, quantity, difference, unitCost }) =>
        ({ ingredientId, expected: expected?.toString() ?? null, quantity: quantity?.toString() ?? null,
          difference: difference?.toString() ?? null, unitCost: unitCost?.toString() ?? null })) },
      newValue: { items: document.items.map(({ ingredientId, quantity, reopenedQuantity }) =>
        ({ ingredientId, quantity: (reopenedQuantity ?? quantity)?.toString() ?? null })) } } });
  }

  async approve(actor: Actor, id: string, revision?: number) {
    this.assertActor(actor);
    return this.prisma.$transaction((tx) => this.approveInTransaction(tx, actor, id, revision), transactionOptions);
  }

  private async approveInTransaction(tx: Prisma.TransactionClient, actor: Actor, id: string, revision?: number) {
    const document = await this.lockDocument(tx, id, revision, 'submitted');
    await this.validateSourceSnapshot(tx, document);
    if (document.kind === 'inventory' || document.kind === 'writeoff') this.assertActor(actor, true);
    if (document.kind === 'supplier_return') await this.validateReturn(tx, document, await this.warehouse(tx, document.warehouseId));
    const { warehouse, ingredients, historicalPlan } = await this.validateLines(tx, document);
    const kind = document.kind;
    const destination = kind === 'transfer' ? await this.warehouse(tx, document.destinationWarehouseId!) : null;
    const postedAt = new Date();
    const effectiveAt = document.effectiveAt;
    if (effectiveAt && effectiveAt > postedAt) throw new BadRequestException('Дата складской операции не может быть в будущем');
    const dateEvidence = effectiveAt ? { createdAt: effectiveAt, recordedAt: postedAt }
      : kind === 'transfer' ? { createdAt: postedAt } : {};
    const insertedMovementIds: string[] = [];
    for (const item of document.items) {
      const ingredient = ingredients.get(item.ingredientId)!;
      const balance = await getWarehouseBalance(tx, warehouse, ingredient);
      // The historical variance changes today's stock by the same amount; all
      // receipts and withdrawals posted after the count remain in the book.
      const expected = historicalPlan?.get(item.ingredientId) ?? balance.stock;
      const difference = kind === 'inventory' ? item.quantity!.sub(expected) : item.quantity!.negated();
      if (difference.abs().gt(maxQuantity)) throw new BadRequestException('Расхождение вне допустимого диапазона');
      const resetCost = kind === 'inventory' && item.quantity!.isZero() && balance.stock.add(difference).isZero()
        && !balance.avgCost.isZero() && (!document.countedAt || !await tx.stockMovement.findFirst({
          where: { cafeId: document.cafeId, ingredientId: item.ingredientId, ...warehouseDocumentFilter(warehouse),
            createdAt: { gte: document.countedAt } }, select: { id: true },
        }));
      await tx.warehouseDocumentItem.update({
        where: { documentId_ingredientId: { documentId: id, ingredientId: item.ingredientId }, cafeId: document.cafeId },
        data: { expected, difference, unitCost: balance.avgCost,
          costKnown: balance.valuationKnown && (difference.gte(0) || balance.stock.gte(difference.abs())) },
      });
      if (difference.isZero() && !resetCost) continue;
      const comment = kind === 'writeoff' ? [this.reasonLabel(document), document.note].filter(Boolean).join(' · ') : document.note;
      const source = await postStockMovement(tx, { ingredientId: item.ingredientId, warehouse, change: difference,
        costKnown: difference.gt(0) ? balance.valuationKnown : undefined,
        carriedAverage: resetCost ? zero : undefined,
        allowNegative: effectiveAt || kind === 'transfer' ? true : undefined,
        movement: { ...dateEvidence, type: kind, sourceType: kind, sourceId: id, actorId: actor.id, actorName: actor.name,
          reason: document.writeoffReasonId ?? document.reason, comment,
          ...(resetCost ? { recipeSnapshot: { kind: inventoryCostReset } }
            : document.sourceLines ? { recipeSnapshot: document.sourceLines as Prisma.InputJsonValue } : {}) } });
      if (effectiveAt) insertedMovementIds.push(source.movement.id);
      if (destination) {
        const received = await postStockMovement(tx, { ingredientId: item.ingredientId, warehouse: destination,
          change: difference.negated(), cost: balance.avgCost, costKnown: source.movement.costKnown, valuation: 'average',
          allowNegative: effectiveAt ? true : undefined,
          movement: { ...dateEvidence, type: 'transfer', sourceType: 'transfer', sourceId: id, actorId: actor.id, actorName: actor.name, comment } });
        if (effectiveAt) insertedMovementIds.push(received.movement.id);
      }
    }
    if (effectiveAt) {
      await replayHistoricalStock(tx, { cafeId: document.cafeId, effectiveAt, insertedMovementIds });
      await tx.auditLog.create({ data: { cafeId: document.cafeId, userId: actor.id, userName: actor.name, userRole: actor.role,
        actionType: 'WAREHOUSE_DOCUMENT_POSTED_RETROSPECTIVELY', entityType: 'WAREHOUSE_DOCUMENT', entityId: document.id,
        description: 'Складской документ проведён с пересчётом себестоимости',
        metadata: { effectiveAt: effectiveAt.toISOString(), postedAt: postedAt.toISOString(), movementIds: insertedMovementIds } } });
    }
    return this.serialize(await tx.warehouseDocument.update({
      where: { id, cafeId: document.cafeId },
      data: {
        status: 'posted', revision: { increment: 1 }, postedAt: effectiveAt || kind === 'transfer' ? postedAt : new Date(),
        postedById: actor.id, postedByName: actor.name,
      },
      include: documentInclude,
    }));
  }

  async reverse(actor: Actor, id: string, note: string, revision?: number) {
    this.assertActor(actor, true);
    if (!note?.trim()) throw new BadRequestException('Укажите причину сторнирования');
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDocument(tx, id, revision, 'posted');
      return this.reversePosted(tx, actor, document, note.trim());
    }, transactionOptions);
  }

  async removeWriteoff(actor: Actor, id: string, revision?: number) {
    const cafeId = this.assertActor(actor);
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDocument(tx, id, revision, ['draft', 'submitted', 'posted', 'reversed']);
      if (document.kind !== 'writeoff') throw new NotFoundException('Списание не найдено');
      assertWarehousePermission(actor, document.status === 'draft' || document.status === 'submitted'
        ? 'warehouseWriteoff' : 'warehouseApprove');
      if (document.status === 'posted') await this.reversePosted(tx, actor, document, writeoffDeletionNote, writeoffDeletionMovementReason);
      await tx.warehouseDocument.update({ where: { id, cafeId },
        data: { deletedAt: new Date(), revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { cafeId, userId: actor.id, userName: actor.name, userRole: actor.role,
        actionType: 'WAREHOUSE_WRITEOFF_DELETED', entityType: 'WAREHOUSE_DOCUMENT', entityId: id,
        description: 'Удалено складское списание', metadata: { previousStatus: document.status } } });
      return { ok: true };
    }, transactionOptions);
  }

  async restoreWriteoff(actor: Actor, id: string, revision?: number) {
    const cafeId = this.assertActor(actor);
    if (revision === undefined || revision === null) throw new BadRequestException('Обновите списание перед восстановлением');
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDocument(tx, id, revision, ['draft', 'submitted', 'reversed'], true);
      if (document.kind !== 'writeoff') throw new NotFoundException('Списание не найдено');
      if (!document.deletedAt) throw new ConflictException('Списание уже восстановлено');
      assertWarehousePermission(actor, document.status === 'reversed' ? 'warehouseApprove' : 'warehouseWriteoff');
      const restoredMovements = document.status === 'reversed'
        ? await this.undoWriteoffDeletion(tx, document)
        : [];
      const restored = await tx.warehouseDocument.update({
        where: { id, cafeId }, include: documentInclude,
        data: { deletedAt: null, revision: { increment: 1 },
          ...(restoredMovements.length ? { status: 'posted', reversedAt: null, reversedById: null, reversedByName: null, reversalReason: null } : {}) },
      });
      await tx.auditLog.create({ data: { cafeId, userId: actor.id, userName: actor.name, userRole: actor.role,
        actionType: 'WAREHOUSE_WRITEOFF_RESTORED', entityType: 'WAREHOUSE_DOCUMENT', entityId: id,
        description: 'Восстановлено складское списание',
        metadata: { deletedAt: document.deletedAt.toISOString(), previousStatus: document.status, status: restored.status,
          removedReversals: restoredMovements },
      } });
      return this.preview(tx, restored);
    }, transactionOptions);
  }

  private async undoWriteoffDeletion(tx: Prisma.TransactionClient, document: Document) {
    const { cafeId, id } = document;
    await lockIngredients(tx, document.items.map(({ ingredientId }) => ingredientId));
    const movements = await tx.stockMovement.findMany({ where: { cafeId, sourceType: 'writeoff', sourceId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    let reversals = movements.filter((movement) => movement.type === 'cancel' && movement.reason === writeoffDeletionMovementReason);
    if (!reversals.length && document.reversalReason === writeoffDeletionNote) {
      // Legacy rows used the same reversal marker for a manually reversed document.
      // Require the audit evidence that deletion actually canceled a posted write-off.
      const deletion = await tx.auditLog.findFirst({ where: { cafeId, entityId: id, actionType: 'WAREHOUSE_WRITEOFF_DELETED' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { metadata: true } });
      const previousStatus = (deletion?.metadata as Prisma.JsonObject | null | undefined)?.previousStatus;
      if (previousStatus === 'posted') {
        reversals = movements.filter((movement) => movement.type === 'cancel' && movement.reason === 'reversal'
          && movement.comment === `Сторно: ${writeoffDeletionNote}`);
        if (!reversals.length) throw new ConflictException('В журнале не найдено сторно удалённого списания');
      }
      if (previousStatus !== 'posted' && previousStatus !== 'reversed') {
        throw new ConflictException('Не удалось подтвердить, было ли это старое списание проведено перед удалением. Сверьте движения по складу перед исправлением остатка.');
      }
    }
    if (!reversals.length) return [];
    const original = movements.filter((movement) => movement.type === 'writeoff');
    const byIngredient = new Map(original.map((movement) => [movement.ingredientId, movement]));
    const matches = reversals.length === document.items.length && movements.length === reversals.length + original.length
      && original.length === reversals.length && byIngredient.size === original.length
      && new Set(reversals.map(({ ingredientId }) => ingredientId)).size === reversals.length
      && reversals.every((reversal) => {
        const source = byIngredient.get(reversal.ingredientId);
        return source && source.warehouseKey === reversal.warehouseKey && source.change.lt(0) && source.change.negated().eq(reversal.change);
      });
    if (!matches) throw new ConflictException('Журнал не подтверждает сторно удалённого списания');
    await replayHistoricalStock(tx, {
      cafeId: this.cafeId(), effectiveAt: reversals[0].createdAt, insertedMovementIds: [],
      replacedWriteoff: { id, movementIds: reversals.map((movement) => movement.id), removeDeletionReversals: true },
    });
    return reversals.map((movement) => ({ id: movement.id, ingredientId: movement.ingredientId,
      warehouseId: movement.warehouseId, createdAt: movement.createdAt.toISOString(), change: movement.change.toString(),
      costAtMoment: movement.costAtMoment.toString(), costKnown: movement.costKnown }));
  }

  async editPostedWriteoff(actor: Actor, id: string, dto: EditPostedWriteoffDto) {
    const cafeId = this.assertActor(actor);
    assertWarehousePermission(actor, 'warehouseWriteoff');
    assertWarehousePermission(actor, 'warehouseApprove');
    if (dto.revision === undefined || dto.revision === null) throw new BadRequestException('Обновите списание перед редактированием');
    if (dto.finalize || dto.countedAt != null || dto.recount || (dto.sourceLines && dto.items)) {
      throw new BadRequestException('Укажите только изменяемые поля проведённого списания');
    }
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDocument(tx, id, dto.revision, 'posted');
      if (document.kind !== 'writeoff' || !document.postedAt) throw new NotFoundException('Проведённое списание не найдено');
      const warehouse = await this.warehouse(tx, dto.warehouseId ?? document.warehouseId);
      const originalAt = document.effectiveAt ?? document.postedAt;
      const effectiveAt = documentEffectiveAt('writeoff', dto.effectiveAt) ?? originalAt;
      const timingChanged = effectiveAt.getTime() !== originalAt.getTime();
      const moved = timingChanged || warehouse.id !== document.warehouseId;
      const previous = readWriteoffSnapshot(document.sourceLines);
      if (previous && dto.items) throw new BadRequestException('Сохраните исходные строки списания, а не рассчитанные ингредиенты');
      const sources = dto.sourceLines ?? (previous && moved ? sourceInputs(previous).map((line) => ({
        ...line, recipeSignature: undefined,
      })) : undefined);
      if (sources) await lockRecipeGraph(tx, true);
      const snapshot = sources ? await resolveWriteoffSources(tx, warehouse, sources, dto.sourceLines !== undefined, false,
        previous, effectiveAt, !moved) : previous;
      const inputs = sources && snapshot ? await writeoffStockLines(tx, snapshot, document.items) : dto.items;
      if (inputs && !inputs.length) throw new BadRequestException('Добавьте хотя бы одну позицию');
      await lockIngredients(tx, [...document.items.map(({ ingredientId }) => ingredientId),
        ...(inputs ?? []).map(({ ingredientId }) => ingredientId)]);
      const original = await this.load(tx, id);
      const blocked = await this.reversalBlockedReason(tx, original);
      if (blocked) throw new ConflictException('Списание относится к закрытому инвентаризационному периоду. Откройте ближайшую инвентаризацию на редактирование.');
      const movements = await tx.stockMovement.findMany({
        where: { cafeId, sourceType: 'writeoff', sourceId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const oldItems = new Map(original.items.map((item) => [item.ingredientId, item]));
      const originalWarehouse = await this.warehouse(tx, original.warehouseId);
      const warehouseKey = originalWarehouse.isDefault ? 'default' : originalWarehouse.id;
      if (!movements.length || movements.length !== oldItems.size ||
        new Set(movements.map(({ ingredientId }) => ingredientId)).size !== movements.length ||
        movements.some((movement) => movement.type !== 'writeoff' || movement.warehouseKey !== warehouseKey ||
          !oldItems.get(movement.ingredientId)?.quantity?.negated().eq(movement.change))) {
        throw new ConflictException('Журнал не подтверждает исходные остатки списания');
      }
      const changedItems = inputs != null && (inputs.length !== oldItems.size ||
        new Set(inputs.map(({ ingredientId }) => ingredientId)).size !== inputs.length ||
        inputs.some(({ ingredientId, quantity }) => {
          const old = oldItems.get(ingredientId);
          return !old || quantity == null || !old.quantity?.eq(this.quantity(quantity, normalizeUnit(old.unit), 'writeoff'));
        }));
      const affectsStock = moved || changedItems;
      if (affectsStock) {
        const items = inputs ?? original.items.map(({ ingredientId, quantity, unit }) => ({
          ingredientId, quantity: quantity == null ? null : fromBase(Number(quantity), normalizeUnit(unit)),
        }));
        await this.saveLines(tx, warehouse, original, items, false);
      }
      const reasonProvided = dto.reason !== undefined || dto.writeoffReasonId !== undefined;
      const updated = await tx.warehouseDocument.update({
        where: { cafeId, id }, include: documentInclude,
        data: {
          revision: { increment: 1 }, warehouseId: warehouse.id,
          effectiveAt: timingChanged ? effectiveAt : undefined,
          note: dto.note === undefined ? undefined : dto.note?.trim() || null,
          ...(reasonProvided ? await this.reason(tx, 'writeoff', dto.reason, dto.writeoffReasonId, original) : {}),
          sourceLines: sources && snapshot ? snapshot as unknown as Prisma.InputJsonValue : undefined,
        },
      });
      const reason = updated.writeoffReasonId ?? updated.reason;
      const comment = [this.reasonLabel(updated), updated.note].filter(Boolean).join(' · ');
      const recipeSnapshot = updated.sourceLines ? updated.sourceLines as Prisma.InputJsonValue : Prisma.DbNull;
      const insertedMovementIds: string[] = [];
      if (affectsStock) {
        await this.validateLines(tx, updated);
        const recordedAt = new Date();
        for (const item of updated.items) {
          const { movement } = await postStockMovement(tx, {
            ingredientId: item.ingredientId, warehouse, change: item.quantity!.negated(), allowNegative: true,
            movement: { createdAt: effectiveAt, recordedAt, type: 'writeoff', sourceType: 'writeoff', sourceId: id,
              actorId: actor.id, actorName: actor.name, reason, comment, recipeSnapshot },
          });
          insertedMovementIds.push(movement.id);
        }
        await replayHistoricalStock(tx, {
          cafeId, effectiveAt, insertedMovementIds, replacedWriteoff: { id, movementIds: movements.map((movement) => movement.id) },
        });
      } else {
        await tx.stockMovement.updateMany({
          where: { cafeId, id: { in: movements.map((movement) => movement.id) } },
          data: { reason, comment, recipeSnapshot },
        });
      }
      const saved = affectsStock ? await this.load(tx, id) : updated;
      const auditValue = (entry: Document) => ({
        revision: entry.revision, warehouseId: entry.warehouseId, effectiveAt: (entry.effectiveAt ?? entry.postedAt)!.toISOString(),
        reason: entry.reason, writeoffReasonId: entry.writeoffReasonId, reasonLabel: this.reasonLabel(entry), note: entry.note,
        sourceLines: entry.sourceLines,
        items: entry.items.map((item) => ({ ingredientId: item.ingredientId, unit: item.unit,
          quantity: item.quantity?.toString() ?? null, unitCost: item.unitCost?.toString() ?? null, costKnown: item.costKnown })),
      });
      await tx.auditLog.create({ data: { cafeId, userId: actor.id, userName: actor.name, userRole: actor.role,
        actionType: AuditAction.WAREHOUSE_WRITEOFF_EDITED, entityType: 'WAREHOUSE_DOCUMENT', entityId: id,
        description: 'Изменено проведённое списание',
        oldValue: auditValue(original) as Prisma.InputJsonObject, newValue: auditValue(saved) as Prisma.InputJsonObject,
        metadata: { originalMovements: movements.map((movement) => ({
          id: movement.id, ingredientId: movement.ingredientId, warehouseId: movement.warehouseId,
          createdAt: movement.createdAt.toISOString(), change: movement.change.toString(),
          costAtMoment: movement.costAtMoment.toString(), costKnown: movement.costKnown,
          beforeStock: movement.beforeStock.toString(), afterStock: movement.afterStock.toString(),
        })), insertedMovementIds },
      } });
      return this.preview(tx, saved);
    }, transactionOptions);
  }

  private async reversePosted(tx: Prisma.TransactionClient, actor: Actor, document: Document, note: string, reason = 'reversal') {
    const { id } = document;
    await lockIngredients(tx, document.items.map((item) => item.ingredientId));
    const { blocked, historical } = await this.reversalPeriod(tx, document);
    if (blocked) throw new ConflictException(blocked);
    const movements = await tx.stockMovement.findMany({ where: { cafeId: document.cafeId, sourceId: id, sourceType: document.kind }, orderBy: { createdAt: 'desc' } });
    const recordedAt = new Date();
    const historicalAt = historical ? movements[0]?.createdAt : undefined;
    if (historical && !historicalAt) throw new ConflictException('В журнале отсутствуют исходные проводки');
    const movementAt = historicalAt ?? (document.kind === 'transfer' ? recordedAt : undefined);
    const insertedMovementIds: string[] = [];
    // Reverse withdrawals before receipts, so both sides of a transfer remain atomic.
    for (const movement of movements.sort((a, b) => Number(b.change) - Number(a.change))) {
      const warehouse = await this.warehouse(tx, movement.warehouseId!);
      const snapshot = movement.recipeSnapshot;
      const resetCost = movement.sourceType === 'inventory' && snapshot && typeof snapshot === 'object'
        && !Array.isArray(snapshot) && snapshot.kind === inventoryCostReset;
      const restoreCost = resetCost && !await tx.stockMovement.findFirst({
        where: { cafeId: document.cafeId, ingredientId: movement.ingredientId, ...warehouseDocumentFilter(warehouse),
          id: { not: movement.id }, createdAt: { gte: movement.createdAt } }, select: { id: true },
      }) && !await tx.warehouseDocumentItem.findFirst({
        where: { cafeId: document.cafeId, ingredientId: movement.ingredientId, documentId: { not: id }, quantity: { not: null },
          document: { kind: 'inventory', status: 'posted', warehouseId: warehouse.id, postedAt: { gte: document.postedAt! } } },
        select: { ingredientId: true },
      });
      // A cost-only count has no physical reversal. A newer operation
      // already established the warehouse's own carrying average.
      if (resetCost && movement.change.isZero() && !restoreCost) continue;
      const { movement: reversal } = await postStockMovement(tx, { ingredientId: movement.ingredientId, warehouse, change: movement.change.negated(),
        carriedAverage: restoreCost ? movement.costAtMoment : undefined,
        cost: movement.costAtMoment, costKnown: movement.costKnown,
        allowNegative: historicalAt ? true : undefined,
        valuation: historicalAt || movement.change.isZero() ? 'preserve' : movement.change.lt(0) ? 'average' : 'value',
        movement: { createdAt: movementAt, recordedAt: historicalAt ? recordedAt : undefined,
          type: 'cancel', sourceType: document.kind, sourceId: id, actorId: actor.id, actorName: actor.name,
          comment: `Сторно: ${note.trim()}`, reason,
          ...(movement.recipeSnapshot ? { recipeSnapshot: movement.recipeSnapshot as Prisma.InputJsonValue } : {}) } });
      if (historicalAt) insertedMovementIds.push(reversal.id);
    }
    if (historicalAt) {
      await replayHistoricalStock(tx, { cafeId: document.cafeId, effectiveAt: historicalAt, insertedMovementIds });
      await tx.auditLog.create({ data: { cafeId: document.cafeId, userId: actor.id, userName: actor.name, userRole: actor.role,
        actionType: 'WAREHOUSE_DOCUMENT_REVERSED_RETROSPECTIVELY', entityType: 'WAREHOUSE_DOCUMENT', entityId: id,
        description: 'Складской документ сторнирован в открытом инвентаризационном периоде',
        metadata: { effectiveAt: historicalAt.toISOString(), recordedAt: recordedAt.toISOString(), movementIds: insertedMovementIds } } });
    }
    return this.serialize(await tx.warehouseDocument.update({ where: { id, cafeId: document.cafeId },
      data: { status: 'reversed', revision: { increment: 1 }, reversedAt: recordedAt, reversedById: actor.id,
        reversedByName: actor.name, reversalReason: note.trim() }, include: documentInclude }));
  }

  private async finalize(tx: Prisma.TransactionClient, actor: Actor, id: string, action?: 'submit' | 'post') {
    let document = await this.preview(tx, await this.load(tx, id));
    if (!action || document.status === 'posted') return document;
    if (document.status === 'reversed') throw new ConflictException('Проведение документа уже отменено');
    if (document.status === 'draft') document = await this.submitInTransaction(tx, actor, id, document.revision);
    if (action === 'post') document = await this.approveInTransaction(tx, actor, id, document.revision);
    return document;
  }

  private async sourcePurchase(tx: Prisma.TransactionClient, id: string, warehouse: WarehouseLocation) {
    const purchase = await tx.purchase.findFirst({ where: { id, cafeId: warehouse.cafeId, status: 'completed' }, include: { items: true } });
    if (!purchase || (purchase.warehouseId !== warehouse.id && !(warehouse.isDefault && !purchase.warehouseId))) {
      throw new BadRequestException('Выберите проведённый приход на этом складе');
    }
    return purchase;
  }

  private async validateReturn(tx: Prisma.TransactionClient, document: Document, warehouse: WarehouseLocation) {
    await tx.$queryRaw`SELECT id FROM purchases WHERE id = ${document.sourcePurchaseId} AND cafe_id = ${document.cafeId} FOR UPDATE`;
    const purchase = await this.sourcePurchase(tx, document.sourcePurchaseId!, warehouse);
    const prior = await tx.warehouseDocumentItem.findMany({ where: { cafeId: document.cafeId,
      document: { sourcePurchaseId: purchase.id, kind: 'supplier_return', status: 'posted' } } });
    for (const item of document.items) {
      const received = purchase.items.filter((line) => line.ingredientId === item.ingredientId).reduce((sum, line) => sum.add(line.quantityBase), zero);
      const returned = prior.filter((line) => line.ingredientId === item.ingredientId).reduce((sum, line) => sum.add(line.quantity ?? zero), zero);
      if (received.sub(returned).lt(item.quantity!)) throw new ConflictException(`Возврат «${item.name}» превышает количество исходного прихода`);
    }
  }

  private async saveLines(
    tx: Prisma.TransactionClient,
    warehouse: WarehouseLocation,
    document: Document,
    inputs: { ingredientId: string; quantity: number | null }[],
    recount: boolean,
  ) {
    const quantities = new Map(inputs.map(({ ingredientId, quantity }) => [ingredientId, quantity]));
    if (quantities.size !== inputs.length) throw new BadRequestException('Ингредиент указан несколько раз');
    const existing = new Map(document.items.map((item) => [item.ingredientId, item]));
    const full = document.mode === 'full';
    const ingredients = await this.lockCatalog(tx, warehouse, [...quantities.keys(), ...existing.keys()], full);
    const catalog = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
    for (const id of quantities.keys()) {
      if (!catalog.has(id)) throw new NotFoundException('Сырьё не найдено');
    }
    const countedAt = document.countedAt;
    const positions = countedAt && full ? ingredients.filter(({ createdAt, id }) =>
      createdAt <= countedAt || quantities.get(id) != null) : ingredients;
    const balances = await warehouseBalances(tx, warehouse, positions);
    const historicalPlan = countedAt ? await inventoryHistoricalPlan(tx, warehouse, positions, balances, countedAt) : null;
    const positionIds = positions.map(({ id }) => id);
    const used = full ? await this.usedIngredientIds(tx, warehouse, positionIds, countedAt) : new Set<string>();
    const generations = document.kind === 'inventory' ? await this.generations(tx, warehouse, positionIds) : new Map<string, number>();
    const rows: StockLine[] = [];
    for (const ingredient of positions) {
      const old = existing.get(ingredient.id);
      const input = quantities.get(ingredient.id);
      const balance = balances.get(ingredient.id)!;
      const expected = historicalPlan?.get(ingredient.id) ?? balance.stock;
      if (!full && input === undefined) continue;
      const keepEntered = countedAt ? input != null : old !== undefined || input !== undefined;
      if (full && expected.isZero() && !used.has(ingredient.id) && !keepEntered) continue;
      const unit = normalizeUnit(old?.unit ?? ingredient.displayUnit);
      assertUnitMatchesType(unit, ingredient.unitType);
      if (input === null && document.kind !== 'inventory') throw new BadRequestException('Укажите количество для каждой позиции');
      const quantity = input == null ? null : this.quantity(input, unit, document.kind);
      const generation = generations.get(ingredient.id) ?? 0;
      const snapshot = document.kind === 'inventory' && !recount ? old : null;
      const unitCost = balance.avgCost;
      const difference = quantity == null ? null : document.kind !== 'inventory'
        ? quantity.negated()
        : quantity.sub(expected);
      if (difference?.abs().gt(maxQuantity)) throw new BadRequestException('Расхождение вне допустимого диапазона');
      rows.push({
        ingredientId: ingredient.id, name: ingredient.name, unit, expected, quantity, difference, unitCost,
        costKnown: balance.valuationKnown,
        inventoryGeneration: document.kind === 'inventory'
          ? (snapshot?.inventoryGeneration ?? generation)
          : null,
      });
    }
    if (countedAt) await assertInventoryCutoff(tx, warehouse, document.id, rows.map(({ ingredientId }) => ingredientId), countedAt);
    await tx.warehouseDocumentItem.deleteMany({ where: { cafeId: document.cafeId, documentId: document.id } });
    if (rows.length) {
      await tx.warehouseDocumentItem.createMany({
        data: rows.map((row) => ({ cafeId: document.cafeId, documentId: document.id, ...row })),
      });
    }
  }

  private async validateLines(tx: Prisma.TransactionClient, document: Document) {
    if (!document.items.length) throw new BadRequestException('Добавьте хотя бы одну позицию');
    if (document.items.some((item) => item.quantity === null)) {
      throw new BadRequestException('Укажите фактический остаток для всех позиций, включая нулевые');
    }
    const warehouse = await this.warehouse(tx, document.warehouseId);
    const itemIds = new Set(document.items.map((item) => item.ingredientId));
    const catalog = await this.lockCatalog(tx, warehouse, [...itemIds], document.mode === 'full');
    if (document.kind === 'inventory' && await tx.warehouseDocument.findFirst({
      where: { cafeId: document.cafeId, warehouseId: warehouse.id, reopenedAt: { not: null } }, select: { id: true },
    })) {
      throw new ConflictException('Сначала проведите открытую на редактирование инвентаризацию этого склада');
    }
    const ingredients = new Map(catalog.map((ingredient) => [ingredient.id, ingredient]));
    for (const item of document.items) {
      const ingredient = ingredients.get(item.ingredientId);
      if (ingredient?.preparationMode === 'virtual') throw new BadRequestException('Заготовка без остатка не участвует в складских документах');
      if (!ingredient) throw new NotFoundException('Сырьё не найдено');
      assertUnitMatchesType(normalizeUnit(item.unit), ingredient.unitType);
    }
    const countedAt = document.countedAt;
    const positions = countedAt && document.mode === 'full' ? catalog.filter(({ id, createdAt }) =>
      createdAt <= countedAt || itemIds.has(id)) : catalog;
    if (countedAt) await assertInventoryCutoff(tx, warehouse, document.id, [...itemIds], countedAt);
    const balances = countedAt || document.mode === 'full' ? await warehouseBalances(tx, warehouse, positions) : null;
    const historicalPlan = countedAt && balances ? await inventoryHistoricalPlan(tx, warehouse, positions, balances, countedAt) : null;
    if (document.mode === 'full') {
      const used = await this.usedIngredientIds(tx, warehouse, positions.map(({ id }) => id), countedAt);
      const hasNewLine = positions.some((ingredient) =>
        !itemIds.has(ingredient.id) && (used.has(ingredient.id) || !(historicalPlan?.get(ingredient.id) ?? balances!.get(ingredient.id)!.stock).isZero()),
      );
      if (hasNewLine) throw new ConflictException('Состав склада изменился. Сохраните черновик и посчитайте новые продукты');
    }
    if (document.kind === 'inventory') {
      const generations = await this.generations(tx, warehouse, [...itemIds]);
      if (document.items.some((item) => item.inventoryGeneration !== (generations.get(item.ingredientId) ?? 0))) {
        throw new ConflictException('По этим позициям уже проведена другая инвентаризация. Пересчитайте остатки');
      }
    }
    return { warehouse, ingredients, historicalPlan };
  }

  private async usedIngredientIds(tx: Prisma.TransactionClient, warehouse: WarehouseLocation, ingredientIds: string[], cutoffAt?: Date | null) {
    if (!ingredientIds.length) return new Set<string>();
    const movements = await tx.stockMovement.findMany({
      where: { cafeId: warehouse.cafeId, ...warehouseDocumentFilter(warehouse), ingredientId: { in: ingredientIds },
        change: { not: 0 }, ...(cutoffAt ? { createdAt: { lt: cutoffAt } } : {}) },
      select: { ingredientId: true }, distinct: ['ingredientId'],
    });
    return new Set(movements.map(({ ingredientId }) => ingredientId));
  }

  /** Draft counts are preserved while the preview follows the current book stock.
   * Posted/reversed documents keep the immutable values captured at approval. */
  private async preview(tx: Prisma.TransactionClient, document: Document, includeInventoryContext = false,
    inventoryIngredientId?: string): Promise<ReturnType<WarehouseDocumentsService['serialize']> & {
      reversalBlockedReason?: string;
      inventoryContext?: Awaited<ReturnType<typeof inventoryPeriodContext>>;
    }> {
    const reversalBlockedReason = await this.reversalBlockedReason(tx, document);
    const serialize = (value: Document) => ({ ...this.serialize(value), ...(reversalBlockedReason ? { reversalBlockedReason } : {}) });
    const snapshot = readWriteoffSnapshot(document.sourceLines);
    if (snapshot && ['draft', 'submitted'].includes(document.status)) {
      const valuation = await previewWriteoffSources(tx, await this.warehouse(tx, document.warehouseId), snapshot);
      return { ...serialize(document), sourceLines: valuation.sourceLines, sourceTotal: valuation.total };
    }
    if (document.kind !== 'inventory') return serialize(document);
    if (document.reopenedAt) {
      const warehouse = await this.warehouse(tx, document.warehouseId);
      const cutoffAt = document.countedAt ?? document.postedAt!;
      document = { ...document, items: document.items.map((item) => {
        const quantity = item.reopenedQuantity ?? item.quantity;
        return { ...item, quantity, difference: quantity && item.expected ? quantity.sub(item.expected) : null };
      }) };
      return { ...serialize(document), ...(includeInventoryContext
        ? { inventoryContext: await inventoryPeriodContext(tx, warehouse, document.id, document.items, cutoffAt, inventoryIngredientId) } : {}) };
    }
    const draft = document.status === 'draft' || document.status === 'submitted';
    const cutoffAt = document.countedAt ?? (draft ? new Date() : document.postedAt);
    if (!draft && (!includeInventoryContext || !cutoffAt)) return serialize(document);
    const warehouse = await this.warehouse(tx, document.warehouseId);
    if (draft) {
      const ingredients = await tx.ingredient.findMany({ where: { cafeId: document.cafeId, id: { in: document.items.map(({ ingredientId }) => ingredientId) } } });
      const balances = await warehouseBalances(tx, warehouse, ingredients);
      const historicalPlan = document.countedAt ? await inventoryHistoricalPlan(tx, warehouse, ingredients, balances, document.countedAt) : null;
      document = { ...document, items: document.items.map((item) => {
        const balance = balances.get(item.ingredientId);
        if (!balance) return item;
        const expected = historicalPlan?.get(item.ingredientId) ?? balance.stock;
        return { ...item, expected, difference: item.quantity?.sub(expected) ?? null,
          unitCost: balance.avgCost, costKnown: balance.valuationKnown };
      }) };
    }
    const serialized = serialize(document);
    if (!includeInventoryContext || !cutoffAt) return serialized;
    return { ...serialized, inventoryContext: await inventoryPeriodContext(tx, warehouse, document.id, document.items, cutoffAt, inventoryIngredientId) };
  }

  private async reversalBlockedReason(tx: Prisma.TransactionClient, document: Document) {
    return (await this.reversalPeriod(tx, document)).blocked;
  }

  private async reversalPeriod(tx: Prisma.TransactionClient, document: Document) {
    if (document.status !== 'posted' || !document.postedAt) return { blocked: null, historical: false };
    const warehouseIds = [document.warehouseId, ...(document.destinationWarehouseId ? [document.destinationWarehouseId] : [])];
    const itemIds = document.items.filter((item) => item.quantity !== null).map(({ ingredientId }) => ingredientId);
    const effectiveAt = document.countedAt ?? document.effectiveAt ?? document.postedAt;
    const blocked = await inventoryReversalBlockedReason(tx, document.cafeId, effectiveAt,
      warehouseIds.flatMap((warehouseId) => itemIds.map((ingredientId) => ({ warehouseId, ingredientId }))), document.id);
    if (blocked && document.kind !== 'inventory') {
      const periods = await nextInventoryPeriods(tx, document.cafeId, effectiveAt, warehouseIds, itemIds);
      if (periods.length && periods.every(({ document: count }) => count.reopenedAt)) return { blocked: null, historical: true };
    }
    return { blocked, historical: false };
  }

  private async validateSourceSnapshot(tx: Prisma.TransactionClient, document: Document) {
    const snapshot = readWriteoffSnapshot(document.sourceLines);
    if (!snapshot) return;
    await lockRecipeGraph(tx, true);
    await resolveWriteoffSources(tx, await this.warehouse(tx, document.warehouseId), sourceInputs(snapshot), true, false, snapshot, document.effectiveAt);
  }

  private async lockCatalog(tx: Prisma.TransactionClient, warehouse: WarehouseLocation, ids: string[], full: boolean) {
    if (full) await lockWarehouseCatalog(tx, warehouse.cafeId);
    const where = { cafeId: warehouse.cafeId, ...(full ? { preparationMode: { not: 'virtual' } } : { id: { in: ids } }) };
    const candidates = full ? await tx.ingredient.findMany({ where, select: { id: true } }) : ids.map((id) => ({ id }));
    await lockIngredients(tx, candidates.map(({ id }) => id));
    return tx.ingredient.findMany({
      where: { cafeId: warehouse.cafeId, id: { in: candidates.map(({ id }) => id) } },
    });
  }

  private async generations(tx: Prisma.TransactionClient, warehouse: WarehouseLocation, ingredientIds: string[]) {
    if (!ingredientIds.length) return new Map<string, number>();
    const rows = await tx.warehouseDocumentItem.groupBy({
      by: ['ingredientId'],
      where: {
        cafeId: warehouse.cafeId, ingredientId: { in: ingredientIds },
        document: { warehouseId: warehouse.id, kind: 'inventory',
          OR: [{ status: { in: ['posted', 'reversed'] } }, { reopenedAt: { not: null } }] },
      },
      _count: { _all: true },
    });
    return new Map(rows.map(({ ingredientId, _count }) => [ingredientId, _count._all]));
  }

  private async warehouse(tx: Prisma.TransactionClient, warehouseId: string) {
    this.cafeId();
    const warehouse = await resolveWarehouse(tx, warehouseId);
    if (!warehouse) throw new NotFoundException('Склад не найден');
    return warehouse;
  }

  private async load(tx: Prisma.TransactionClient, id: string, includeDeletedWriteoffs = false) {
    const document = await tx.warehouseDocument.findUnique({
      where: { id, cafeId: this.cafeId(), ...(includeDeletedWriteoffs
        ? { OR: [{ deletedAt: null }, { kind: 'writeoff' as const }] }
        : { deletedAt: null }) }, include: documentInclude,
    });
    if (!document) throw new NotFoundException('Складской документ не найден');
    return document;
  }

  private async lockDocument(tx: Prisma.TransactionClient, id: string, revision: number | undefined,
    status: WarehouseDocument['status'] | WarehouseDocument['status'][], includeDeletedWriteoffs = false) {
    const cafeId = this.cafeId();
    await tx.$queryRaw`SELECT id FROM warehouse_documents WHERE id = ${id} AND cafe_id = ${cafeId} FOR UPDATE`;
    const document = await this.load(tx, id, includeDeletedWriteoffs);
    const statuses = Array.isArray(status) ? status : [status];
    if ((revision !== undefined && document.revision !== revision) || !statuses.includes(document.status)) {
      throw new ConflictException('Документ уже изменился. Обновите данные');
    }
    return document;
  }

  private cafeId() {
    const cafeId = getCafeId();
    if (!cafeId) throw new ForbiddenException('Заведение не назначено');
    return cafeId;
  }

  private assertActor(actor: Actor, ownerOnly = false) {
    const cafeId = this.cafeId();
    if (actor.cafeId !== cafeId || (actor.role !== Role.OWNER && (ownerOnly ? !(actor.permissions?.actions as Record<string, boolean> | undefined)?.warehouseApprove : actor.role !== Role.ADMIN))) {
      throw new ForbiddenException(ownerOnly ? 'Подтверждение доступно только владельцу' : 'Нет доступа к складскому документу');
    }
    return cafeId;
  }

  private async reason(tx: Prisma.TransactionClient, kind: WarehouseDocumentKind,
    reason?: WarehouseWriteoffReason | null, writeoffReasonId?: string | null,
    previous?: Pick<WarehouseDocument, 'reason' | 'writeoffReasonId'>) {
    if ((kind !== 'writeoff' && (reason != null || writeoffReasonId != null))
      || (reason != null && (writeoffReasonId != null || !Object.prototype.hasOwnProperty.call(warehouseWriteoffReasons, reason)))) {
      throw new BadRequestException('Выберите допустимую причину списания');
    }
    if (reason != null && reason !== previous?.reason && await tx.settings.findFirst({
      where: { cafeId: this.cafeId(), archivedBuiltinWriteoffReasons: { has: reason } },
      select: { id: true },
    })) throw new BadRequestException('Причина списания недоступна');
    if (writeoffReasonId != null && !(await tx.writeoffReason.findUnique({
      where: {
        cafeId_id: { cafeId: this.cafeId(), id: writeoffReasonId },
        ...(writeoffReasonId === previous?.writeoffReasonId ? {} : { archivedAt: null }),
      },
      select: { id: true },
    }))) throw new BadRequestException('Причина списания недоступна');
    return { reason: reason ?? null, writeoffReasonId: writeoffReasonId ?? null };
  }

  private reasonLabel(document: DocumentWithReason) {
    return document.writeoffReason?.name ?? (document.reason ? warehouseWriteoffReasons[document.reason] : null);
  }

  private quantity(value: number, unit: UnitCode, kind: WarehouseDocumentKind) {
    if (!Number.isFinite(value) || value < 0) throw new BadRequestException('Укажите корректное количество');
    const base = toBase(value, unit);
    if (!Number.isFinite(base) || base > Number(maxQuantity)) throw new BadRequestException('Количество вне допустимого диапазона');
    const quantity = new Prisma.Decimal(base).toDecimalPlaces(3);
    if (kind !== 'inventory' && quantity.isZero()) throw new BadRequestException('Количество списания должно быть больше нуля');
    return quantity;
  }

  private summary(document: DocumentWithReason, itemsCount: number, variance: Prisma.Decimal | null) {
    return {
      id: document.id, warehouseId: document.warehouseId, kind: document.kind, mode: document.mode,
      reason: document.reason, writeoffReasonId: document.writeoffReasonId, reasonLabel: this.reasonLabel(document),
      note: document.note, status: document.status, revision: document.revision,
      destinationWarehouseId: document.destinationWarehouseId, sourcePurchaseId: document.sourcePurchaseId,
      reversedAt: document.reversedAt, reversedByName: document.reversedByName, reversalReason: document.reversalReason,
      createdAt: document.createdAt, submittedAt: document.submittedAt, postedAt: document.postedAt, reopenedAt: document.reopenedAt, deletedAt: document.deletedAt,
      countedAt: document.countedAt ?? (document.reopenedAt ? document.postedAt : null), effectiveAt: document.effectiveAt,
      createdByName: document.createdByName, submittedByName: document.submittedByName, postedByName: document.postedByName,
      itemsCount,
      varianceValue: variance == null ? null : Number(variance.toDecimalPlaces(2)),
    };
  }

  private serialize(document: Document) {
    const items = document.items;
    const snapshot = readWriteoffSnapshot(document.sourceLines);
    const sources = snapshot ? serializeWriteoffSources(snapshot, new Map(items.map((item) => [item.ingredientId, {
      cost: item.costKnown ? item.unitCost : null,
    }]))) : null;
    const variance = items.some((item) => !item.costKnown && item.difference && !item.difference.isZero()) ? null : items.reduce((sum: Prisma.Decimal | null, item) =>
      item.difference == null || item.unitCost == null ? sum : (sum ?? zero).add(item.difference.mul(item.unitCost)), null);
    return {
      ...this.summary(document, items.length, variance),
      ...(sources ? { sourceLines: sources.sourceLines, sourceTotal: sources.total } : {}),
      items: items.map((item) => {
        const unit = normalizeUnit(item.unit);
        const display = (value: Prisma.Decimal | null) => value == null ? null : fromBase(Number(value), unit);
        return {
          ingredientId: item.ingredientId, name: item.name, unit: unitLabel(unit), expected: display(item.expected),
          quantity: display(item.quantity), difference: display(item.difference),
          costKnown: item.costKnown,
          unitCost: item.unitCost == null || !item.costKnown ? null : costFromBase(Number(item.unitCost), unit),
          value: item.difference == null || item.unitCost == null || !item.costKnown ? null : Number(item.difference.mul(item.unitCost).toDecimalPlaces(2)),
        };
      }),
    };
  }
}
