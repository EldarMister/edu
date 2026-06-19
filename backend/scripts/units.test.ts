/**
 * Тесты конвертации складских единиц (ТЗ §13).
 * Запуск: npx ts-node --transpile-only scripts/units.test.ts
 * Без jest (его в проекте нет) — простой раннер с ассертами.
 */
import {
  assertUnitMatchesType,
  costFromBase,
  costToBase,
  fromBase,
  normalizeUnit,
  toBase,
  unitType,
} from '../src/warehouse/units';

let passed = 0;
let failed = 0;

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}
function check(name: string, actual: number, expected: number) {
  if (approx(actual, expected)) {
    passed++;
    console.log(`  ✅ ${name}: ${actual}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}: получили ${actual}, ожидали ${expected}`);
  }
}
function checkThrows(name: string, fn: () => void) {
  try {
    fn();
    failed++;
    console.error(`  ❌ ${name}: ожидали ошибку, но её не было`);
  } catch {
    passed++;
    console.log(`  ✅ ${name}: ошибка как и ожидалось`);
  }
}

console.log('Конвертация и расчёты склада (ТЗ §13):');

// Базовая конвертация количеств.
check('30 кг → 30000 г', toBase(30, 'kg'), 30000);
check('500 г → 500 г', toBase(500, 'g'), 500);
check('2 л → 2000 мл', toBase(2, 'l'), 2000);
check('250 мл → 250 мл', toBase(250, 'ml'), 250);
check('10 шт → 10 шт', toBase(10, 'pcs'), 10);

// Конвертация себестоимости.
check('400 с/кг → 0.4 с/г', costToBase(400, 'kg'), 0.4);
check('0.4 с/г → 400 с/кг', costFromBase(0.4, 'kg'), 400);

// Стоимость остатка (главный баг: должно быть 12000, не 4 008 000).
{
  const stockBase = toBase(30, 'kg'); // 30000 г
  const avgCostBase = costToBase(400, 'kg'); // 0.4 с/г
  check('30 кг × 400 с/кг = 12000 с (через базу)', stockBase * avgCostBase, 12000);
}
check('30000 г × 0.4 с/г = 12000 с', 30000 * 0.4, 12000);

// Вычитание остатков в совместимых единицах.
{
  const afterBase = toBase(30, 'kg') - toBase(500, 'g'); // 29500 г
  check('30 кг − 500 г = 29.5 кг', fromBase(afterBase, 'kg'), 29.5);
}
{
  const afterBase = toBase(2, 'l') - toBase(250, 'ml'); // 1750 мл
  check('2 л − 250 мл = 1.75 л', fromBase(afterBase, 'l'), 1.75);
}
check('10 шт − 3 шт = 7 шт', toBase(10, 'pcs') - toBase(3, 'pcs'), 7);

// Совместимость единиц (ТЗ §10).
check('normalizeUnit("кг") = factor kg', toBase(1, normalizeUnit('кг')), 1000);
checkThrows('кг несовместима с count (шт)', () => assertUnitMatchesType('kg', unitType('pcs')));
checkThrows('г несовместима с count (шт)', () => assertUnitMatchesType('g', 'count'));
checkThrows('неизвестная единица → ошибка', () => normalizeUnit('фунт'));

console.log(`\nИтого: ${passed} ✅, ${failed} ❌`);
process.exit(failed > 0 ? 1 : 0);
