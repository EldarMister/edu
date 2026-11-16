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

export async function ensureCollectionAccount(tx: Prisma.TransactionClient, cafeId: string) {
  const accounts = await tx.financeAccount.findMany({ where: { cafeId } });
  const current = accounts.find(({ isCollection }) => isCollection);
  if (current) return current;
  const safe = accounts.find(({ name, isDefault, type, archivedAt }) =>
    type === 'cash' && !isDefault && !archivedAt && name.trim().toLocaleLowerCase('ru') === 'сейф');
  if (safe) return tx.financeAccount.update({ where: { cafeId, id: safe.id }, data: { isCollection: true } });
  const names = new Set(accounts.map(({ name }) => name.toLocaleLowerCase('ru')));
  let name = 'Сейф';
  for (let suffix = 2; names.has(name.toLocaleLowerCase('ru')); suffix++) name = `Сейф (${suffix})`;
  return tx.financeAccount.create({ data: { cafeId, name, type: 'cash', isCollection: true } });
}
