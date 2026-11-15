import { Prisma } from '@prisma/client';

export async function lockFinance(tx: Prisma.TransactionClient, cafeId: string) {
  await tx.$queryRaw`SELECT id FROM cafes WHERE id = ${cafeId} FOR UPDATE`;
}

export async function ensureFinanceAccounts(tx: Prisma.TransactionClient, cafeId: string) {
  await lockFinance(tx, cafeId);
  const existing = await tx.financeAccount.findMany({ where: { cafeId, isDefault: true } });
  const getDefault = async (type: 'cash' | 'noncash', defaultName: string) => {
    const found = existing.find((account) => account.type === type);
    if (found) return found;
    const names = new Set((await tx.financeAccount.findMany({ where: { cafeId }, select: { name: true } })).map((a) => a.name));
    let name = defaultName;
    for (let suffix = 2; names.has(name); suffix++) name = `${defaultName} (${suffix})`;
    return tx.financeAccount.create({ data: { cafeId, type, name, isDefault: true } });
  };
  const cash = await getDefault('cash', 'Касса');
  const noncash = await getDefault('noncash', 'Расчётный счёт');
  return { cash, noncash };
}
