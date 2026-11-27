import { BadRequestException } from '@nestjs/common';
import type { Ingredient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { readImportSpreadsheet } from '../warehouse/read-import-spreadsheet';
import { normalizeUnit, toBase, unitType } from '../warehouse/units';
import { MAIN_SCREEN } from './main-menu-category';
import type { MenuEntryDto, MenuRecipeDto } from './menu-entry.dto';

export type ImportKind = MenuEntryDto['catalogKind'];
export type MenuImportFile = { originalname: string; buffer: Buffer };
type Card = { dto: MenuEntryDto; category: string; row: number };
type IngredientOption = Pick<Ingredient, 'id' | 'name' | 'displayUnit' | 'unitType'>;

const fields = {
  name: ['название', 'наименование', 'товар', 'техкарта'],
  category: ['категория'],
  price: ['цена', 'цена, сом', 'цена продажи', 'цена продажи, сом'],
  unit: ['ед. измерения', 'единица измерения', 'ед. брутто'],
  ingredient: ['ингредиент', 'компонент', 'ингредиент / полуфабрикат'],
  amount: ['брутто', 'количество'],
};
type Field = keyof typeof fields;
const key = (value: string) => value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru');
const identity = (categoryId: string, name: string) => JSON.stringify([categoryId, key(name)]);

export function readMenuImport(file: MenuImportFile, kind: ImportKind) {
  try {
    const sheets = readImportSpreadsheet(file.buffer, extname(file.originalname).toLowerCase());
    if (sheets.length !== 1) throw new Error('Используйте шаблон импорта с одним листом.');
    const [headings, ...rows] = sheets[0];
    if (!headings?.length || !rows.length) throw new Error('Добавьте заголовки и хотя бы одну строку.');
    const normalized = headings.map((cell) => key(String(cell)));
    const columns = new Map<Field, number>();
    for (const [field, aliases] of Object.entries(fields)) {
      const indices = normalized.flatMap((title, index) => aliases.includes(title) ? [index] : []);
      if (indices.length > 1) throw new Error(`Столбец «${headings[indices[0]]}» указан дважды.`);
      if (indices.length) columns.set(field as Field, indices[0]);
    }
    if (!columns.has('name') || !columns.has('price')) throw new Error('В таблице нужны столбцы «Название» и «Цена».');
    if (kind === 'goods' && (columns.has('ingredient') || columns.has('amount'))) throw new Error('Для состава выберите импорт техкарт.');
    for (const title of ['вариант', 'весовой товар', 'обработка', 'склад списания', 'ед. выхода', 'цех', 'налог', 'доступность']) {
      const index = normalized.indexOf(title);
      if (index >= 0 && rows.some(row => String(row[index] ?? '').trim())) {
        throw new Error(`Импорт по шаблону не поддерживает заполненный столбец «${headings[index]}».`);
      }
    }
    const typeColumn = normalized.indexOf('тип');
    if (typeColumn >= 0 && rows.some(row => !['', 'техкарта'].includes(key(String(row[typeColumn] ?? ''))))) {
      throw new Error('Сеты и другие типы позиций не входят в шаблон обычных техкарт.');
    }
    return rows.map(row => Object.fromEntries([...columns].map(([field, index]) => [field, String(row[index] ?? '').trim()])) as Partial<Record<Field, string>>);
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : 'Не удалось прочитать таблицу.');
  }
}

function numberFromCell(value: string, description: string, max: number, precision: number) {
  const text = value.replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${precision}})?$`).test(text) || Number(text) > max) {
    throw new Error(`Проверьте поле «${description}».`);
  }
  return Number(text);
}

function spreadsheetUnit(value: string) {
  const unit = value.toLowerCase().replace(/\.$/u, '');
  if (!/^(g|kg|ml|l|pcs|г|кг|мл|л|шт)$/u.test(unit)) throw new Error(`Неизвестная единица измерения «${value}».`);
  return normalizeUnit(unit);
}

export async function prepareMenuImport(tx: Prisma.TransactionClient, cafeId: string, kind: ImportKind,
  rows: ReturnType<typeof readMenuImport>, canEditRecipe: boolean) {
  const ingredientNames = rows.some(row => row.ingredient) && kind === 'recipe' && canEditRecipe;
  const [categories, existing, ingredients] = await Promise.all([
    tx.category.findMany({ where: { cafeId, archivedAt: null }, select: { id: true, name: true, parentId: true } }),
    tx.dish.findMany({ where: { cafeId, catalogKind: kind }, select: { name: true, categoryId: true } }),
    ingredientNames ? tx.ingredient.findMany({ where: { cafeId, isActive: true }, select: { id: true, name: true, displayUnit: true, unitType: true } })
      : Promise.resolve<IngredientOption[]>([]),
  ]);
  const rootId = categories.find(item => item.id.startsWith('menu-root:'))?.id ?? MAIN_SCREEN;
  const existingKeys = new Set(existing.map(row => identity(row.categoryId, row.name)));
  const byId = new Map(categories.map(item => [item.id, item]));
  function categoryPath(id: string) {
    const seen = new Set<string>();
    const names: string[] = [];
    for (let current = byId.get(id); current && !seen.has(current.id); current = byId.get(current.parentId ?? '')) {
      seen.add(current.id);
      if (current.id !== rootId) names.unshift(current.name);
    }
    return names.join(' / ');
  }
  const categoryOptions = categories.filter(item => item.id !== rootId).map(item => ({ ...item, path: categoryPath(item.id) }));
  const ingredientsByName = new Map<string, IngredientOption[]>();
  for (const ingredient of ingredients) {
    const name = key(ingredient.name);
    const matches = ingredientsByName.get(name);
    if (matches) matches.push(ingredient); else ingredientsByName.set(name, [ingredient]);
  }
  const cards = new Map<string, Card>();
  const errors: { row: number; message: string }[] = [];
  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    try {
      if (!row.name || row.name.length > 120) throw new Error('Укажите название до 120 символов.');
      let categoryId = rootId;
      let category = 'Главный экран';
      if (row.category && key(row.category) !== key(category)) {
        const options = categoryOptions.filter(item => key(item.name) === key(row.category!) || key(item.path) === key(row.category!));
        if (options.length !== 1) throw new Error(`Категория «${row.category}» не найдена или совпадает с несколькими. Укажите полный путь.`);
        categoryId = options[0].id;
        category = options[0].path;
      }
      const id = identity(categoryId, row.name);
      const existingCard = cards.get(id);
      const price = row.price !== undefined && row.price !== '' ? numberFromCell(row.price, 'Цена', 99999999.99, 2) : existingCard?.dto.dish.price;
      if (price === undefined) throw new Error('Укажите цену.');
      if (existingCard && (kind === 'goods' || existingCard.dto.dish.price !== price)) {
        throw new Error('Позиция указана повторно или имеет разные цены.');
      }
      const dto: MenuEntryDto = existingCard?.dto ?? {
        catalogKind: kind, requestKey: `import-${randomUUID()}`, dish: { categoryId, name: row.name, price },
      };
      if (kind === 'goods') dto.dish.unit = spreadsheetUnit(row.unit || 'шт');
      if (kind === 'recipe' && (row.ingredient || row.amount || row.unit)) {
        if (!canEditRecipe) throw new Error('У вас нет права изменять состав техкарт.');
        const ingredientMatches = ingredientsByName.get(key(row.ingredient ?? '')) ?? [];
        if (ingredientMatches.length !== 1) throw new Error(`Компонент «${row.ingredient || '—'}» не найден или совпадает с несколькими.`);
        const component = ingredientMatches[0];
        const unit = spreadsheetUnit(row.unit || component.displayUnit);
        const amount = numberFromCell(row.amount ?? '', 'Брутто', 100000000, 6);
        if (unitType(unit) !== component.unitType || toBase(amount, unit) < 0.001 || toBase(amount, unit) > 99999999999) {
          throw new Error('Проверьте количество и единицу измерения компонента.');
        }
        const recipe: MenuRecipeDto = dto.recipe ?? { items: [] };
        if (recipe.items.length >= 200 || recipe.items.some(item => item.ingredientId === component.id)) {
          throw new Error('Компонент указан дважды или в техкарте больше 200 компонентов.');
        }
        recipe.items.push({ ingredientId: component.id, amount, unit });
        dto.recipe = recipe;
      }
      cards.set(id, { dto, category, row: existingCard?.row ?? line });
    } catch (error) {
      errors.push({ row: line, message: error instanceof Error ? error.message : 'Проверьте строку.' });
    }
  }
  if (cards.size > 200) throw new BadRequestException('Добавьте в файл до 200 товаров или техкарт.');
  const entries = [...cards].filter(([id]) => !existingKeys.has(id)).map(([, card]) => card.dto);
  const preview = [...cards].map(([id, { dto, category, row }]) => ({
    name: dto.dish.name, category, price: dto.dish.price, components: dto.recipe?.items.length ?? 0, row, exists: existingKeys.has(id),
  }));
  return { entries, errors, preview };
}
