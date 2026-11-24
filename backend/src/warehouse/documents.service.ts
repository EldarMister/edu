import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, WarehouseDocument, WarehouseDocumentItem, WarehouseDocumentKind } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { getCafeId } from '../tenant/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWarehouseDocumentDto, UpdateWarehouseDocumentDto, WriteoffPreviewDto, warehouseWriteoffReasons } from './documents.dto';
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
import { previewWriteoffSources, readWriteoffSnapshot, resolveWriteoffSources, serializeWriteoffSources, sourceInputs, writeoffStockLines } from './writeoff-resolution';

type Actor = Pick<AuthUser, 'id' | 'role' | 'name' | 'cafeId'> & Partial<Pick<AuthUser, 'permissions'>>;
type Document = WarehouseDocument & { items: WarehouseDocumentItem[] };
type StockLine = Omit<WarehouseDocumentItem, 'documentId' | 'cafeId' | 'reopenedQuantity'>;
const documentInclude = { items: { orderBy: [{ name: 'asc' }, { ingredientId: 'asc' }] } } satisfies Prisma.WarehouseDocumentInclude;
const maxQuantity = new Prisma.Decimal('99999999999.999');
const zero = new Prisma.Decimal(0);
const inventoryCostReset = 'inventory_zero_cost';
const transactionOptions = { timeout: 30_000 };

function documentEffectiveAt(kind: WarehouseDocumentKind, value: string | null | undefined) {
  if (value != null && kind !== 'transfer' && kind !== 'writeoff') {
    throw new BadRequestException('Складская дата доступна для перемещений и списаний');
  }
  return parseStockEffectiveAt(value);
}

@Injectable()
export class WarehouseDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(warehouseId?: string, kind?: WarehouseDocumentKind, search?: string) {
    const cafeId = this.cafeId();
    if (warehouseId !== undefined) await this.warehouse(this.prisma, warehouseId);
    const text = search?.trim();
    const sourceMatches = text && (kind === undefined || kind === 'writeoff')
      ? await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT d.id FROM warehouse_documents d
        WHERE d.cafe_id = ${cafeId} AND d.kind = 'writeoff'
        ${warehouseId === undefined ? Prisma.empty : Prisma.sql`AND d.warehouse_id = ${warehouseId}`}
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.source_lines->'lines') = 'array'
            THEN d.source_lines->'lines' ELSE '[]'::jsonb END) AS source_line
          WHERE strpos(lower(source_line->>'name'), lower(${text})) > 0
        )
      ` : [];
    const where: Prisma.WarehouseDocumentWhereInput = { cafeId, kind,
      ...(kind === 'transfer' && warehouseId ? { OR: [{ warehouseId }, { destinationWarehouseId: warehouseId }] } : { warehouseId }),
      ...(text ? { AND: [{ OR: [
        { note: { contains: text, mode: 'insensitive' } },
        { createdByName: { contains: text, mode: 'insensitive' } },
        { postedByName: { contains: text, mode: 'insensitive' } },
        { items: { some: { name: { contains: text, mode: 'insensitive' } } } },
        ...(sourceMatches.length ? [{ id: { in: sourceMatches.map(({ id }) => id) } }] : []),
      ] }] } : {}),
    };
    const [documents, totals] = await this.prisma.$transaction([
      this.prisma.warehouseDocument.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { items: { select: { name: true, ingredientId: true }, orderBy: [{ name: 'asc' }, { ingredientId: 'asc' }] } },
      }),
      this.prisma.$queryRaw<Array<{ id: string; itemsCount: number; varianceValue: Prisma.Decimal | null }>>`
        SELECT d.id, COUNT(i.ingredient_id)::int AS "itemsCount",
          CASE WHEN (d.kind = 'inventory' OR d.effective_at IS NOT NULL) AND d.status IN ('draft', 'submitted') THEN NULL
            WHEN BOOL_AND(i.cost_known OR i.difference = 0) THEN ROUND(SUM(i.difference * i.unit_cost), 2) ELSE NULL END AS "varianceValue"
        FROM warehouse_documents d
        LEFT JOIN warehouse_document_items i ON i.cafe_id = d.cafe_id AND i.document_id = d.id
        WHERE d.cafe_id = ${cafeId}
        ${warehouseId === undefined ? Prisma.empty : kind === 'transfer'
          ? Prisma.sql`AND (d.warehouse_id = ${warehouseId} OR d.destination_warehouse_id = ${warehouseId})`
          : Prisma.sql`AND d.warehouse_id = ${warehouseId}`}
        ${kind === undefined ? Prisma.empty : Prisma.sql`AND d.kind = ${kind}::"WarehouseDocumentKind"`}
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
        select: { id: true, category: true } }),
      this.prisma.dish.findMany({ where: { cafeId, id: { in: [...new Set(categorySources.filter(({ kind }) => kind === 'dish').map(({ sourceId }) => sourceId))] } },
        select: { id: true, category: { select: { name: true } } } }),
    ]);
    const ingredientCategories = new Map(categoryIngredients.map(({ id, category }) => [id, category]));
    const dishCategories = new Map(categoryDishes.map(({ id, category }) => [id, category.name]));
    const byId = new Map(totals.map(({ id, ...summary }) => [id, summary]));
    return documents.map((document) => {
      const summary = byId.get(document.id);
      const sources = readWriteoffSnapshot(document.sourceLines);
      const categories = sources
        ? sources.lines.map(({ kind, sourceId }) => (kind === 'dish' ? dishCategories : ingredientCategories).get(sourceId))
        : document.items.map(({ ingredientId }) => ingredientCategories.get(ingredientId));
      return { ...this.summary(document, sources?.lines.length ?? summary?.itemsCount ?? 0, summary?.varianceValue ?? null),
        categories: [...new Set(categories.filter((category): category is string => !!category))].sort((a, b) => a.localeCompare(b, 'ru')),
        productNames: sources ? sources.lines.slice(0, 3).map((line) => line.name) : document.items.slice(0, 3).map((item) => item.name) };
    });
  }

  async writeoffOptions() {
    const cafeId = this.cafeId();
    const [ingredients, dishes] = await Promise.all([
      this.prisma.ingredient.findMany({ where: { cafeId, isActive: true }, orderBy: { name: 'asc' },
        select: { id: true, name: true, category: true, displayUnit: true, kind: true, preparationMode: true } }),
      this.prisma.dish.findMany({ where: { cafeId, isActive: true, isSet: false, catalogKind: { not: 'goods' } }, orderBy: { name: 'asc' },
        select: { id: true, name: true, isWeighted: true, category: { select: { name: true } }, variants: { select: { id: true, name: true } } } }),
    ]);
    return { ingredients: ingredients.map(({ displayUnit, ...item }) => ({ ...item, unit: unitLabel(normalizeUnit(displayUnit)), unitCode: displayUnit })),
      dishes: dishes.map(({ category, ...dish }) => ({ ...dish, category: category.name, unitCode: dish.isWeighted ? 'g' : 'pcs' })) };
  }

  async writeoffPreview(dto: WriteoffPreviewDto) {
    return this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx, true);
      const warehouse = await this.warehouse(tx, dto.warehouseId);
      const saved = dto.documentId ? await this.load(tx, dto.documentId) : null;
      if (saved && (saved.kind !== 'writeoff' || saved.warehouseId !== warehouse.id))
        throw new BadRequestException('Черновик должен относиться к списанию на выбранном складе');
      const snapshot = await resolveWriteoffSources(tx, warehouse, dto.sourceLines, false, true, readWriteoffSnapshot(saved?.sourceLines ?? null));
      return previewWriteoffSources(tx, warehouse, snapshot);
    }, { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async get(id: string, includeInventoryContext = false, inventoryIngredientId?: string) {
    return this.prisma.$transaction(async (tx) => this.preview(tx, await this.load(tx, id), includeInventoryContext, inventoryIngredientId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
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
          if (existing.kind !== dto.kind || existing.warehouseId !== dto.warehouseId || existing.destinationWarehouseId !== (dto.destinationWarehouseId ?? null) || existing.sourcePurchaseId !== (dto.sourcePurchaseId ?? null)
            || (countedAt !== undefined && existing.countedAt?.getTime() !== countedAt?.getTime())
            || existing.effectiveAt?.getTime() !== effectiveAt?.getTime()) {
            throw new ConflictException('Ключ повторного запроса уже использован для другого документа');
          }
          if (dto.sourceLines) {
            const snapshot = readWriteoffSnapshot(existing.sourceLines);
            if (!snapshot || snapshot.lines.length !== dto.sourceLines.length || dto.sourceLines.some((input) => {
              const saved = snapshot.lines.find((line) => line.sourceLineId === input.sourceLineId);
              return !saved || saved.kind !== input.kind || saved.sourceId !== input.sourceId || saved.variantId !== input.variantId
                || saved.quantity !== input.quantity || saved.unit !== normalizeUnit(input.unit ?? saved.unit)
                || saved.packageId !== input.packageId
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
          reason: this.reason(dto.kind, dto.reason), note: dto.note?.trim() || null,
          destinationWarehouseId: dto.destinationWarehouseId, sourcePurchaseId: dto.sourcePurchaseId, requestKey: dto.requestKey,
          createdById: actor.id, createdByName: actor.name,
        },
        include: documentInclude,
      });
      let inputs = dto.items ?? [];
      if (dto.sourceLines) {
        await lockRecipeGraph(tx, true);
        const snapshot = await resolveWriteoffSources(tx, warehouse, dto.sourceLines, !!dto.finalize, !dto.finalize);
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
      if (dto.sourceLines) {
        await lockRecipeGraph(tx, true);
        const snapshot = await resolveWriteoffSources(tx, warehouse, dto.sourceLines, !!dto.finalize, !dto.finalize, readWriteoffSnapshot(document.sourceLines));
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
          reason: dto.reason === undefined ? undefined : this.reason(document.kind, dto.reason),
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
    if (document.kind === 'writeoff') {
      if (!document.reason) throw new BadRequestException('Укажите причину списания');
      if (document.reason === 'other' && !document.note) throw new BadRequestException('Опишите причину списания в комментарии');
    }
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
      || dto.recount || dto.effectiveAt != null || dto.sourceLines || dto.reason != null) {
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
      const comment = kind === 'writeoff' ? [warehouseWriteoffReasons[document.reason!], document.note].filter(Boolean).join(' · ') : document.note;
      const source = await postStockMovement(tx, { ingredientId: item.ingredientId, warehouse, change: difference,
        costKnown: difference.gt(0) ? balance.valuationKnown : undefined,
        carriedAverage: resetCost ? zero : undefined,
        allowNegative: effectiveAt || kind === 'transfer' ? true : undefined,
        movement: { ...dateEvidence, type: kind, sourceType: kind, sourceId: id, actorId: actor.id, actorName: actor.name,
          reason: document.reason, comment,
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
            comment: `Сторно: ${note.trim()}`, reason: 'reversal',
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
    }, transactionOptions);
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
  private async preview(tx: Prisma.TransactionClient, document: Document, includeInventoryContext = false, inventoryIngredientId?: string) {
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
    await resolveWriteoffSources(tx, await this.warehouse(tx, document.warehouseId), sourceInputs(snapshot), true, false, snapshot);
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

  private async load(tx: Prisma.TransactionClient, id: string) {
    const document = await tx.warehouseDocument.findUnique({
      where: { id, cafeId: this.cafeId() }, include: documentInclude,
    });
    if (!document) throw new NotFoundException('Складской документ не найден');
    return document;
  }

  private async lockDocument(tx: Prisma.TransactionClient, id: string, revision: number | undefined, status: WarehouseDocument['status'] | WarehouseDocument['status'][]) {
    const cafeId = this.cafeId();
    await tx.$queryRaw`SELECT id FROM warehouse_documents WHERE id = ${id} AND cafe_id = ${cafeId} FOR UPDATE`;
    const document = await this.load(tx, id);
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

  private reason(kind: WarehouseDocumentKind, reason?: keyof typeof warehouseWriteoffReasons | null) {
    if (reason == null) return null;
    if (kind !== 'writeoff' || !Object.prototype.hasOwnProperty.call(warehouseWriteoffReasons, reason)) {
      throw new BadRequestException('Выберите допустимую причину списания');
    }
    return reason;
  }

  private quantity(value: number, unit: UnitCode, kind: WarehouseDocumentKind) {
    if (!Number.isFinite(value) || value < 0) throw new BadRequestException('Укажите корректное количество');
    const base = toBase(value, unit);
    if (!Number.isFinite(base) || base > Number(maxQuantity)) throw new BadRequestException('Количество вне допустимого диапазона');
    const quantity = new Prisma.Decimal(base).toDecimalPlaces(3);
    if (kind !== 'inventory' && quantity.isZero()) throw new BadRequestException('Количество списания должно быть больше нуля');
    return quantity;
  }

  private summary(document: WarehouseDocument, itemsCount: number, variance: Prisma.Decimal | null) {
    return {
      id: document.id, warehouseId: document.warehouseId, kind: document.kind, mode: document.mode,
      reason: document.reason, note: document.note, status: document.status, revision: document.revision,
      destinationWarehouseId: document.destinationWarehouseId, sourcePurchaseId: document.sourcePurchaseId,
      reversedAt: document.reversedAt, reversedByName: document.reversedByName, reversalReason: document.reversalReason,
      createdAt: document.createdAt, submittedAt: document.submittedAt, postedAt: document.postedAt, reopenedAt: document.reopenedAt,
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
