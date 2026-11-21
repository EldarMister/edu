const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/features/finance/Payroll.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText;

const rows = [
  { userId: 'a', name: 'Оля', position: 'Бариста', available: 300, estimate: 400, accrued: 100, paid: 100, due: 0,
    rates: { hourly: 100, perShift: 0, monthly: 0, personalPercent: 5, shiftPercent: 0 },
    hours: 3.5, shifts: 1, days: 1, personalSales: 1000, shiftSales: 1600,
    hourlyPay: 350, shiftPay: 0, monthlyPay: 0, personalCommission: 50, shiftCommission: 0 },
  { userId: 'b', name: 'Иван', position: 'Кассир', available: 0, estimate: 500, accrued: 520, paid: 200, due: 320,
    rates: { hourly: 0, perShift: 250, monthly: 0, personalPercent: 0, shiftPercent: 0 },
    hours: 16, shifts: 2, days: 2, personalSales: 1200, shiftSales: 2200,
    hourlyPay: 0, shiftPay: 500, monthlyPay: 0, personalCommission: 0, shiftCommission: 0 },
];
const record = (id, amount, paidAmount, extra) => ({
  id, userId: 'b', employeeName: 'Иван', amount, paidAmount, createdAt: '2026-11-10T10:00:00Z', ...extra,
});
const records = [record('wage', 500, 200), record('bonus', 20, 0, { supplemental: true }), record('cancelled', 900, 0, { voidedAt: '2026-11-16T10:00:00Z' })];

function setup(canManage = true) {
  const payouts = [];
  const months = [];
  const hooks = new Map();
  let currentState;
  let index;
  const dependencies = {
    react: {
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      useState(initial) {
        const slot = index++;
        if (!(slot in currentState)) currentState[slot] = typeof initial === 'function' ? initial() : initial;
        const state = currentState;
        return [state[slot], (next) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
      },
    },
    'react-native': { StyleSheet: { create: (styles) => styles } },
    'expo-crypto': { randomUUID: () => 'request-key' },
    '@/components/BottomSheet': { BottomSheet: 'BottomSheet', SheetScrollView: 'SheetScrollView' },
    '@/components/FastPressable': { FastPressable: 'FastPressable' },
    '@/components/PwaIcon': { PwaIcon: 'Icon' },
    '@/components/Select': { Select: 'Select' },
    '@/components/themed': { View: 'View' },
    '@/components/typography': { Text: 'Text' },
    '@/components/ui': { Button: 'Button', EmptyState: 'EmptyState', Field: 'Field' },
    '@/theme': { colors: {}, spacing: {} },
    './api': {
      usePayroll(month) { months.push(month); return { data: { staff: rows, records } }; },
      useFinanceWrites: () => ({ payout: { mutateAsync: async (payout) => payouts.push(payout) } }),
    },
    './components': { FinanceLine: 'FinanceLine', FinanceForm: 'FinanceForm', SelectField: 'SelectField', MoneyField: 'MoneyField', financeStyles: {} },
    './format': { financeDay: () => '2026-11-21', financeDateTime: () => '10.11', financeMoney: (number) => number + ' с', parseMoney: Number },
    './rules': { choice: ({ id, name }) => ({ value: id, label: name }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { exports: module.exports, React: dependencies.react, require: (name) => dependencies[name] });

  const data = { canManage, canViewAll: true, employees: [], accounts: [{ id: 'bank', name: 'Банк' }] };
  function view(type = module.exports.PayrollRegister, props = { data }) {
    if (!hooks.has(type)) hooks.set(type, []);
    currentState = hooks.get(type);
    index = 0;
    return type(props);
  }
  function nodes(tree) {
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
  }
  function find(tree, type, label) {
    return nodes(tree).find((node) => (node.type?.name ?? node.type) === type &&
      (!label || (node.props.title ?? node.props.label ?? node.props.accessibilityLabel) === label));
  }
  return { view, find, months, payouts, nodes };
}

test('salary register filters payable staff, totals the filtered rows and navigates between months', () => {
  const app = setup();
  let tree = app.view();
  assert.equal(app.find(tree, 'MonthButton').props.direction, -1);
  app.find(tree, 'MonthButton').props.onPress();
  tree = app.view();
  assert.equal(app.months.at(-1), '2026-10');
  app.find(tree, 'Select', 'Состояние расчёта').props.onChange('due');
  tree = app.view();
  app.find(tree, 'Button', 'Расчёт').props.onPress();
  const details = app.find(app.view(), 'PayrollEmployeeDetails');
  assert.equal(details.props.employee.name, 'Иван');
  const totals = app.nodes(tree).filter((node) => node.type === 'FinanceLine' && node.props.label === 'К выплате');
  assert.deepEqual(totals.map(({ props }) => props.value), ['320 с', '320 с']);
});

test('salary details expose rates to read-only staff and exclude cancelled accruals from payouts', async () => {
  const readOnly = setup(false);
  readOnly.find(readOnly.view(), 'Button', 'Расчёт').props.onPress();
  const employee = readOnly.find(readOnly.view(), 'PayrollEmployeeDetails');
  let sheet = readOnly.view(employee.type, employee.props);
  assert.equal(readOnly.find(sheet, 'Button', 'Начислить по ставкам'), undefined);
  readOnly.find(sheet, 'FastPressable', 'Расшифровка расчёта').props.onPress();
  sheet = readOnly.view(employee.type, employee.props);
  const breakdown = readOnly.find(sheet, 'PayrollBreakdown');
  assert.equal(readOnly.find(readOnly.view(breakdown.type, breakdown.props), 'FinanceLine', 'Личные продажи').props.value, '50 с');

  const cashier = setup();
  cashier.find(cashier.view(), 'Select', 'Состояние расчёта').props.onChange('due');
  cashier.find(cashier.view(), 'Button', 'Расчёт').props.onPress();
  const target = cashier.find(cashier.view(), 'PayrollEmployeeDetails');
  cashier.find(cashier.view(target.type, target.props), 'Button', 'Выплатить зарплату').props.onPress();
  const payout = cashier.find(cashier.view(target.type, target.props), 'PayoutForm');
  assert.deepEqual(Array.from(payout.props.accruals, ({ id }) => id), ['wage', 'bonus']);
  let form = cashier.view(payout.type, payout.props);
  cashier.find(form, 'SelectField', 'Что выплатить').props.onChange('bonus');
  form = cashier.view(payout.type, payout.props);
  assert.equal(cashier.find(form, 'MoneyField', 'Сумма выплаты').props.value, '20');
  await cashier.find(form, 'FinanceForm').props.submit();
  assert.equal(cashier.payouts[0].id, 'bonus');
  assert.equal(cashier.payouts[0].values.amount, 20);
});
