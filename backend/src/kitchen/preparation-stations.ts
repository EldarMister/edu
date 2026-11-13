import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { getCafeId } from '../tenant/tenant-context';

export type PrepStation = string;
export const PrepStation = { kitchen: 'kitchen', bar: 'bar', none: 'none' } as const;
export const BUILTIN_STATIONS = [
  { id: PrepStation.kitchen, name: 'Кухня', isActive: true, isBuiltIn: true },
  { id: PrepStation.bar, name: 'Бар', isActive: true, isBuiltIn: true },
] as const;

type StationDatabase = Pick<Prisma.TransactionClient, 'preparationStation'>;

export function stationRecordId(cafeId: string, id: string) {
  return BUILTIN_STATIONS.some((station) => station.id === id) ? `builtin:${cafeId}:${id}` : id;
}

export function stationCatalog(records: { id: string; name: string; isActive: boolean }[], cafeId: string) {
  const overrides = new Map(records.map((record) => [record.id, record]));
  const builtins = BUILTIN_STATIONS.map((station) => {
    const id = stationRecordId(cafeId, station.id);
    const override = overrides.get(id);
    overrides.delete(id);
    return override ? { ...station, name: override.name, isActive: override.isActive } : station;
  });
  return [...builtins, ...Array.from(overrides.values(), (record) => ({ ...record, isBuiltIn: false }))];
}

export async function defaultCategoryStation(db: StationDatabase) {
  const cafeId = getCafeId();
  if (!cafeId) return PrepStation.kitchen;
  const records = await db.preparationStation.findMany({
    where: { cafeId },
    select: { id: true, name: true, isActive: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return stationCatalog(records, cafeId).find((station) => station.isActive)?.id ?? PrepStation.none;
}

export async function resolveStation(db: StationDatabase, user: AuthUser, station?: string) {
  const ownStation = user.prepStation ?? (user.role === Role.BAR ? PrepStation.bar : PrepStation.kitchen);
  const id = station ?? ownStation;
  if (id.startsWith('builtin:')) throw new NotFoundException('Станция не найдена');
  if ((user.role === Role.KITCHEN || user.role === Role.BAR) && id !== ownStation) {
    throw new ForbiddenException('Нет доступа к этой станции');
  }
  const builtin = BUILTIN_STATIONS.find((entry) => entry.id === id);
  const record = user.cafeId
    ? await db.preparationStation.findFirst({ where: { id: stationRecordId(user.cafeId, id), cafeId: user.cafeId } })
    : null;
  if (record) return { id, name: record.name, isActive: record.isActive, isBuiltIn: !!builtin };
  if (builtin) return builtin;
  throw new NotFoundException('Станция не найдена');
}

export async function staffStation(db: StationDatabase, role: Role, id?: string | null) {
  const production = role === Role.KITCHEN || role === Role.BAR;
  if (!production && id == null) return null;
  if (!production || id === PrepStation.none) {
    throw new BadRequestException('Станцию можно назначить только сотруднику кухни или бара');
  }
  const defaultStation = role === Role.BAR ? PrepStation.bar : PrepStation.kitchen;
  const selected = id ?? defaultStation;
  await assertAssignableStation(db, selected);
  if (BUILTIN_STATIONS.some((entry) => entry.id === selected)) {
    if (selected !== defaultStation) {
      throw new BadRequestException('Выберите роль, соответствующую станции');
    }
    return null;
  }
  return selected;
}

export async function lockStationRouting(tx: Prisma.TransactionClient, cafeId = getCafeId(), mode: 'exclusive' | 'shared' = 'exclusive') {
  if (!cafeId) return;
  const key = `prep-stations:${cafeId}`;
  if (mode === 'shared') {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock_shared(hashtext(${key}))) AS station_lock`;
  } else {
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS station_lock`;
  }
}

export async function assertAssignableStation(db: StationDatabase, station?: string | null) {
  if (station == null || station === PrepStation.none) return;
  if (station.startsWith('builtin:')) throw new BadRequestException('Выберите действующую станцию этого заведения');
  const cafeId = getCafeId();
  const builtin = BUILTIN_STATIONS.some(({ id }) => id === station);
  const record = cafeId && await db.preparationStation.findFirst({
    where: { id: stationRecordId(cafeId, station), cafeId },
    select: { isActive: true },
  });
  if (!(record ? record.isActive : builtin)) throw new BadRequestException('Выберите действующую станцию этого заведения');
}
