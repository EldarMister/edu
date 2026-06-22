// Регистрация нового кафе: Cafe + первый OWNER + дефолтные Settings.
// Запуск:  npm run cafe:create -- "<Название кафе>" "<Имя владельца>" "<+телефон>" "<пароль>"
// Телефон глобально уникален (вход определяет кафе) — поэтому он же логин OWNER.
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function main() {
  const [cafeName, ownerName, rawPhone, password] = process.argv.slice(2);
  if (!cafeName || !ownerName || !rawPhone || !password) {
    console.error('Использование: npm run cafe:create -- "<Кафе>" "<Владелец>" "<+телефон>" "<пароль>"');
    process.exit(1);
  }
  const phone = rawPhone.replace(/[^\d+]/g, '');

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      console.error(`❌ Телефон ${phone} уже занят (телефоны глобально уникальны).`);
      process.exit(1);
    }
    const passwordHash = await bcrypt.hash(password, 10);

    // Скрипт работает вне HTTP-контекста (без авто-скоупа) — cafeId проставляем явно.
    const { cafe } = await prisma.$transaction(async (tx) => {
      const cafe = await tx.cafe.create({ data: { name: cafeName } });
      await tx.user.create({
        data: { cafeId: cafe.id, name: ownerName, phone, role: Role.OWNER, passwordHash },
      });
      await tx.settings.create({ data: { cafeId: cafe.id, cafeName } });
      return { cafe };
    });

    console.log(`✅ Кафе создано: «${cafe.name}» (id ${cafe.id})`);
    console.log(`   Владелец: ${ownerName} · вход по ${phone}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
