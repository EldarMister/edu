// Создание супер-админа платформы (первый вход в панель управления кафе).
// Запуск:  npm run platform:create-admin -- "<логин>" "<Имя>" "<пароль>"
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function main() {
  const [login, name, password] = process.argv.slice(2);
  if (!login || !name || !password) {
    console.error('Использование: npm run platform:create-admin -- "<логин>" "<Имя>" "<пароль>"');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const admin = await prisma.platformAdmin.upsert({
      where: { login: login.trim() },
      update: { name: name.trim(), passwordHash, isActive: true },
      create: { login: login.trim(), name: name.trim(), passwordHash },
    });
    console.log(`✅ Супер-админ готов: «${admin.name}» · вход по логину ${admin.login}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
