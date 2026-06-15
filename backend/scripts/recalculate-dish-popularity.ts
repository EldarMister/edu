import { PrismaService } from '../src/prisma/prisma.service';
import { DishPopularityService } from '../src/dishes/dish-popularity.service';
import type { EventsGateway } from '../src/realtime/events.gateway';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const events = { emitBroadcast: () => undefined } as unknown as EventsGateway;
    const service = new DishPopularityService(prisma, events);
    await service.recalculateAll();
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log('Dish popularity recalculated');
  })
  .catch((err) => {
    console.error('Failed to recalculate dish popularity', err);
    process.exitCode = 1;
  });
