require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PDFiumLibrary } = require('@hyzyla/pdfium');
const { PNG } = require('pngjs');
const XLSX = require('xlsx');
const { recognizeInvoice } = require('../src/warehouse/invoice-recognition.worker');
const { addInvoicePage, addInvoiceText, newInvoicePreview } = require('../src/warehouse/invoice-lines');

function invoicePdf() {
  const stream = 'BT /F1 18 Tf 28 250 Td (Supplier: Market) Tj 0 -42 Td (Milk l 3 14.00 42.00) Tj 0 -42 Td (Total 42.00) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 380 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
  ];
  let contents = '%PDF-1.4\n';
  const offsets = objects.map((obj, i) => {
    const offset = contents.length;
    contents += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n';
    return offset;
  });
  const xref = contents.length;
  contents += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(pos => String(pos).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(contents + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
}

test('CSV, Excel and legacy XLS map labeled columns, retain unknown values and the printed total', async () => {
  const sheet = [['Поставщик', 'Ферма'], ['Дата накладной', '23.11.2026'],
    ['Товар', 'Ед. изм.', 'Цена', 'Количество', 'Сумма'], ['Молоко', 'л', '14,50', 2, 29],
    ['Неизвестный сыр', '', 0, 1, 0], ['Итого', '', '', '', 29]];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet), 'Поставка');
  for (const ext of ['csv', 'xlsx', 'xls']) {
    const buf = ext === 'csv' ? Buffer.from(sheet.map(row => row.join(';')).join('\r\n')) : XLSX.write(book, { type: 'buffer', bookType: ext });
    const data = await recognizeInvoice([{ originalname: 'поставка.' + ext, buffer: buf }]);
    assert.deepEqual(data.lines, [{ name: 'Молоко', unit: 'л', price: 14.5, quantity: 2, total: 29 },
      { name: 'Неизвестный сыр', unit: '', price: 0, quantity: 1, total: 0 }]);
    assert.equal(data.supplier, 'Ферма');
    assert.equal(data.invoiceDate, '2026-11-23');
    assert.equal(data.total, 29);
  }
});

test('paper invoice recognizes the quantity, unit price and line total with a Russian unit on either side', () => {
  const result = newInvoicePreview();
  addInvoiceText(result, 'Мука кг 2 14,00 28,00\nМолоко 3 л 16,00 48,00\nИтого 76,00');
  assert.equal(result.total, 76);
  assert.deepEqual(result.lines.map(({ name, unit, quantity, price }) => [name, unit, quantity, price]),
    [['Мука', 'кг', 2, 14], ['Молоко', 'л', 3, 16]]);
});

test('writeoff imports quantities and per-line notes from a price-free sheet', async () => {
  const buffer = Buffer.from('Наименование;Количество;Единица;Детали\r\nХлеб;2;шт.;Повреждена упаковка\r\nМолоко;;л;Уточнить количество');
  const { lines } = await recognizeInvoice([{ originalname: 'списание.csv', buffer }], true);
  assert.deepEqual(lines.map(({ name, quantity, unit, details }) => ({ name, quantity, unit, details })), [
    { name: 'Хлеб', quantity: 2, unit: 'шт.', details: 'Повреждена упаковка' },
    { name: 'Молоко', quantity: null, unit: 'л', details: 'Уточнить количество' },
  ]);
});

test('spreadsheets keep VAT-exclusive cost, VAT and payable distinct across reordered columns', async () => {
  const headers = ['Наименование', 'Ед.', 'Количество', 'Всего с НДС', 'Сумма НДС', 'НДС %', 'Цена без НДС', 'Сумма без НДС'];
  const data = [headers, ['Мука', 'кг', 2, 206, 6, '3%', 100, 200], ['Итого', '', '', 206, 6, '', '', 200]];
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet.F2 = { t: 'n', v: 0.03, z: '0%' };
  XLSX.utils.book_append_sheet(book, sheet, 'С НДС');
  for (const ext of ['csv', 'xlsx', 'xls']) {
    const bytes = ext === 'csv' ? Buffer.from(data.map(row => row.join(';')).join('\n')) : XLSX.write(book, { type: 'buffer', bookType: ext });
    const result = await recognizeInvoice([{ originalname: 'налоги.' + ext, buffer: bytes }]);
    assert.deepEqual(result.lines[0], { name: 'Мука', unit: 'кг', quantity: 2, price: 100, total: 200,
      tax: { rate: 3, amount: 6, totalWithTax: 206, needsReview: false } });
    assert.equal(result.total, 206);
  }
  const grossOnly = Buffer.from('Наименование;Количество;Цена с НДС;Всего с НДС;Ставка НДС\nМука;2;103;206;3%\nСыр;1;103;103;');
  const preview = await recognizeInvoice([{ originalname: 'gross.csv', buffer: grossOnly }]);
  assert.equal(preview.lines[0].price, 100);
  assert.equal(preview.lines[0].total, 200);
  assert.equal(preview.lines[1].total, null);
  assert.equal(preview.lines[1].tax.needsReview, true);
});

test('printed multiword VAT column headings retain their meaning in OCR coordinates', () => {
  const rows = [
    [['Товар', 0], ['Количество', 120], ['Цена', 260], ['без', 300], ['НДС', 334], ['Сумма', 455], ['без', 506], ['HOC', 540],
      ['НДС', 645], ['%', 676], ['Сумма', 775], ['HOC', 825], ['Всего', 930], ['с', 980], ['HAC', 994]],
    [['Мука', 0], ['2', 120], ['100', 260], ['200', 455], ['3%', 645], ['6', 775], ['206', 930]],
  ];
  const tsv = rows.flatMap((row, y) => row.map(([word, x], i) => ['5',1,1,1,y,i,x,20+y*40,word.length*9,16,95,word].join('\t'))).join('\n');
  const result = newInvoicePreview();
  addInvoicePage(result, '', tsv);
  assert.deepEqual(result.lines[0], { name: 'Мука', quantity: 2, unit: '', price: 100, total: 200,
    tax: { rate: 3, amount: 6, totalWithTax: 206, needsReview: false } });
});

test('reads a PDF and its rasterized PNG with real offline OCR', async () => {
  const pdf = invoicePdf();
  const library = await PDFiumLibrary.init();
  const doc = await library.loadDocument(pdf);
  let png;
  try {
    const image = await doc.getPage(0).render({ scale: 3, render: async ({ data, width, height }) => {
      const bitmap = new PNG({ width, height });
      bitmap.data = Buffer.from(data);
      return PNG.sync.write(bitmap);
    } });
    png = image.data;
  } finally { doc.destroy(); library.destroy(); }
  for (const [name, buffer] of [['invoice.pdf', pdf], ['photo.png', png]]) {
    const preview = await recognizeInvoice([{ originalname: name, buffer }]);
    assert.equal(preview.lines.length, 1);
    assert.equal(preview.lines[0].quantity, 3);
    assert.equal(preview.lines[0].price, 14);
    assert.equal(preview.total, 42);
  }
});

test('OCR table headings map reordered columns and preserve thousands separators', () => {
  const table = [[['Название', 10], ['Количество', 230], ['Сумма', 410], ['Цена', 620], ['Ед.', 810]],
    [['Мука', 10], ['3', 245], ['7', 408], ['500,00', 430], ['2', 620], ['500,00', 640], ['кг', 811]],
    [['Итого', 10], ['7', 410], ['500,00', 435]]];
  const tsv = table.flatMap((row, y) => row.map(([word, x], i) => ['5',1,1,1,y,i,x,20+y*40,word.length*9,16,95,word].join('\t'))).join('\n');
  const preview = newInvoicePreview();
  addInvoicePage(preview, '', tsv);
  assert.deepEqual(preview.lines, [{ name: 'Мука', unit: 'кг', quantity: 3, total: 7500, price: 2500 }]);
  assert.equal(preview.total, 7500);
});

test('rejects invalid files and mixed uploads without creating records', async () => {
  await assert.rejects(recognizeInvoice([{ originalname: 'bad.pdf', buffer: Buffer.from('x') }]), /PDF/);
  await assert.rejects(recognizeInvoice([{ originalname: 'bad.xlsx', buffer: Buffer.from('x') }]), /XLSX/);
  await assert.rejects(recognizeInvoice(['a.csv', 'b.png'].map(originalname => ({ originalname, buffer: Buffer.from('x') }))), /фотографий/);
});
