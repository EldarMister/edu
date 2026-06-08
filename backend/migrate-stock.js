const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.dish.updateMany({
    where: { stock: null },
    data: { stock: 100, trackInventory: true, unit: 'шт' }
  });
  await prisma.dishVariant.update({
    where: { stock: null },
    data: { stock: 100, unit: 'шт' }
  }).catch(() => {}); // in case of error with updateMany vs update on variants, let's just use updateMany
  
  await prisma.dishVariant.updateMany({
    where: { stock: null },
    data: { stock: 100, unit: 'шт' }
  });

  console.log('Stock migration complete!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
