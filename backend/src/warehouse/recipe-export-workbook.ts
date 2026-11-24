import * as XLSX from 'xlsx';
import type { ProcessingStage } from './recipe-processing.dto';

export type RecipeExportKind = 'recipes' | 'preparations';

export type RecipeExportLine = {
  name: string;
  gross: number;
  unit: string;
  net: number | null;
  netGrams?: number | null;
  processing?: string;
  warehouse?: string | null;
  cost: number | null;
};

export type RecipeExportCard = {
  name: string;
  category: string | null;
  type: string;
  variant?: string | null;
  price?: number;
  output: { amount: number; unit: string } | null;
  cost: number | null;
  items: RecipeExportLine[];
};

const processingLabels: Record<string, string> = {
  cleaning: 'Очистка', boiling: 'Варка', frying: 'Жарка', stewing: 'Тушение', baking: 'Запекание',
};

export function recipeExportProcessing(stages: readonly ProcessingStage[], method: string | null) {
  return stages.length
    ? stages.map(({ method, lossPercent }) => `${processingLabels[method]} (${lossPercent}%)`).join(' → ')
    : method ? processingLabels[method] ?? method : '';
}

type SheetValue = string | number | null | undefined;

function appendSheet(book: XLSX.WorkBook, name: string, headers: string[], values: SheetValue[][]) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...values]);
  sheet['!cols'] = headers.map((value, index) => ({ wch: index === 0 ? 36 : Math.max(13, value.length + 3) }));
  if (values.length && sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
  XLSX.utils.book_append_sheet(book, sheet, name);
}

export function writeRecipeWorkbook(cards: RecipeExportCard[], kind: RecipeExportKind, includeComposition: boolean, showCosts: boolean): Buffer {
  const book = XLSX.utils.book_new();
  const recipes = kind === 'recipes';
  const title = recipes ? 'Техкарты' : 'Полуфабрикаты';
  const headings = ['Название', 'Категория', 'Тип', ...(recipes ? ['Вариант', 'Цена, сом'] : []), 'Выход', 'Ед. выхода'];
  if (showCosts) headings.push('Себестоимость, сом');
  appendSheet(book, title, headings, cards.map((card) => [card.name, card.category, card.type,
    ...(recipes ? [card.variant, card.price] : []), card.output?.amount, card.output?.unit, ...(showCosts ? [card.cost] : [])]));

  if (includeComposition) {
    const columns = [recipes ? 'Техкарта' : 'Полуфабрикат', ...(recipes ? ['Вариант'] : []), 'Компонент',
      'Брутто', 'Ед. брутто', 'Нетто', 'Ед. нетто', 'Нетто в ед. брутто', 'Обработка', ...(recipes ? ['Склад списания'] : [])];
    if (showCosts) columns.push('Себестоимость строки, сом');
    const values = cards.flatMap((card) => card.items.map((item) => [card.name, ...(recipes ? [card.variant] : []), item.name,
      item.gross, item.unit, item.netGrams ?? item.net, item.netGrams != null ? 'г' : item.net != null ? item.unit : null,
      item.netGrams != null && item.unit !== 'г' ? item.net : null, item.processing, ...(recipes ? [item.warehouse] : []),
      ...(showCosts ? [item.cost] : [])]));
    appendSheet(book, 'Состав', columns, values);
  }
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}
