import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { getCafeId } from '../tenant/tenant-context';
import { assertWarehousePermission } from './warehouse-permissions';
import { lockIngredients } from './stock-lock';
import { postStockMovement } from './stock-posting';
import { assertUnitMatchesType, costFromBase, fromBase, normalizeUnit, toBase, unitLabel } from './units';
import { getWarehouseBalance, resolveWarehouse } from './warehouse-location';

type Actor = Pick<AuthUser, 'id' | 'name' | 'role' | 'cafeId'> & Partial<Pick<AuthUser, 'permissions'>>;
const include = { lines: { orderBy: { sortOrder: 'asc' as const } } };
type Document = Prisma.ProcessingDocumentGetPayload<{ include: typeof include }>;
type Line = Omit<Prisma.ProcessingLineUncheckedCreateInput, 'id' | 'cafeId' | 'documentId'> & {
  quantity: Prisma.Decimal; unitCost: Prisma.Decimal; lineCost: Prisma.Decimal; costSharePercent: Prisma.Decimal;
};
const zero = () => new Prisma.Decimal(0);
function tenant(actor?: Actor) {
  const cafeId = getCafeId();
  if (!cafeId || (actor && actor.cafeId !== cafeId)) throw new BadRequestException('Заведение не назначено');
  return cafeId;
}
function dateValue(value?: string) {
  const result = value ? new Date(value) : new Date();
  if (!Number.isFinite(result.getTime())) throw new BadRequestException('Некорректная дата документа');
  return result;
}

class ProcessingRowDto {
  @IsString() @IsNotEmpty() ingredientId: string;
  @IsString() @IsNotEmpty() warehouseId: string;
  @IsNumber() @Min(0.000001) quantity: number;
  @IsString() @IsNotEmpty() @MaxLength(16) unit: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) costSharePercent?: number;
}
class ProcessingSaveDto {
  @IsOptional() @IsString() @MaxLength(40) date?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ProcessingRowDto) inputs: ProcessingRowDto[];
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ProcessingRowDto) outputs: ProcessingRowDto[];
  @IsOptional() @IsString() @MaxLength(100) requestKey?: string;
  @IsOptional() @IsBoolean() complete?: boolean;
  @IsOptional() @IsInt() @Min(0) revision?: number;
}
class RevisionDto { @IsInt() @Min(0) revision: number; }
class ReverseDto extends RevisionDto { @IsString() @IsNotEmpty() @MaxLength(2000) note: string; }

@Injectable()
export class ProcessingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: { from?: string; to?: string; warehouseId?: string; search?: string } = {}) {
    const cafeId = tenant();
    const from = query.from ? dateValue(query.from) : undefined;
    const to = query.to ? dateValue(query.to.length === 10 ? `${query.to}T23:59:59.999Z` : query.to) : undefined;
    if (from && to && from > to) throw new BadRequestException('Начальная дата позже конечной');
    const search = query.search?.trim();
    const rows = await this.prisma.processingDocument.findMany({ where: { cafeId,
      date: from || to ? { gte: from, lte: to } : undefined,
      lines: query.warehouseId ? { some: { warehouseId: query.warehouseId } } : undefined,
      OR: search ? [{ note: { contains: search, mode: 'insensitive' } }, { lines: { some: { name: { contains: search, mode: 'insensitive' } } } }] : undefined,
    }, include, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 500 });
    return rows.map((row) => this.serialize(row));
  }

  async findOne(id: string) { return this.serialize(await this.load(this.prisma, id)); }

  async create(actor: Actor, dto: ProcessingSaveDto) {
    const cafeId = tenant(actor);
    assertWarehousePermission(actor, 'warehouseProduce');
    const requestKey = dto.requestKey?.trim() || null;
    return this.prisma.$transaction(async (tx) => {
      if (requestKey) {
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`processing:${cafeId}:${requestKey}`}))) AS request_lock`;
        const existing = await tx.processingDocument.findFirst({ where: { cafeId, requestKey }, include });
        if (existing) {
          // Compare quantities and allocation only. Repeating a request must not
          // revalue its already posted historical lines at today's average cost.
          const incoming = this.fingerprintInput(dto);
          const saved = this.fingerprint(existing.lines);
          if (incoming !== saved || (dto.note?.trim() || null) !== existing.note || (dto.date && dateValue(dto.date).getTime() !== existing.date.getTime())) {
            throw new ConflictException('Этот запрос уже использован для другой переработки');
          }
          return this.serialize(existing);
        }
      }
      const rows = await this.normalize(tx, dto);
      const valued = await this.value(tx, rows, dto.complete === true);
      const created = await tx.processingDocument.create({ data: { cafeId, requestKey, date: dateValue(dto.date), note: dto.note?.trim() || null,
        createdById: actor.id, createdByName: actor.name, totalCost: valued.totalCost, hasUnknownCost: valued.hasUnknownCost,
      } });
      if (rows.length) await tx.processingLine.createMany({ data: rows.map((line) => ({ ...line, cafeId, documentId: created.id })) });
      const document = await this.load(tx, created.id);
      return this.serialize(dto.complete ? await this.postWithin(tx, actor, document) : document);
    });
  }

  async update(actor: Actor, id: string, dto: ProcessingSaveDto) {
    tenant(actor); assertWarehousePermission(actor, 'warehouseProduce');
    return this.prisma.$transaction(async (tx) => {
      const current = await this.load(tx, id, true);
      this.revision(current, dto.revision);
      if (current.status !== 'draft') throw new ConflictException('Проведённая переработка неизменяема. Создайте обратную операцию');
      const rows = await this.normalize(tx, dto);
      const valued = await this.value(tx, rows, false);
      await tx.processingLine.deleteMany({ where: { documentId: id, cafeId: current.cafeId } });
      if (rows.length) await tx.processingLine.createMany({ data: rows.map((line) => ({ ...line, cafeId: current.cafeId, documentId: id })) });
      const saved = await tx.processingDocument.update({ where: { id, cafeId: current.cafeId }, data: {
        date: dto.date ? dateValue(dto.date) : undefined, note: dto.note?.trim() || null,
        revision: { increment: 1 }, totalCost: valued.totalCost, hasUnknownCost: valued.hasUnknownCost,
      }, include });
      return this.serialize(saved);
    });
  }

  async post(actor: Actor, id: string, revision: number) {
    tenant(actor); assertWarehousePermission(actor, 'warehouseProduce');
    return this.prisma.$transaction(async (tx) => {
      const current = await this.load(tx, id, true);
      if (current.status === 'posted') return this.serialize(current);
      this.revision(current, revision);
      return this.serialize(await this.postWithin(tx, actor, current));
    });
  }

  async reverse(actor: Actor, id: string, dto: ReverseDto) {
    tenant(actor); assertWarehousePermission(actor, 'warehouseApprove');
    const reason = dto.note?.trim();
    if (!reason) throw new BadRequestException('Укажите причину отмены переработки');
    return this.prisma.$transaction(async (tx) => {
      const current = await this.load(tx, id, true);
      if (current.status === 'reversed') return this.serialize(current);
      this.revision(current, dto.revision);
      if (current.status !== 'posted') throw new ConflictException('Отменить можно только проведённую переработку');
      const movements = await tx.stockMovement.findMany({ where: { cafeId: current.cafeId, sourceType: 'processing', sourceId: id, type: 'processing' } });
      if (movements.length !== current.lines.length) throw new ConflictException('История переработки неполна');
      await lockIngredients(tx, movements.map((m) => m.ingredientId));
      // Remove every produced output before restoring the inputs. A consumed
      // output cannot be reversed by silently creating a negative quantity.
      const ordered = [...movements.filter((m) => m.change.gt(0)), ...movements.filter((m) => m.change.lt(0))];
      for (const original of ordered) {
        const warehouse = await resolveWarehouse(tx, original.warehouseId);
        await postStockMovement(tx, { ingredientId: original.ingredientId, warehouse, change: original.change.negated(), cost: original.costAtMoment, costKnown: original.costKnown,
          valuation: original.change.gt(0) ? 'value' : 'average', allowNegative: original.change.gt(0) ? false : undefined,
          movement: { type: 'cancel', sourceType: 'processing', sourceId: id, actorId: actor.id, actorName: actor.name,
            reason, comment: `Отмена переработки: ${reason}`, recipeSnapshot: { reversedMovementId: original.id } },
        });
      }
      return this.serialize(await tx.processingDocument.update({ where: { id, cafeId: current.cafeId }, data: {
        status: 'reversed', reversedAt: new Date(), reversedById: actor.id, reversedByName: actor.name, reverseReason: reason, revision: { increment: 1 },
      }, include }));
    });
  }

  private async postWithin(tx: Prisma.TransactionClient, actor: Actor, current: Document) {
    if (current.status !== 'draft') throw new ConflictException('Переработка уже проведена или отменена');
    await lockIngredients(tx, current.lines.map((line) => line.ingredientId));
    const rows: Line[] = current.lines.map(({ id: _id, cafeId: _cafeId, documentId: _documentId, ...line }) => ({ ...line }));
    const valued = await this.value(tx, rows, true);
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index], warehouse = await resolveWarehouse(tx, row.warehouseId);
      await tx.processingLine.update({ where: { id: current.lines[index].id }, data: { unitCost: row.unitCost, lineCost: row.lineCost, costSharePercent: row.costSharePercent, costKnown: row.costKnown } });
      await postStockMovement(tx, { ingredientId: row.ingredientId, warehouse, change: row.direction === 'input' ? row.quantity.negated() : row.quantity,
        cost: row.unitCost, costKnown: row.costKnown, value: row.direction === 'output' ? row.lineCost : undefined,
        valuation: row.direction === 'output' ? 'average' : 'preserve',
        movement: { type: 'processing', sourceType: 'processing', sourceId: current.id, actorId: actor.id, actorName: actor.name,
          reason: 'processing', comment: current.note ?? 'Переработка', recipeSnapshot: { direction: row.direction, processingLineId: current.lines[index].id,
            costSharePercent: Number(row.costSharePercent), costKnown: row.costKnown === true } },
      });
    }
    return tx.processingDocument.update({ where: { id: current.id, cafeId: current.cafeId }, data: {
      status: 'posted', postedAt: new Date(), postedById: actor.id, postedByName: actor.name, revision: { increment: 1 },
      totalCost: valued.totalCost, hasUnknownCost: valued.hasUnknownCost,
    }, include });
  }

  private async normalize(tx: Prisma.TransactionClient, dto: ProcessingSaveDto): Promise<Line[]> {
    const cafeId = tenant();
    if (!Array.isArray(dto.inputs) || !Array.isArray(dto.outputs) || dto.inputs.length > 200 || dto.outputs.length > 200) throw new BadRequestException('Укажите строки переработки');
    await lockIngredients(tx, [...dto.inputs, ...dto.outputs].map((line) => line.ingredientId));
    const rows: Line[] = [], used = new Set<string>();
    for (const direction of ['input', 'output'] as const) for (const item of direction === 'input' ? dto.inputs : dto.outputs) {
      const ingredient = await tx.ingredient.findFirst({ where: { id: item.ingredientId, cafeId, isActive: true } });
      if (!ingredient) throw new NotFoundException('Товар не найден или архивирован');
      if (ingredient.preparationMode === 'virtual') throw new BadRequestException('Заготовка без отдельного остатка не участвует в переработке');
      if (!item.warehouseId) throw new BadRequestException('Для каждой строки выберите склад');
      const warehouse = await resolveWarehouse(tx, item.warehouseId);
      const key = `${direction}:${ingredient.id}:${warehouse!.id}`;
      if (used.has(key)) throw new BadRequestException('Объедините одинаковые товары одного склада в одну строку');
      used.add(key);
      const unit = normalizeUnit(item.unit); assertUnitMatchesType(unit, ingredient.unitType);
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new BadRequestException('Количество должно быть больше нуля');
      const quantity = new Prisma.Decimal(item.quantity).mul(toBase(1, unit)).toDecimalPlaces(3);
      if (quantity.lte(0) || quantity.gte('100000000000')) throw new BadRequestException('Количество вне допустимого диапазона');
      const share = direction === 'input' ? 0 : item.costSharePercent ?? (dto.outputs.length === 1 ? 100 : 0);
      if (!Number.isFinite(share) || share < 0 || share > 100) throw new BadRequestException('Доля стоимости должна быть от 0 до 100%');
      rows.push({ direction, ingredientId: ingredient.id, warehouseId: warehouse!.id, name: ingredient.name, warehouseName: warehouse!.name,
        quantity, unit, unitCost: zero(), lineCost: zero(), costSharePercent: new Prisma.Decimal(share).toDecimalPlaces(4), sortOrder: rows.length });
    }
    return rows;
  }

  private async value(tx: Prisma.TransactionClient, rows: Line[], posting: boolean) {
    const inputs = rows.filter((row) => row.direction === 'input'), outputs = rows.filter((row) => row.direction === 'output');
    const shareTotal = outputs.reduce((sum, row) => sum.add(row.costSharePercent), zero());
    if (posting && (!inputs.length || !outputs.length)) throw new BadRequestException('Для проведения нужны исходные товары и результаты переработки');
    if (posting && !shareTotal.eq(100)) throw new BadRequestException('Сумма долей стоимости результатов должна быть 100%');
    let totalCost = zero(), hasUnknownCost = false;
    for (const row of rows) {
      const ingredient = await tx.ingredient.findFirst({ where: { id: row.ingredientId, cafeId: tenant(), isActive: true } });
      if (!ingredient || ingredient.preparationMode === 'virtual') throw new ConflictException('Товар недоступен для складской переработки');
      if (row.direction !== 'input') continue;
      const warehouse = await resolveWarehouse(tx, row.warehouseId);
      const balance = await getWarehouseBalance(tx, warehouse, ingredient);
      row.unitCost = balance.avgCost;
      row.costKnown = balance.valuationKnown && balance.stock.gte(row.quantity);
      row.lineCost = row.quantity.mul(balance.avgCost).toDecimalPlaces(8);
      totalCost = totalCost.add(row.lineCost);
      if (!row.costKnown) hasUnknownCost = true;
    }
    let allocated = zero(), cumulativeShare = zero();
    for (const row of inputs) row.costSharePercent = totalCost.gt(0) ? row.lineCost.mul(100).div(totalCost).toDecimalPlaces(4) : zero();
    for (const row of outputs) {
      cumulativeShare = cumulativeShare.add(row.costSharePercent);
      const cumulativeValue = shareTotal.eq(100) ? totalCost.mul(cumulativeShare).div(100).toDecimalPlaces(8) : zero();
      row.lineCost = cumulativeValue.sub(allocated); allocated = cumulativeValue;
      row.unitCost = row.lineCost.div(row.quantity).toDecimalPlaces(8);
      row.costKnown = !hasUnknownCost;
    }
    return { totalCost, hasUnknownCost };
  }

  private async load(tx: Prisma.TransactionClient, id: string, lock = false): Promise<Document> {
    const cafeId = tenant();
    if (lock) await tx.$queryRaw`SELECT id FROM processing_documents WHERE id=${id} AND cafe_id=${cafeId} FOR UPDATE`;
    const document = await tx.processingDocument.findFirst({ where: { id, cafeId }, include });
    if (!document) throw new NotFoundException('Переработка не найдена');
    return document;
  }
  private revision(document: Document, revision: number | undefined) {
    if (revision !== document.revision) throw new ConflictException('Документ уже изменён. Обновите страницу');
  }
  private fingerprint(rows: Array<Pick<Line, 'direction' | 'ingredientId' | 'warehouseId' | 'quantity' | 'costSharePercent'>>) {
    return JSON.stringify(rows.map((row) => [row.direction, row.ingredientId, row.warehouseId, row.quantity.toString(), row.direction === 'output' ? row.costSharePercent.toString() : '0']).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  }
  private fingerprintInput(dto: ProcessingSaveDto) {
    return this.fingerprint([...(dto.inputs ?? []).map((row) => ({ ...row, direction: 'input' })), ...(dto.outputs ?? []).map((row) => ({ ...row, direction: 'output' }))].map((row) => ({ ...row,
      quantity: new Prisma.Decimal(row.quantity).mul(toBase(1, normalizeUnit(row.unit))).toDecimalPlaces(3),
      costSharePercent: new Prisma.Decimal(row.direction === 'input' ? 0 : row.costSharePercent ?? (dto.outputs.length === 1 ? 100 : 0)).toDecimalPlaces(4),
    })));
  }
  private serialize(document: Document) {
    const rows = document.lines.map((line) => { const unit = normalizeUnit(line.unit); return { ...line,
      quantity: fromBase(Number(line.quantity), unit), unitCost: line.costKnown ? costFromBase(Number(line.unitCost), unit) : null, lineCost: line.costKnown ? Number(line.lineCost) : null,
      costSharePercent: Number(line.costSharePercent), unitLabel: unitLabel(unit),
    }; });
    const { lines: _lines, ...data } = document;
    return { ...data, totalCost: document.hasUnknownCost ? null : Number(document.totalCost), inputs: rows.filter((row) => row.direction === 'input'), outputs: rows.filter((row) => row.direction === 'output') };
  }
}

@Controller('admin/warehouse/processing')
@Roles(Role.OWNER, Role.ADMIN, Role.KITCHEN, Role.BAR)
@RequirePermission('sections.warehouse')
class ProcessingController {
  constructor(private readonly processing: ProcessingService) {}
  @Get() list(@Query() query: { from?: string; to?: string; warehouseId?: string; search?: string }) { return this.processing.list(query); }
  @Get(':id') one(@Param('id') id: string) { return this.processing.findOne(id); }
  @Post() @RequirePermission('actions.warehouseProduce') create(@CurrentUser() actor: AuthUser, @Body() dto: ProcessingSaveDto) { return this.processing.create(actor, dto); }
  @Patch(':id') @RequirePermission('actions.warehouseProduce') update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: ProcessingSaveDto) { return this.processing.update(actor, id, dto); }
  @Post(':id/post') @RequirePermission('actions.warehouseProduce') post(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: RevisionDto) { return this.processing.post(actor, id, dto.revision); }
  @Post(':id/reverse') @RequirePermission('actions.warehouseApprove') reverse(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: ReverseDto) { return this.processing.reverse(actor, id, dto); }
}
@Module({ controllers: [ProcessingController], providers: [ProcessingService] })
export class ProcessingModule {}
