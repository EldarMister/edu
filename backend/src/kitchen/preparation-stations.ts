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

export async function resolveStation(db: StationDatabase, user: AuthUser, station?: string) {
  const id = station ?? (user.role === Role.BAR ? PrepStation.bar : PrepStation.kitchen);
  const builtin = BUILTIN_STATIONS.find((entry) => entry.id === id);
  if (builtin) {
    if ((user.role === Role.KITCHEN && id !== PrepStation.kitchen) || (user.role === Role.BAR && id !== PrepStation.bar)) {
      throw new ForbiddenException('Нет доступа к этой станции');
    }
    return builtin;
  }
  const record = user.cafeId && typeof id === 'string'
    ? await db.preparationStation.findFirst({ where: { id, cafeId: user.cafeId } })
    : null;
  if (!record) throw new NotFoundException('Станция не найдена');
  return { id: record.id, name: record.name, isActive: record.isActive, isBuiltIn: false };
}

export async function lockStationRouting(tx: Prisma.TransactionClient, cafeId = getCafeId()) {
  if (!cafeId) return;
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`prep-stations:${cafeId}`}))) AS station_lock`;
}

export async function assertAssignableStation(db: StationDatabase, station?: string | null) {
  if (station == null || station === PrepStation.none || BUILTIN_STATIONS.some(({ id }) => id === station)) return;
  const cafeId = getCafeId();
  const exists = cafeId && await db.preparationStation.findFirst({ where: { id: station, cafeId, isActive: true }, select: { id: true } });
  if (!exists) throw new BadRequestException('Выберите действующую станцию этого заведения');
}
