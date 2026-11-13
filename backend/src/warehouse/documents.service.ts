import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, WarehouseDocument, WarehouseDocumentItem, WarehouseDocumentKind } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { getCafeId } from '../tenant/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWarehouseDocumentDto, UpdateWarehouseDocumentDto, warehouseWriteoffReasons } from './documents.dto';
import { lockIngredients, lockWarehouseCatalog } from './stock-lock';
import { assertUnitMatchesType, costFromBase, fromBase, normalizeUnit, toBase, UnitCode, unitLabel } from './units';
import { getWarehouseBalance, resolveWarehouse, setWarehouseBalance, warehouseBalances, WarehouseLocation } from './warehouse-location';

type Actor = Pick<AuthUser, 'id' | 'role' | 'name' | 'cafeId'>;
type Document = WarehouseDocument & { items: WarehouseDocumentItem[] };
type StockLine = Omit<WarehouseDocumentItem, 'documentId' | 'cafeId'>;
const documentInclude = { items: { orderBy: [{ name: 'asc' }, { ingredientId: 'asc' }] } } satisfies Prisma.WarehouseDocumentInclude;
const maxQuantity = new Prisma.Decimal('99999999999.999');
const zero = new Prisma.Decimal(0);
const transactionOptions = { timeout: 30_000 };

@Injectable()
export class WarehouseDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(warehouseId?: string, kind?: WarehouseDocumentKind) {
    const cafeId = this.cafeId();
    if (warehouseId !== undefined) await this.warehouse(this.prisma, warehouseId);
    const [documents, totals] = await this.prisma.$transaction([
      this.prisma.warehouseDocument.findMany({
        where: { cafeId, warehouseId, kind },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.$queryRaw<Array<{ id: string; itemsCount: number; varianceValue: Prisma.Decimal | null }>>`
        SELECT d.id, COUNT(i.ingredient_id)::int AS "itemsCount",
          ROUND(SUM(i.difference * i.unit_cost), 2) AS "varianceValue"
        FROM warehouse_documents d
        LEFT JOIN warehouse_document_items i ON i.cafe_id = d.cafe_id AND i.document_id = d.id
        WHERE d.cafe_id = ${cafeId}
        ${warehouseId === undefined ? Prisma.empty : Prisma.sql`AND d.warehouse_id = ${warehouseId}`}
        ${kind === undefined ? Prisma.empty : Prisma.sql`AND d.kind = ${kind}::"WarehouseDocumentKind"`}
        GROUP BY d.id
      `,
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const byId = new Map(totals.map(({ id, ...summary }) => [id, summary]));
    return documents.map((document) => {
      const summary = byId.get(document.id);
      return this.summary(document, summary?.itemsCount ?? 0, summary?.varianceValue ?? null);
    });
  }

  async get(id: string) {
    return this.serialize(await this.load(this.prisma, id));
  }

  async create(actor: Actor, dto: CreateWarehouseDocumentDto) {
    const cafeId = this.assertActor(actor);
    if (dto.kind !== 'inventory' && dto.kind !== 'writeoff') throw new BadRequestException('Выберите тип документа');
    if (dto.kind === 'inventory' && dto.mode !== 'full' && dto.mode !== 'partial') {
      throw new BadRequestException('Выберите вид инвентаризации');
    }
    if (dto.kind === 'writeoff' && dto.mode != null) throw new BadRequestException('Вид инвентаризации неприменим к списанию');
    return this.prisma.$transaction(async (tx) => {
      const warehouse = await this.warehouse(tx, dto.warehouseId);
      const document = await tx.warehouseDocument.create({
        data: {
          cafeId, warehouseId: warehouse.id, kind: dto.kind, mode: dto.mode ?? null,
          reason: this.reason(dto.kind, dto.reason), note: dto.note?.trim() || null,
          createdById: actor.id, createdByName: actor.name,
        },
        include: documentInclude,
      });
      await this.saveLines(tx, warehouse, document, dto.items ?? [], false);
      return this.serialize(await this.load(tx, document.id));
    }, transactionOptions);
  }

  async update(actor: Actor, id: string, dto: UpdateWarehouseDocumentDto) {
    this.assertActor(actor);
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDocument(tx, id, dto.revision, 'draft');
      const warehouse = await this.warehouse(tx, document.warehouseId);
      if (dto.recount && document.kind !== 'inventory') throw new BadRequestException('Пересчёт доступен только для инвентаризации');
      if (dto.items || dto.recount) {
        const items = dto.items ?? document.items.flatMap((item) => item.quantity == null ? [] : [{
          ingredientId: item.ingredientId,
          quantity: fromBase(Number(item.quantity), normalizeUnit(item.unit)),
        }]);
        await this.saveLines(tx, warehouse, document, items, dto.recount === true);
      }
      return this.serialize(await tx.warehouseDocument.update({
        where: { id, cafeId: document.cafeId },
        data: {
          revision: { increment: 1 },
          note: dto.note === undefined ? undefined : dto.note?.trim() || null,
          reason: dto.reason === undefined ? undefined : this.reason(document.kind, dto.reason),
        },
        include: documentInclude,
      }));
    }, transactionOptions);
  }

  async submit(actor: Actor, id: string, revision?: number) {
    this.assertActor(actor);
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDocument(tx, id, revision, 'draft');
      await this.validateLines(tx, document);
      if (document.kind === 'writeoff') {
        if (!document.reason) throw new BadRequestException('Укажите причину списания');
        if (document.reason === 'other' && !document.note) throw new BadRequestException('Опишите причину списания в комментарии');
      }
      return this.serialize(await tx.warehouseDocument.update({
        where: { id, cafeId: document.cafeId },
        data: {
          status: 'submitted', revision: { increment: 1 }, submittedAt: new Date(),
          submittedById: actor.id, submittedByName: actor.name,
        },
        include: documentInclude,
      }));
    }, transactionOptions);
  }

  async reopen(actor: Actor, id: string, revision?: number) {
    this.assertActor(actor, true);
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDocument(tx, id, revision, 'submitted');
      return this.serialize(await tx.warehouseDocument.update({
        where: { id, cafeId: document.cafeId },
        data: { status: 'draft', revision: { increment: 1 } },
        include: documentInclude,
      }));
    }, transactionOptions);
  }

  async approve(actor: Actor, id: string, revision?: number) {
    this.assertActor(actor, true);
    return this.prisma.$transaction(async (tx) => {
      const document = await this.lockDocument(tx, id, revision, 'submitted');
      const { warehouse, ingredients } = await this.validateLines(tx, document);
      const kind = document.kind;
      for (const item of document.items) {
        const ingredient = ingredients.get(item.ingredientId)!;
        const balance = await getWarehouseBalance(tx, warehouse, ingredient);
        const difference = kind === 'inventory' ? item.difference! : item.quantity!.negated();
        const stock = balance.stock.add(difference);
        if (kind === 'writeoff' && stock.lt(0)) {
          throw new ConflictException(`На складе недостаточно сырья «${item.name}»`);
        }
        if (stock.abs().gt(maxQuantity)) throw new ConflictException(`Остаток «${item.name}» вне допустимого диапазона`);

        if (kind === 'writeoff') {
          await tx.warehouseDocumentItem.update({
            where: { documentId_ingredientId: { documentId: id, ingredientId: item.ingredientId }, cafeId: document.cafeId },
            data: { expected: balance.stock, difference, unitCost: balance.avgCost },
          });
        }
        if (difference.isZero()) continue;
        await setWarehouseBalance(tx, warehouse, item.ingredientId, { stock, avgCost: balance.avgCost });
        await tx.stockMovement.create({ data: {
          cafeId: document.cafeId, warehouseId: warehouse.id, ingredientId: item.ingredientId,
          type: kind, sourceType: kind, sourceId: id, change: difference,
          beforeStock: balance.stock, afterStock: stock, costAtMoment: balance.avgCost,
          comment: kind === 'inventory' ? document.note : [warehouseWriteoffReasons[document.reason!], document.note].filter(Boolean).join(' · '),
        } });
      }
      return this.serialize(await tx.warehouseDocument.update({
        where: { id, cafeId: document.cafeId },
        data: {
          status: 'posted', revision: { increment: 1 }, postedAt: new Date(),
          postedById: actor.id, postedByName: actor.name,
        },
        include: documentInclude,
      }));
    }, transactionOptions);
  }

  private async saveLines(
    tx: Prisma.TransactionClient,
    warehouse: WarehouseLocation,
    document: Document,
    inputs: { ingredientId: string; quantity: number }[],
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
    const generations = document.kind === 'inventory' ? await this.generations(tx, warehouse, ingredients.map(({ id }) => id)) : new Map<string, number>();
    const rows: StockLine[] = [];
    for (const ingredient of ingredients) {
      const old = existing.get(ingredient.id);
      const input = quantities.get(ingredient.id);
      const balance = balances.get(ingredient.id)!;
      if (!full && input === undefined) continue;
      if (full && !ingredient.isActive && balance.stock.isZero() && !old && input === undefined) continue;
      const unit = normalizeUnit(old?.unit ?? ingredient.displayUnit);
      assertUnitMatchesType(unit, ingredient.unitType);
      const quantity = input === undefined ? null : this.quantity(input, unit, document.kind);
      const generation = generations.get(ingredient.id) ?? 0;
      const snapshot = document.kind === 'inventory' && !recount && quantity != null && old?.quantity?.eq(quantity) ? old : null;
      const expected = snapshot?.expected ?? balance.stock;
      const unitCost = snapshot?.unitCost ?? balance.avgCost;
      const difference = quantity == null ? null : document.kind === 'writeoff'
        ? quantity.negated()
        : quantity.sub(expected);
      if (difference?.abs().gt(maxQuantity)) throw new BadRequestException('Расхождение вне допустимого диапазона');
      rows.push({
        ingredientId: ingredient.id, name: ingredient.name, unit, expected, quantity, difference, unitCost,
        inventoryGeneration: document.kind === 'inventory' && quantity != null
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
      if (!ingredient) throw new NotFoundException('Сырьё не найдено');
      assertUnitMatchesType(normalizeUnit(item.unit), ingredient.unitType);
    }
    if (document.mode === 'full') {
      const current = await warehouseBalances(tx, warehouse, catalog);
      const hasNewLine = catalog.some((ingredient) =>
        !itemIds.has(ingredient.id) && (ingredient.isActive || !current.get(ingredient.id)!.stock.isZero()),
      );
      if (hasNewLine) throw new ConflictException('Список сырья изменился. Обновите черновик и пересчитайте новые позиции');
    }
    if (document.kind === 'inventory') {
      const generations = await this.generations(tx, warehouse, [...itemIds]);
      if (document.items.some((item) => item.inventoryGeneration !== (generations.get(item.ingredientId) ?? 0))) {
        throw new ConflictException('По этим позициям уже проведена другая инвентаризация. Пересчитайте остатки');
      }
    }
    return { warehouse, ingredients };
  }

  private async lockCatalog(tx: Prisma.TransactionClient, warehouse: WarehouseLocation, ids: string[], full: boolean) {
    if (full) await lockWarehouseCatalog(tx, warehouse.cafeId);
    const where = { cafeId: warehouse.cafeId, ...(full ? {} : { id: { in: ids } }) };
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
        document: { warehouseId: warehouse.id, kind: 'inventory', status: 'posted' },
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
    if (actor.cafeId !== cafeId || (actor.role !== Role.OWNER && (ownerOnly || actor.role !== Role.ADMIN))) {
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
    if (kind === 'writeoff' && quantity.isZero()) throw new BadRequestException('Количество списания должно быть больше нуля');
    return quantity;
  }

  private summary(document: WarehouseDocument, itemsCount: number, variance: Prisma.Decimal | null) {
    return {
      id: document.id, warehouseId: document.warehouseId, kind: document.kind, mode: document.mode,
      reason: document.reason, note: document.note, status: document.status, revision: document.revision,
      createdAt: document.createdAt, submittedAt: document.submittedAt, postedAt: document.postedAt,
      createdByName: document.createdByName, submittedByName: document.submittedByName, postedByName: document.postedByName,
      itemsCount,
      varianceValue: variance == null ? null : Number(variance.toDecimalPlaces(2)),
    };
  }

  private serialize(document: Document) {
    const items = document.items;
    const variance = items.reduce((sum: Prisma.Decimal | null, item) =>
      item.difference == null || item.unitCost == null ? sum : (sum ?? zero).add(item.difference.mul(item.unitCost)), null);
    return {
      ...this.summary(document, items.length, variance),
      items: items.map((item) => {
        const unit = normalizeUnit(item.unit);
        const display = (value: Prisma.Decimal | null) => value == null ? null : fromBase(Number(value), unit);
        return {
          ingredientId: item.ingredientId, name: item.name, unit: unitLabel(unit), expected: display(item.expected),
          quantity: display(item.quantity), difference: display(item.difference),
          unitCost: item.unitCost == null ? null : costFromBase(Number(item.unitCost), unit),
          value: item.difference == null || item.unitCost == null ? null : Number(item.difference.mul(item.unitCost).toDecimalPlaces(2)),
        };
      }),
    };
  }
}
