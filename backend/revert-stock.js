const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.dish.updateMany({
    data: { trackInventory: false, stock: null }
  });
  await prisma.dishVariant.updateMany({
    data: { stock: null }
  });

  console.log('Stock reverted!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
