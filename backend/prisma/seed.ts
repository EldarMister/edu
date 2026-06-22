import { PrismaClient, Role, DiscountType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // --- Кафе (арендатор) — всё демо-данные привязываем к нему (мультитенантность) ---
  const cafe = await prisma.cafe.upsert({
    where: { id: 'seed-cafe-1' },
    update: { name: 'Демо-кафе' },
    create: { id: 'seed-cafe-1', name: 'Демо-кафе' },
  });
  await prisma.settings.upsert({
    where: { cafeId: cafe.id },
    update: {},
    create: { cafeId: cafe.id, cafeName: 'Демо-кафе' },
  });

  // --- Пользователи (вход по телефону + пароль) ---
  const users = [
    { name: 'Иванов И.', phone: '+70000000001', role: Role.WAITER, password: 'waiter123' },
    { name: 'Петров А.', phone: '+70000000002', role: Role.KITCHEN, password: 'kitchen123' },
    { name: 'Сидоров С.', phone: '+70000000003', role: Role.ADMIN, password: 'admin123' },
    { name: 'Кузнецов В.', phone: '+70000000004', role: Role.OWNER, password: 'owner123' },
  ];

  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { phone: u.phone },
      update: { name: u.name, role: u.role, passwordHash, isActive: true },
      create: { cafeId: cafe.id, name: u.name, phone: u.phone, role: u.role, passwordHash },
    });
  }
  console.log(`✓ ${users.length} пользователей`);

  // --- Зал и столы ---
  const hall = await prisma.hall.upsert({
    where: { id: 'seed-hall-main' },
    update: { name: 'Зал' },
    create: { id: 'seed-hall-main', cafeId: cafe.id, name: 'Зал', sortOrder: 0 },
  });
  const terrace = await prisma.hall.upsert({
    where: { id: 'seed-hall-terrace' },
    update: { name: 'Терраса' },
    create: { id: 'seed-hall-terrace', cafeId: cafe.id, name: 'Терраса', sortOrder: 1 },
  });

  // Столы как на макете: сетка номеров
  const mainTables = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 19, 20, 21];
  for (const number of mainTables) {
    await prisma.table.upsert({
      where: { hallId_number: { hallId: hall.id, number } },
      update: {},
      create: { cafeId: cafe.id, hallId: hall.id, number, seats: number % 3 === 0 ? 4 : 2, sortOrder: number },
    });
  }
  for (const number of [1, 2, 3, 4]) {
    await prisma.table.upsert({
      where: { hallId_number: { hallId: terrace.id, number } },
      update: {},
      create: { cafeId: cafe.id, hallId: terrace.id, number, seats: 4, sortOrder: number },
    });
  }
  console.log(`✓ 2 зала, ${mainTables.length + 4} столов`);

  // --- Категории и блюда (как на дизайн-референсе) ---
  const categoriesData: { name: string; dishes: { name: string; price: number; desc?: string }[] }[] = [
    {
      name: 'Супы',
      dishes: [
        { name: 'Борщ', price: 280, desc: 'Со сметаной' },
        { name: 'Грибной суп', price: 320, desc: 'Крем-суп' },
        { name: 'Куриный суп', price: 290 },
      ],
    },
    {
      name: 'Горячие',
      dishes: [
        { name: 'Паста Карбонара', price: 420, desc: 'С беконом' },
        { name: 'Стейк', price: 890 },
        { name: 'Филе лосося', price: 650, desc: 'На гриле' },
      ],
    },
    {
      name: 'Салаты',
      dishes: [
        { name: 'Цезарь', price: 380, desc: 'С курицей' },
        { name: 'Греческий салат', price: 320 },
        { name: 'Овощной', price: 240 },
      ],
    },
    {
      name: 'Напитки',
      dishes: [
        { name: 'Капучино', price: 180 },
        { name: 'Чай зелёный', price: 120 },
        { name: 'Кола', price: 150 },
        { name: 'Лимонад', price: 200, desc: 'Классический' },
      ],
    },
    {
      name: 'Десерты',
      dishes: [
        { name: 'Тирамису', price: 350 },
        { name: 'Чизкейк', price: 320 },
        { name: 'Мороженое', price: 180 },
      ],
    },
  ];

  let catIndex = 0;
  for (const cat of categoriesData) {
    const categoryId = `seed-cat-${catIndex}`;
    const category = await prisma.category.upsert({
      where: { id: categoryId },
      update: { name: cat.name, sortOrder: catIndex },
      create: { id: categoryId, cafeId: cafe.id, name: cat.name, sortOrder: catIndex },
    });

    let dishSort = 0;
    for (const d of cat.dishes) {
      const dishId = `seed-dish-${catIndex}-${dishSort}`;
      await prisma.dish.upsert({
        where: { id: dishId },
        update: { name: d.name, price: d.price, description: d.desc, categoryId: category.id },
        create: {
          id: dishId,
          cafeId: cafe.id,
          categoryId: category.id,
          name: d.name,
          description: d.desc,
          price: d.price,
          discountType: DiscountType.none,
          sortOrder: dishSort,
        },
      });
      dishSort += 1;
    }
    catIndex += 1;
  }
  console.log(`✓ ${categoriesData.length} категорий с блюдами`);

  console.log('✅ Seed завершён.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
