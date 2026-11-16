require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { FinanceService } = require('../src/finance/finance.service.ts');
const { CashShiftsService } = require('../src/cash-shifts/cash-shifts.module.ts');
const { currentPayrollMonth } = require('../src/finance/payroll.ts');
const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

async function fixture(run) {
  const db = new PrismaClient({ datasourceUrl: url });
  const cafe = await db.cafe.create({ data: { name: 'Salary corrections ' + randomUUID() } });
  const cafeId = cafe.id;
  try {
    const [owner, worker] = await Promise.all(['OWNER', 'WAITER'].map((role) => db.user.create({
      data: { cafeId, name: role, role, phone: randomUUID(), passwordHash: 'fixture' },
    })));
    const finance = new FinanceService(db, { log: async () => {} });
    const shifts = new CashShiftsService(db, { log: async () => {} }, { emitToWaiter() {}, emitToAdmin() {} });
    const month = currentPayrollMonth();
    const accrue = (amount, supplemental = false) => finance.accrue(owner, { userId: worker.id, month, amount, supplemental, requestKey: randomUUID() });
    await run({ db, cafeId, owner, worker, finance, shifts, month, accrue });
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.cashShift.deleteMany({ where: { cafeId } });
    await db.settings.deleteMany({ where: { cafeId } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.cafe.delete({ where: { id: cafeId } });
    await db.$disconnect();
  }
}

test('PostgreSQL: salary edit, partial payments, reversal and cancellation preserve both history and account balance', { skip: !url }, () => fixture(async ({ db, owner, finance, month, accrue }) => {
  const bank = await finance.createAccount(owner, { name: 'Зарплатный счёт', type: 'noncash', openingBalance: 1000 });
  const base = await accrue(300);
  const bonus = await accrue(50, true);
  const payout = (amount) => finance.paySalary(owner, base.id, { accountId: bank.id, amount, requestKey: randomUUID() });
  const first = await payout(100);
  const second = await payout(50);
  const report = async () => (await finance.payroll(owner, { month })).staff.find(({ userId }) => userId === base.userId);
  const balance = async () => (await finance.overview(owner, {})).accounts.find(({ id }) => id === bank.id).balance;
  assert.equal(await balance(), 850);
  assert.equal((await report()).due, 200);
  const change = { amount: 320, note: 'Уточнено', reason: 'Ошибка суммы', revision: 0, requestKey: randomUUID() };
  await assert.rejects(finance.editSalary(owner, base.id, { ...change, amount: 100 }), { status: 400 });
  await finance.editSalary(owner, base.id, change);
  await finance.editSalary(owner, base.id, change);
  await assert.rejects(finance.editSalary(owner, base.id, { ...change, amount: 350 }), { status: 409 });
  await assert.rejects(finance.editSalary(owner, base.id, { ...change, requestKey: randomUUID() }), { status: 409 });
  await assert.rejects(finance.editSalary(owner, base.id, { reason: 'Удалить', revision: 1, requestKey: randomUUID() }, true), { status: 409 });
  const detail = await finance.salaryDetails(owner, base.id);
  assert.equal(detail.history.length, 1);
  assert.deepEqual(detail.history[0].before, { amount: 300, note: null });
  assert.deepEqual(detail.history[0].after, { amount: 320, note: 'Уточнено' });
  assert.equal(detail.payments.length, 2);
  assert.ok(detail.payments.every(({ reversible }) => reversible));
  await assert.rejects(finance.salaryDetails({ ...owner, cafeId: randomUUID() }, base.id), { status: 404 });
  await assert.rejects(finance.reverseSalary({ ...owner, cafeId: randomUUID() }, base.id, first.id, 'Ошибка'), { status: 404 });
  await assert.rejects(finance.reverseSalary(owner, bonus.id, first.id, 'Ошибка'), { status: 404 });
  const reversal = await finance.reverseSalary(owner, base.id, first.id, 'Деньги не выдавали');
  assert.deepEqual(await finance.reverseSalary(owner, base.id, first.id, 'Деньги не выдавали'), reversal);
  assert.equal(await balance(), 950);
  assert.equal((await report()).paid, 50);
  assert.equal((await report()).due, 320);
  const overview = await finance.overview(owner, {});
  assert.equal(overview.flow.expense, 50);
  assert.equal(overview.flow.income, 0);
  assert.equal(overview.flow.closing, 950);
  assert.ok(overview.entries.find(({ id }) => id === first.id).reversedAt);
  await finance.reverseSalary(owner, base.id, second.id, 'Повторная ошибочная запись');
  const cancel = { revision: 1, reason: 'Заменим правильным начислением', requestKey: randomUUID() };
  await finance.editSalary(owner, base.id, cancel, true);
  await finance.editSalary(owner, base.id, cancel, true);
  assert.equal(await balance(), 1000);
  assert.equal((await report()).accrued, 50);
  assert.equal((await report()).due, 50);
  assert.equal((await finance.salaryDetails(owner, base.id)).history.length, 2);
  await assert.rejects(payout(1), { status: 409 });
  assert.equal(await db.financeEntry.count({ where: { salaryAccrualId: base.id } }), 4);
}));

test('PostgreSQL: salary payout reversal is allowed in the active drawer and blocked once reconciled', { skip: !url }, () => fixture(async ({ owner, finance, shifts, cafeId, accrue }) => {
  const cash = await finance.createAccount(owner, { name: 'Основная касса', type: 'cash', isDefault: true, openingBalance: 1000 });
  await shifts.setting(cafeId, true);
  const shift = await shifts.open(cafeId, owner.id, 1000);
  const base = await accrue(300);
  const payout = (amount) => finance.paySalary(owner, base.id, { accountId: cash.id, amount, requestKey: randomUUID() });
  const first = await payout(100);
  assert.equal((await shifts.list(cafeId, true)).current.expectedAmount, 900);
  await finance.reverseSalary(owner, base.id, first.id, 'Ошибочный счёт');
  assert.equal((await shifts.list(cafeId, true)).current.expectedAmount, 1000);
  const actual = await payout(80);
  await shifts.close(cafeId, owner.id, { shiftId: shift.id, amount: 920, expectedAmount: 920 });
  await assert.rejects(finance.reverseSalary(owner, base.id, actual.id, 'Ошибка'), { status: 409 });
  assert.equal((await finance.salaryDetails(owner, base.id)).payments.find(({ id }) => id === actual.id).reversible, false);
  assert.equal((await finance.overview(owner, {})).accounts.find(({ id }) => id === cash.id).balance, 920);
}));

test('PostgreSQL: correcting the initial account balance preserves reconciled drawer amounts', { skip: !url }, () => fixture(async ({ owner, finance, shifts, cafeId }) => {
  const cash = await finance.createAccount(owner, { name: 'Касса с начальным остатком', type: 'cash', isDefault: true, openingBalance: 100 });
  await shifts.setting(cafeId, true);
  const shift = await shifts.open(cafeId, owner.id, 100);
  await shifts.close(cafeId, owner.id, { shiftId: shift.id, amount: 100, expectedAmount: 100 });
  await finance.updateAccount(owner, cash.id, { openingBalance: 500 });
  const overview = await finance.overview(owner, {});
  assert.equal(overview.accounts.find(({ id }) => id === cash.id).balance, 100);
  assert.equal(overview.flow.opening, 500);
  assert.equal(overview.flow.expense, 400);
  assert.equal(overview.flow.closing, 100);
  assert.equal((await shifts.list(cafeId, true)).history[0].openingDifference, -400);
  assert.equal((await shifts.list(cafeId, true)).history[0].expectedAmount, 100);
  await finance.updateAccount(owner, cash.id, { openingBalance: 100 });
  assert.equal((await shifts.list(cafeId, true)).history[0].openingDifference, 0);
  assert.equal((await finance.overview(owner, {})).accounts.find(({ id }) => id === cash.id).balance, 100);
}));

test('PostgreSQL: every expense and withdrawal path preserves available physical cash atomically', { skip: !url }, () => fixture(async ({ db, owner, finance, shifts, cafeId, accrue }) => {
  const cash = await finance.createAccount(owner, { name: 'Касса для проверки', type: 'cash', isDefault: true });
  const bank = await finance.createAccount(owner, { name: 'Банк для перевода', type: 'noncash' });
  await shifts.setting(cafeId, true);
  const shift = await shifts.open(cafeId, owner.id, 100);
  const post = (kind, amount, extra = {}) => finance.post(owner, { accountId: cash.id, kind, amount, requestKey: randomUUID(), ...extra });
  const base = await accrue(500);
  await assert.rejects(post('expense', 101), { status: 400 });
  await assert.rejects(post('transfer', 101, { destinationAccountId: bank.id }), { status: 400 });
  await assert.rejects(finance.paySalary(owner, base.id, { accountId: cash.id, amount: 101, requestKey: randomUUID() }), { status: 400 });
  assert.equal(await db.financeEntry.count({ where: { cafeId, kind: { in: ['expense', 'transfer', 'salary'] } } }), 0);

  const income = await post('income', 100);
  await post('expense', 150);
  await assert.rejects(finance.reverseTransaction(owner, income.id, 'Ошибочный приход'), { status: 400 });
  assert.equal((await shifts.list(cafeId, true)).current.expectedAmount, 50);
  const posIncome = await shifts.createOperation(cafeId, owner, shift.id, { kind: 'income', amount: 100, requestKey: randomUUID() });
  await post('expense', 100);
  await assert.rejects(shifts.updateOperation(cafeId, owner, shift.id, posIncome.id), { status: 400 });
  await assert.rejects(shifts.updateOperation(cafeId, owner, shift.id, posIncome.id, { kind: 'income', amount: 20 }), { status: 400 });
  await assert.rejects(shifts.correctCashCount(cafeId, owner, shift.id, { openingAmount: 0 }), { status: 400 });
  assert.equal((await shifts.list(cafeId, true)).current.expectedAmount, 50);
  assert.equal((await db.financeEntry.findUnique({ where: { id: posIncome.id } })).amount.toNumber(), 100);
  const outcomes = await Promise.allSettled([post('expense', 40), post('expense', 40)]);
  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal((await shifts.list(cafeId, true)).current.expectedAmount, 10);
}));
