import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { lockStationRouting, resolveStation, stationCatalog } from '../kitchen/preparation-stations';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { lockIngredients } from './stock-lock';
import { assertUnitMatchesType, normalizeUnit, toBase } from './units';
import { getWarehouseBalance, resolveWarehouse, setWarehouseBalance } from './warehouse-location';

@Injectable()
export class WarehouseLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  async list(cafeId: string | null) {
    if (!cafeId) return { locations: [], stationRoutes: [] };
    await resolveWarehouse(this.prisma);
    const [locations, records, routes] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { cafeId },
        select: { id: true, name: true, isDefault: true },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.preparationStation.findMany({ where: { cafeId }, orderBy: { name: 'asc' } }),
      this.prisma.stationWarehouse.findMany({ where: { cafeId } }),
    ]);
    const routeByStation = new Map(routes.map((route) => [route.stationId, route.warehouseId]));
    const stationRoutes = stationCatalog(records, cafeId).filter((station) => station.isActive).map((station) => ({
      stationId: station.id,
      stationName: station.name,
      warehouseId: routeByStation.get(station.id) ?? null,
    }));
    return { locations, stationRoutes };
  }

  async save(cafeId: string | null, value: string, id?: string) {
    if (!cafeId) throw new BadRequestException('Заведение не назначено');
    const name = value.trim();
    if (!name) throw new BadRequestException('Укажите название склада');
    await resolveWarehouse(this.prisma);
    const location = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`warehouse-names:${cafeId}`}))) AS warehouse_lock`;
      if (id !== undefined) await resolveWarehouse(tx, id);
      const otherLocations = await tx.warehouse.findMany({
        where: { cafeId, id: id === undefined ? undefined : { not: id } },
        select: { name: true },
      });
      const normalized = name.toLowerCase();
      if (otherLocations.some((location) => location.name.toLowerCase() === normalized)) {
        throw new ConflictException('Склад с таким названием уже существует');
      }
      const select = { id: true, name: true, isDefault: true } as const;
      return id === undefined
        ? tx.warehouse.create({ data: { cafeId, name }, select })
        : tx.warehouse.update({ where: { id, cafeId }, data: { name }, select });
    });
    this.events.emitBroadcast(SERVER_EVENTS.SETTINGS_UPDATED, { cafeId });
    return location;
  }

  async route(user: AuthUser, stationId: string, warehouseId: string | null) {
    const cafeId = user.cafeId;
    if (!cafeId) throw new BadRequestException('Заведение не назначено');
    const assignment = await this.prisma.$transaction(async (tx) => {
      await lockStationRouting(tx, cafeId);
      const station = await resolveStation(tx, user, stationId);
      if (!station.isActive) throw new BadRequestException('Выберите действующую станцию');
      const warehouse = warehouseId === null ? null : await resolveWarehouse(tx, warehouseId);
      if (!warehouse || warehouse.isDefault) {
        await tx.stationWarehouse.deleteMany({ where: { cafeId, stationId } });
        return null;
      }
      await tx.stationWarehouse.upsert({
        where: { cafeId_stationId: { cafeId, stationId } },
        create: { cafeId, stationId, warehouseId: warehouse.id },
        update: { warehouseId: warehouse.id },
      });
      return warehouse.id;
    });
    this.events.emitBroadcast(SERVER_EVENTS.SETTINGS_UPDATED, { cafeId });
    return { stationId, warehouseId: assignment };
  }

  async transfer(input: {
    ingredientId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    quantity: number;
    unit: string;
  }) {
    if (input.fromWarehouseId === input.toWarehouseId) throw new BadRequestException('Выберите разные склады');
    const [from, to] = await Promise.all([
      resolveWarehouse(this.prisma, input.fromWarehouseId),
      resolveWarehouse(this.prisma, input.toWarehouseId),
    ]);
    if (!from || !to) throw new NotFoundException('Склад не найден');
    const unit = normalizeUnit(input.unit);
    await this.prisma.$transaction(async (tx) => {
      await lockIngredients(tx, [input.ingredientId]);
      const ingredient = await tx.ingredient.findUnique({ where: { id: input.ingredientId, cafeId: from.cafeId } });
      if (!ingredient) throw new NotFoundException('Сырьё не найдено');
      assertUnitMatchesType(unit, ingredient.unitType);
      const quantity = new Prisma.Decimal(toBase(input.quantity, unit)).toDecimalPlaces(3);
      if (quantity.lte(0)) throw new BadRequestException('Количество должно быть больше нуля');

      const source = await getWarehouseBalance(tx, from, ingredient);
      const target = await getWarehouseBalance(tx, to, ingredient);
      if (source.stock.lt(quantity)) throw new BadRequestException('На складе недостаточно сырья');
      const sourceAfter = source.stock.sub(quantity);
      const targetAfter = target.stock.add(quantity);
      const targetAvg = target.stock.gt(0)
        ? target.stock.mul(target.avgCost).add(quantity.mul(source.avgCost)).div(targetAfter)
        : source.avgCost;

      await setWarehouseBalance(tx, from, ingredient.id, { stock: sourceAfter, avgCost: source.avgCost });
      await setWarehouseBalance(tx, to, ingredient.id, { stock: targetAfter, avgCost: targetAvg });
      const sourceId = randomUUID();
      const comment = `Перемещение: ${from.name} → ${to.name}`;
      const common = { cafeId: from.cafeId, ingredientId: ingredient.id, sourceId, type: 'correction', sourceType: 'manual', comment } as const;
      await tx.stockMovement.createMany({ data: [
        { ...common, warehouseId: from.id, beforeStock: source.stock, change: quantity.negated(), afterStock: sourceAfter, costAtMoment: source.avgCost },
        { ...common, warehouseId: to.id, beforeStock: target.stock, change: quantity, afterStock: targetAfter, costAtMoment: source.avgCost },
      ] });
    });
    return { ok: true };
  }
}
