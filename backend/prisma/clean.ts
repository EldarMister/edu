/**
 * Очистка БД для сдачи проекта: удаляет ВСЕ данные (заказы, оплаты, смены,
 * аудит, заявки на печать, каталог, залы/столы, аккаунты) и создаёт один
 * аккаунт владельца для входа. Структура БД (миграции) сохраняется.
 *
 * Запуск (защищён от случайного вызова — нужен флаг --yes):
 *   npm run prisma:clean -- --yes
 *
 * Данные владельца можно задать переменными окружения:
 *   OWNER_NAME, OWNER_PHONE, OWNER_PASSWORD
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const OWNER = {
  name: process.env.OWNER_NAME ?? 'Владелец',
  phone: process.env.OWNER_PHONE ?? '+70000000004',
  password: process.env.OWNER_PASSWORD ?? 'owner123',
};

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error(
      '⛔ Это необратимо удалит ВСЕ данные из БД.\n' +
        '   Если уверены — запустите: npm run prisma:clean -- --yes',
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL ?? '';
  const host = url.replace(/.*@/, '').replace(/\/.*/, '');
  console.log(`🧹 Очистка БД (${host || 'DATABASE_URL'})...`);

  // Все таблицы схемы public, кроме служебной таблицы миграций Prisma.
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length > 0) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    // CASCADE снимает проблемы внешних ключей, RESTART IDENTITY сбрасывает счётчики.
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    console.log(`✓ Очищено таблиц: ${tables.length}`);
  }

  // Один аккаунт владельца для входа.
  const passwordHash = await bcrypt.hash(OWNER.password, 10);
  await prisma.user.create({
    data: { name: OWNER.name, phone: OWNER.phone, role: Role.OWNER, passwordHash },
  });

  console.log('✅ БД очищена. Создан владелец:');
  console.log(`   Телефон: ${OWNER.phone}`);
  console.log(`   Пароль:  ${OWNER.password}`);
  console.log('   ⚠️  Смените пароль после первого входа.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
