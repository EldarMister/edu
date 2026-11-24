import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertWarehousePermission } from './warehouse-permissions';
import { WarehouseDocumentsService } from './documents.service';
import { getCafeId } from '../tenant/tenant-context';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { lockStationRouting, resolveStation, stationCatalog } from '../kitchen/preparation-stations';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { assertUnitMatchesType, normalizeUnit, toBase } from './units';
import { resolveWarehouse } from './warehouse-location';

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
        select: { id: true, name: true, address: true, isDefault: true },
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

  async valuation(cafeId: string | null) {
    if (!cafeId) return [];
    const rows = await this.prisma.$queryRaw<{ warehouseId: string; stockValue: Prisma.Decimal; unknownCount: number }[]>`
      WITH balances AS (
        SELECT w.id AS warehouse_id, i.stock, i.avg_cost, i.valuation_known
        FROM warehouses w JOIN ingredients i ON i.cafe_id = w.cafe_id
        WHERE w.cafe_id = ${cafeId} AND w.is_default AND i.is_active
          AND NOT (i.is_prepared AND i.preparation_mode = 'virtual') AND i.stock <> 0
        UNION ALL
        SELECT s.warehouse_id, s.stock, s.avg_cost, s.valuation_known
        FROM warehouse_stock s
        JOIN warehouses w ON w.id = s.warehouse_id AND w.cafe_id = s.cafe_id
        JOIN ingredients i ON i.id = s.ingredient_id AND i.cafe_id = s.cafe_id
        WHERE s.cafe_id = ${cafeId} AND NOT w.is_default AND i.is_active
          AND NOT (i.is_prepared AND i.preparation_mode = 'virtual') AND s.stock <> 0
      )
      SELECT w.id AS "warehouseId",
        COALESCE(SUM(ROUND(b.stock * b.avg_cost, 2)) FILTER (WHERE b.valuation_known), 0) AS "stockValue",
        COUNT(*) FILTER (WHERE b.valuation_known = false)::int AS "unknownCount"
      FROM warehouses w LEFT JOIN balances b ON b.warehouse_id = w.id
      WHERE w.cafe_id = ${cafeId}
      GROUP BY w.id
    `;
    return rows.map((row) => ({ ...row, stockValue: Number(row.stockValue) }));
  }

  async save(cafeId: string | null, value: string, id?: string, address?: string | null) {
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
      const select = { id: true, name: true, address: true, isDefault: true } as const;
      return id === undefined
        ? tx.warehouse.create({ data: { cafeId, name, address: address?.trim() || null }, select })
        : tx.warehouse.update({ where: { id, cafeId }, data: { name, address: address === undefined ? undefined : address?.trim() || null }, select });
    });
    this.events.emitBroadcast(SERVER_EVENTS.SETTINGS_UPDATED, { cafeId });
    return location;
  }

  async route(user: AuthUser, stationId: string, warehouseId: string | null) {
    assertWarehousePermission(user, 'warehouseSettings');
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
    ingredientId: string; fromWarehouseId: string; toWarehouseId: string;
    quantity: number; unit: string; requestKey?: string;
  }, actor?: AuthUser) {
    const ingredient = await this.prisma.ingredient.findUnique({ where: { id: input.ingredientId } });
    if (!ingredient) throw new NotFoundException('Товар не найден');
    const unit = normalizeUnit(input.unit);
    assertUnitMatchesType(unit, ingredient.unitType);
    const quantity = toBase(input.quantity, unit) / toBase(1, normalizeUnit(ingredient.displayUnit));
    const user = actor ?? { id: 'system', name: 'Система', role: 'OWNER', cafeId: getCafeId() ?? null };
    const documents = new WarehouseDocumentsService(this.prisma);
    const document = await documents.create(user, { kind: 'transfer', warehouseId: input.fromWarehouseId,
      destinationWarehouseId: input.toWarehouseId, requestKey: input.requestKey,
      items: [{ ingredientId: ingredient.id, quantity }], finalize: 'post' });
    return { ok: true, documentId: document.id };
  }
}
