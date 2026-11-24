import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import type { WarehouseReportQuery } from './reports.dto';
import { warehouseSelectionIds } from './warehouse-location';

export async function reportWarehouses(db: Prisma.TransactionClient, query: WarehouseReportQuery) {
  const cafeId = getCafeId();
  if (!cafeId) throw new BadRequestException('Заведение не назначено');
  const ids = warehouseSelectionIds(query);

  const locations = await db.warehouse.findMany({
    where: { cafeId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    select: { id: true, cafeId: true, name: true, isDefault: true },
  });
  const selected = ids ? locations.filter((warehouse) => ids.has(warehouse.id)) : locations;
  if (ids && selected.length !== ids.size) throw new NotFoundException('Склад не найден');
  const defaultWarehouse = locations.find((warehouse) => warehouse.isDefault);
  const includesDefault = !ids || selected.some((warehouse) => warehouse.isDefault);
  const selectedIds = selected.map((warehouse) => warehouse.id);
  const filter: Prisma.StockMovementWhereInput = !ids ? {}
    : includesDefault ? { OR: [{ warehouseId: { in: selectedIds } }, { warehouseId: null }] }
    : { warehouseId: { in: selectedIds } };

  return { cafeId, locations, selected, defaultWarehouse, includesDefault, filter,
    single: ids && selected.length === 1 ? selected[0] : undefined,
    warehouseName: ids && selected.length === 1 ? selected[0].name : ids ? 'Выбранные склады' : 'Все склады',
  };
}
