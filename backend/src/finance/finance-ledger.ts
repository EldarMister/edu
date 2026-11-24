import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, type CashShift } from '@prisma/client';

export async function assertDrawerBalance(
  tx: Prisma.TransactionClient, shift: Pick<CashShift, 'id' | 'cafeId' | 'accountId' | 'openingAmount'>, change: Prisma.Decimal,
) {
  if (!change.isNegative()) return;
  const movement = await tx.financeEntry.aggregate({
    where: { cafeId: shift.cafeId, accountId: shift.accountId, cashShiftId: shift.id,
      OR: [{ sourceKey: null }, { sourceKey: { notIn: ['cash-open:' + shift.id, 'cash-close:' + shift.id] } }] },
    _sum: { amount: true },
  });
  if (shift.openingAmount.add(movement._sum.amount ?? 0).add(change).isNegative()) {
    throw new BadRequestException('Операция оставит отрицательный остаток наличных в открытой кассе');
  }
}

export async function lockFinance(tx: Prisma.TransactionClient, cafeId: string) {
  // Serialize finance writers without waiting on foreign keys from new payments.
  await tx.$queryRaw`SELECT id FROM cafes WHERE id = ${cafeId} FOR NO KEY UPDATE`;
}

export async function findAccount(db: Prisma.TransactionClient, cafeId: string, id: string) {
  const account = await db.financeAccount.findFirst({ where: { cafeId, id, archivedAt: null } });
  if (!account) throw new NotFoundException('Счёт не найден');
  return account;
}

export async function shiftForEntry(db: Prisma.TransactionClient, cafeId: string, accountId: string, at: Date, amount?: Prisma.Decimal) {
  const shift = await db.cashShift.findFirst({ where: { cafeId, accountId }, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }] });
  if (!shift) return undefined;
  if (shift.closedAt) {
    if (at < shift.closedAt) throw new ConflictException('Дата операции относится к закрытому кассовому периоду');
    return undefined;
  }
  if (at < shift.openedAt) throw new BadRequestException('Дата операции раньше открытия кассовой смены');
  if (amount) await assertDrawerBalance(db, shift, amount);
  return shift.id;
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
