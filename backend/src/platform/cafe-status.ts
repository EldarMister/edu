import { ForbiddenException } from '@nestjs/common';
import { CafeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const CAFE_SUSPENDED_MESSAGE =
  'Кафе приостановлено. Обратитесь к администратору платформы.';

/**
 * Бросает 403, если кафе приостановлено. Используется на входе персонала,
 * в каждом запросе (JwtStrategy) и в QR-меню. cafeId может быть null
 * (исторические данные) — тогда пропускаем.
 */
export async function assertCafeActive(
  prisma: PrismaService,
  cafeId: string | null | undefined,
): Promise<void> {
  if (!cafeId) return;
  const cafe = await prisma.cafe.findUnique({
    where: { id: cafeId },
    select: { status: true },
  });
  if (cafe?.status === CafeStatus.suspended) {
    throw new ForbiddenException(CAFE_SUSPENDED_MESSAGE);
  }
}
