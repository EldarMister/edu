import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, WarehouseDocument, WarehouseDocumentItem, WarehouseDocumentKind } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { getCafeId } from '../tenant/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWarehouseDocumentDto, UpdateWarehouseDocumentDto, WriteoffPreviewDto, warehouseWriteoffReasons } from './documents.dto';
import { postStockMovement } from './stock-posting';
import { lockIngredients, lockWarehouseCatalog } from './stock-lock';
import { assertUnitMatchesType, costFromBase, fromBase, normalizeUnit, toBase, UnitCode, unitLabel } from './units';
import { getWarehouseBalance, resolveWarehouse, warehouseBalances, warehouseDocumentFilter, WarehouseLocation } from './warehouse-location';
import { lockRecipeGraph } from './recipe-resolution';
import { previewWriteoffSources, readWriteoffSnapshot, resolveWriteoffSources, serializeWriteoffSources, sourceInputs, writeoffStockLines } from './writeoff-resolution';

type Actor = Pick<AuthUser, 'id' | 'role' | 'name' | 'cafeId'> & Partial<Pick<AuthUser, 'permissions'>>;
type Document = WarehouseDocument & { items: WarehouseDocumentItem[] };
type StockLine = Omit<WarehouseDocumentItem, 'documentId' | 'cafeId'>;
const documentInclude = { items: { orderBy: [{ name: 'asc' }, { ingredientId: 'asc' }] } } satisfies Prisma.WarehouseDocumentInclude;
const maxQuantity = new Prisma.Decimal('99999999999.999');
const zero = new Prisma.Decimal(0);
const transactionOptions = { timeout: 30_000 };

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
        include: { items: { select: { name: true }, orderBy: [{ name: 'asc' }, { ingredientId: 'asc' }], take: 3 } },
      }),
      this.prisma.$queryRaw<Array<{ id: string; itemsCount: number; varianceValue: Prisma.Decimal | null }>>`
        SELECT d.id, COUNT(i.ingredient_id)::int AS "itemsCount",
          CASE WHEN d.kind = 'inventory' AND d.status IN ('draft', 'submitted') THEN NULL
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
    const byId = new Map(totals.map(({ id, ...summary }) => [id, summary]));
    return documents.map((document) => {
      const summary = byId.get(document.id);
      const sources = readWriteoffSnapshot(document.sourceLines);
      return { ...this.summary(document, sources?.lines.length ?? summary?.itemsCount ?? 0, summary?.varianceValue ?? null),
        productNames: sources ? sources.lines.slice(0, 3).map((line) => line.name) : document.items.map((item) => item.name) };
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
      const snapshot = await resolveWriteoffSources(tx, warehouse, dto.sourceLines, false, true);
      return previewWriteoffSources(tx, warehouse, snapshot);
    }, { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async get(id: string) {
    return this.prisma.$transaction(async (tx) => this.preview(tx, await this.load(tx, id)),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async create(actor: Actor, dto: CreateWarehouseDocumentDto) {
    const cafeId = this.assertActor(actor);
    if (!['inventory', 'writeoff', 'transfer', 'supplier_return'].includes(dto.kind)) throw new BadRequestException('Выберите тип документа');
    if (dto.kind === 'inventory' && dto.mode !== 'full' && dto.mode !== 'partial') {
      throw new BadRequestException('Выберите вид инвентаризации');
    }
    if (dto.kind !== 'inventory' && dto.mode != null) throw new BadRequestException('Вид инвентаризации неприменим к списанию');
    if (dto.sourceLines && (dto.kind !== 'writeoff' || dto.items)) throw new BadRequestException('Составные строки доступны только для списания и заменяют список ингредиентов');
    return this.prisma.$transaction(async (tx) => {
      if (dto.requestKey) {
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`warehouse-request:${cafeId}:${dto.requestKey}`}))) AS request_lock`;
        const existing = await tx.warehouseDocument.findUnique({ where: { cafeId_requestKey: { cafeId, requestKey: dto.requestKey } }, include: documentInclude });
        if (existing) {
          if (existing.kind !== dto.kind || existing.warehouseId !== dto.warehouseId || existing.destinationWarehouseId !== (dto.destinationWarehouseId ?? null) || existing.sourcePurchaseId !== (dto.sourcePurchaseId ?? null)) {
            throw new ConflictException('Ключ повторного запроса уже использован для другого документа');
          }
          if (dto.sourceLines) {
            const snapshot = readWriteoffSnapshot(existing.sourceLines);
            if (!snapshot || snapshot.lines.length !== dto.sourceLines.length || dto.sourceLines.some((input) => {
              const saved = snapshot.lines.find((line) => line.sourceLineId === input.sourceLineId);
              return !saved || saved.kind !== input.kind || saved.sourceId !== input.sourceId || saved.variantId !== input.variantId
                || saved.quantity !== input.quantity || saved.unit !== normalizeUnit(input.unit ?? saved.unit)
                || (input.recipeSignature && saved.recipeSignature !== input.recipeSignature);
            })) {
              throw new ConflictException('Ключ повторного запроса уже использован для другого состава списания');
            }
          }
          if (dto.items && dto.kind !== 'inventory' && (dto.items.length !== existing.items.length || dto.items.some((line) => {
            const saved = existing.items.find((item) => item.ingredientId === line.ingredientId);
            return line.quantity === null || !saved?.quantity?.eq(new Prisma.Decimal(toBase(line.quantity, normalizeUnit(saved.unit))).toDecimalPlaces(3));
          }))) throw new ConflictException('Ключ повторного запроса уже использован с другими позициями');
          return this.finalize(tx, actor, existing.id, dto.finalize);
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
          cafeId, warehouseId: warehouse.id, kind: dto.kind, mode: dto.mode ?? null,
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
      const warehouse = await this.warehouse(tx, document.warehouseId);
      if (dto.sourceLines && (document.kind !== 'writeoff' || dto.items)) throw new BadRequestException('Составные строки доступны только для списания и заменяют список ингредиентов');
      if (document.sourceLines && dto.items) throw new BadRequestException('Сохраните исходные строки списания, а не рассчитанные ингредиенты');
      if (dto.recount && document.kind !== 'inventory') throw new BadRequestException('Пересчёт доступен только для инвентаризации');
      if (dto.sourceLines) {
        await lockRecipeGraph(tx, true);
        const snapshot = await resolveWriteoffSources(tx, warehouse, dto.sourceLines, !!dto.finalize, !dto.finalize);
        const items = await writeoffStockLines(tx, snapshot, document.items);
        await this.saveLines(tx, warehouse, document, items, false);
        await tx.warehouseDocument.update({ where: { id }, data: { sourceLines: snapshot as unknown as Prisma.InputJsonValue } });
      } else if (dto.items || dto.recount) {
        const items = dto.items ?? document.items.map((item) => ({
          ingredientId: item.ingredientId,
          quantity: item.quantity == null ? null : fromBase(Number(item.quantity), normalizeUnit(item.unit)),
        }));
        await this.saveLines(tx, warehouse, document, items, dto.recount === true);
      }
      await tx.warehouseDocument.update({
        where: { id, cafeId: document.cafeId },
        data: {
          revision: { increment: 1 },
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
      const document = await this.lockDocument(tx, id, revision, 'submitted');
      return this.preview(tx, await tx.warehouseDocument.update({
        where: { id, cafeId: document.cafeId },
        data: { status: 'draft', revision: { increment: 1 } },
        include: documentInclude,
      }));
    }, transactionOptions);
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
    const { warehouse, ingredients } = await this.validateLines(tx, document);
    const kind = document.kind;
    const destination = kind === 'transfer' ? await this.warehouse(tx, document.destinationWarehouseId!) : null;
    for (const item of document.items) {
      const ingredient = ingredients.get(item.ingredientId)!;
      const balance = await getWarehouseBalance(tx, warehouse, ingredient);
      // Counts describe the physical stock at confirmation, not at draft creation.
      // Re-read under the ingredient lock so receipts/sales cannot be counted twice.
      const difference = kind === 'inventory' ? item.quantity!.sub(balance.stock) : item.quantity!.negated();
      if (difference.abs().gt(maxQuantity)) throw new BadRequestException('Расхождение вне допустимого диапазона');
      await tx.warehouseDocumentItem.update({
        where: { documentId_ingredientId: { documentId: id, ingredientId: item.ingredientId }, cafeId: document.cafeId },
        data: { expected: balance.stock, difference, unitCost: balance.avgCost,
          costKnown: balance.valuationKnown && (difference.gte(0) || balance.stock.gte(difference.abs())) },
      });
      if (difference.isZero()) continue;
      const comment = kind === 'writeoff' ? [warehouseWriteoffReasons[document.reason!], document.note].filter(Boolean).join(' · ') : document.note;
      const source = await postStockMovement(tx, { ingredientId: item.ingredientId, warehouse, change: difference,
        costKnown: difference.gt(0) ? balance.valuationKnown : undefined,
        movement: { type: kind, sourceType: kind, sourceId: id, actorId: actor.id, actorName: actor.name, reason: document.reason, comment,
          ...(document.sourceLines ? { recipeSnapshot: document.sourceLines as Prisma.InputJsonValue } : {}) } });
      if (destination) await postStockMovement(tx, { ingredientId: item.ingredientId, warehouse: destination,
        change: difference.negated(), cost: balance.avgCost, costKnown: source.movement.costKnown, valuation: 'average',
        movement: { type: 'transfer', sourceType: 'transfer', sourceId: id, actorId: actor.id, actorName: actor.name, comment } });
    }
    return this.serialize(await tx.warehouseDocument.update({
      where: { id, cafeId: document.cafeId },
      data: {
        status: 'posted', revision: { increment: 1 }, postedAt: new Date(),
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
      const movements = await tx.stockMovement.findMany({ where: { cafeId: document.cafeId, sourceId: id, sourceType: document.kind }, orderBy: { createdAt: 'desc' } });
      await lockIngredients(tx, document.items.map((item) => item.ingredientId));
      // Reverse withdrawals before receipts, so both sides of a transfer remain atomic.
      for (const movement of movements.sort((a, b) => Number(b.change) - Number(a.change))) {
        const warehouse = await this.warehouse(tx, movement.warehouseId!);
        await postStockMovement(tx, { ingredientId: movement.ingredientId, warehouse, change: movement.change.negated(),
          cost: movement.costAtMoment, costKnown: movement.costKnown, valuation: movement.change.lt(0) ? 'average' : 'value',
          movement: { type: 'cancel', sourceType: document.kind, sourceId: id, actorId: actor.id, actorName: actor.name,
            comment: `Сторно: ${note.trim()}`, reason: 'reversal',
            ...(movement.recipeSnapshot ? { recipeSnapshot: movement.recipeSnapshot as Prisma.InputJsonValue } : {}) } });
      }
      return this.serialize(await tx.warehouseDocument.update({ where: { id, cafeId: document.cafeId },
        data: { status: 'reversed', revision: { increment: 1 }, reversedAt: new Date(), reversedById: actor.id,
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
    const balances = await warehouseBalances(tx, warehouse, ingredients);
    const used = full ? await this.usedIngredientIds(tx, warehouse, ingredients.map(({ id }) => id)) : new Set<string>();
    const generations = document.kind === 'inventory' ? await this.generations(tx, warehouse, ingredients.map(({ id }) => id)) : new Map<string, number>();
    const rows: StockLine[] = [];
    for (const ingredient of ingredients) {
      const old = existing.get(ingredient.id);
      const input = quantities.get(ingredient.id);
      const balance = balances.get(ingredient.id)!;
      if (!full && input === undefined) continue;
      if (full && balance.stock.isZero() && !used.has(ingredient.id) && !old && input === undefined) continue;
      const unit = normalizeUnit(old?.unit ?? ingredient.displayUnit);
      assertUnitMatchesType(unit, ingredient.unitType);
      if (input === null && document.kind !== 'inventory') throw new BadRequestException('Укажите количество для каждой позиции');
      const quantity = input == null ? null : this.quantity(input, unit, document.kind);
      const generation = generations.get(ingredient.id) ?? 0;
      const snapshot = document.kind === 'inventory' && !recount ? old : null;
      const expected = balance.stock;
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
    const ingredients = new Map(catalog.map((ingredient) => [ingredient.id, ingredient]));
    for (const item of document.items) {
      const ingredient = ingredients.get(item.ingredientId);
      if (ingredient?.preparationMode === 'virtual') throw new BadRequestException('Заготовка без остатка не участвует в складских документах');
      if (!ingredient) throw new NotFoundException('Сырьё не найдено');
      assertUnitMatchesType(normalizeUnit(item.unit), ingredient.unitType);
    }
    if (document.mode === 'full') {
      const current = await warehouseBalances(tx, warehouse, catalog);
      const used = await this.usedIngredientIds(tx, warehouse, catalog.map(({ id }) => id));
      const hasNewLine = catalog.some((ingredient) =>
        !itemIds.has(ingredient.id) && (used.has(ingredient.id) || !current.get(ingredient.id)!.stock.isZero()),
      );
      if (hasNewLine) throw new ConflictException('Состав склада изменился. Сохраните черновик и посчитайте новые продукты');
    }
    if (document.kind === 'inventory') {
      const generations = await this.generations(tx, warehouse, [...itemIds]);
      if (document.items.some((item) => item.inventoryGeneration !== (generations.get(item.ingredientId) ?? 0))) {
        throw new ConflictException('По этим позициям уже проведена другая инвентаризация. Пересчитайте остатки');
      }
    }
    return { warehouse, ingredients };
  }

  private async usedIngredientIds(tx: Prisma.TransactionClient, warehouse: WarehouseLocation, ingredientIds: string[]) {
    if (!ingredientIds.length) return new Set<string>();
    const movements = await tx.stockMovement.findMany({
      where: { cafeId: warehouse.cafeId, ...warehouseDocumentFilter(warehouse), ingredientId: { in: ingredientIds }, change: { not: 0 } },
      select: { ingredientId: true }, distinct: ['ingredientId'],
    });
    return new Set(movements.map(({ ingredientId }) => ingredientId));
  }

  /** Draft counts are preserved while the preview follows the current book stock.
   * Posted/reversed documents keep the immutable values captured at approval. */
  private async preview(tx: Prisma.TransactionClient, document: Document) {
    const snapshot = readWriteoffSnapshot(document.sourceLines);
    if (snapshot && ['draft', 'submitted'].includes(document.status)) {
      const valuation = await previewWriteoffSources(tx, await this.warehouse(tx, document.warehouseId), snapshot);
      return { ...this.serialize(document), sourceLines: valuation.sourceLines, sourceTotal: valuation.total };
    }
    if (document.kind !== 'inventory' || !['draft', 'submitted'].includes(document.status)) return this.serialize(document);
    const warehouse = await this.warehouse(tx, document.warehouseId);
    const ingredients = await tx.ingredient.findMany({ where: { cafeId: document.cafeId, id: { in: document.items.map(({ ingredientId }) => ingredientId) } } });
    const balances = await warehouseBalances(tx, warehouse, ingredients);
    return this.serialize({ ...document, items: document.items.map((item) => {
      const balance = balances.get(item.ingredientId);
      if (!balance) return item;
      return { ...item, expected: balance.stock, difference: item.quantity?.sub(balance.stock) ?? null,
        unitCost: balance.avgCost, costKnown: balance.valuationKnown };
    }) });
  }

  private async validateSourceSnapshot(tx: Prisma.TransactionClient, document: Document) {
    const snapshot = readWriteoffSnapshot(document.sourceLines);
    if (!snapshot) return;
    await lockRecipeGraph(tx, true);
    await resolveWriteoffSources(tx, await this.warehouse(tx, document.warehouseId), sourceInputs(snapshot), true);
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
        document: { warehouseId: warehouse.id, kind: 'inventory', status: { in: ['posted', 'reversed'] } },
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

  private async lockDocument(tx: Prisma.TransactionClient, id: string, revision: number | undefined, status: WarehouseDocument['status']) {
    const cafeId = this.cafeId();
    await tx.$queryRaw`SELECT id FROM warehouse_documents WHERE id = ${id} AND cafe_id = ${cafeId} FOR UPDATE`;
    const document = await this.load(tx, id);
    if ((revision !== undefined && document.revision !== revision) || document.status !== status) {
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
      createdAt: document.createdAt, submittedAt: document.submittedAt, postedAt: document.postedAt,
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
