export interface InvoiceLine {
  name: string;
  unit: string;
  quantity: number | null;
  price: number | null;
  total: number | null;
  details?: string;
  tax?: { rate: number | null; amount: number | null; totalWithTax: number | null; needsReview: boolean };
}
export interface InvoicePreview {
  lines: InvoiceLine[];
  supplier: string;
  invoiceDate: string;
  total: number | null;
  warnings: string[];
}

export const newInvoicePreview = (): InvoicePreview => ({ lines: [], supplier: '', invoiceDate: '', total: null, warnings: [] });

function amount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const raw = String(value ?? '').trim().replace(/\s*(?:KGS|сом(?:ов|а)?|с\.?)$/iu, '').replace(/[\s\u00a0]/g, '');
  if (!/^\d+(?:[.,]\d+)?$/.test(raw)) return null;
  const parsed = Number(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

const headerNames = {
  name: /^(?:наименование|название|номенклатура|товар|продукт|ингредиент|описание|item|product|name|description)/iu,
  unit: /^(?:ед(?:иниц|\s|\.|$)|фасовк|unit|uom)/iu,
  quantity: /^(?:кол(?:ич|\s*[-–.]?\s*во)|кол\.?$|qty|quantity|amount of)/iu,
  price: /^(?:цена|закупочная цена|стоимость за|price|unit price|unit cost)/iu,
  total: /^(?:сумма|общая сумма|стоимость|всего|итого|amount|total|line total)/iu,
};
const footer = /^(?:всего|итог[оа]?|к оплате|сумма (?:накладной|к оплате)|grand total|total)(?:\s|:|$)/iu;
const skip = /^(?:в т\.?\s?ч|ндс|vat|всего наименований|товар отпустил|отпустил|получил|скидка|подпись)(?:[.:\s]|$)/iu;
const taxWord = /ндс|налог|vat|tax/iu;
const excludesTax = /без\s+(?:ндс|налог)|(?:excl|before|net).*?(?:vat|tax)|(?:vat|tax)\s*exclusive/iu;
const includesTax = /(?:^|\s)(?:с|вкл(?:ючая)?\.?)\s*(?:ндс|налог)|(?:incl|after|with).*?(?:vat|tax)|(?:vat|tax)\s*inclusive/iu;
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function sheetColumns(headers: string[]) {
  const ordinary = Object.fromEntries(Object.entries(headerNames).map(([key, regex]) => [key,
    headers.findIndex(value => regex.test(value) && !(key === 'unit' && /unit (price|cost)/i.test(value))
      && !((key === 'price' || key === 'total') && taxWord.test(value)))])) as Record<keyof typeof headerNames, number>;
  return { ...ordinary, netPrice: headers.findIndex(v => headerNames.price.test(v) && excludesTax.test(v)),
    net: headers.findIndex(v => headerNames.total.test(v) && excludesTax.test(v)),
    grossPrice: headers.findIndex(v => headerNames.price.test(v) && includesTax.test(v)),
    gross: headers.findIndex(v => headerNames.total.test(v) && includesTax.test(v)),
    taxAmount: headers.findIndex(v => taxWord.test(v) && !excludesTax.test(v) && !includesTax.test(v)
      && /сумм|amount/iu.test(v)),
    taxRate: headers.findIndex(v => taxWord.test(v) && !excludesTax.test(v) && !includesTax.test(v)
      && /%|процент|ставк|rate/iu.test(v)),
    unspecifiedTax: headers.findIndex(v => /^(?:ндс|vat|налог|tax)$/iu.test(v)),
  };
}

function taxedLine(row: unknown[], cols: ReturnType<typeof sheetColumns>, line: InvoiceLine) {
  const netPrice = amount(row[cols.netPrice]);
  const suppliedNet = amount(row[cols.net]);
  const grossPrice = amount(row[cols.grossPrice]);
  const printedGross = amount(row[cols.gross]);
  const printedTax = amount(row[cols.taxAmount]);
  const unspecified = String(row[cols.unspecifiedTax] ?? '').trim();
  const rateText = String(row[cols.taxRate] ?? (/%|без\s/iu.test(unspecified) ? unspecified : '')).trim();
  let rate = /без\s+(?:ндс|налога)|exempt/iu.test(rateText) ? 0 : amount(rateText.replace(/%\s*$/u, ''));
  if (rate !== null && rate > 100) rate = null;
  const qty = line.quantity;
  const gross = printedGross ?? (grossPrice !== null && qty !== null ? money(grossPrice * qty) : null);
  let net = suppliedNet ?? (netPrice !== null && qty !== null ? money(netPrice * qty) : null);
  if (net === null && gross !== null) {
    if (printedTax !== null && printedTax <= gross) net = money(gross - printedTax);
    else if (rate !== null) net = money(gross / (1 + rate / 100));
  }
  if (net === null && rate === 0) net = line.total;
  const tax = printedTax ?? (gross !== null && net !== null && gross >= net ? money(gross - net) : null);
  if (rate === null && tax !== null && net !== null && net > 0) rate = money(100 * tax / net);
  const needsReview = (gross !== null && net !== null && tax !== null && Math.abs(net + tax - gross) > 0.011)
    || (rate !== null && tax !== null && net !== null && Math.abs(money(net * rate / 100) - tax) > 0.011)
    || (net === null && netPrice === null) || ((cols.taxRate >= 0 || !!unspecified) && rate === null);
  return { ...line, price: netPrice ?? (net !== null && qty ? net / qty : rate === 0 ? line.price : null), total: net,
    tax: { rate, amount: tax, totalWithTax: gross, needsReview } };
}

function metadata(preview: InvoicePreview, source: string) {
  const supplier = /^(?:поставщик|продавец|отправитель|supplier|vendor)\s*[:\s]\s*(.+)/iu.exec(source);
  if (supplier && !preview.supplier) preview.supplier = supplier[1].trim().slice(0, 160);
  const date = /(?:дата|накладн[а-я]+|invoice|\bот)\s*.{0,40}?(\d{2})[./-](\d{2})[./-](\d{4})/iu.exec(source);
  if (date && !preview.invoiceDate) {
    const iso = [date[3], date[2], date[1]].join('-');
    const stamp = new Date(iso + 'T00:00:00Z');
    if (Number.isFinite(stamp.getTime()) && stamp.toISOString().startsWith(iso)) preview.invoiceDate = iso;
  }
}

const detailsHeading = /^(?:детали|примечание|комментарий|details|note)$/iu;

export function addSheet(preview: InvoicePreview, cells: unknown[][], writeoff = false): boolean {
  let columns: ReturnType<typeof sheetColumns> | undefined;
  let detailsColumn = -1;
  for (const row of cells) {
    const values = row.map((value) => String(value ?? '').trim());
    if (!values.some(Boolean)) continue;
    const first = values.find(Boolean) ?? '';
    const text = values.filter(Boolean).join(' ');
    metadata(preview, text);
    const detected = sheetColumns(values);
    if (detected.name >= 0 && detected.quantity >= 0 && (writeoff || [detected.price, detected.total, detected.netPrice, detected.net, detected.grossPrice, detected.gross].some(n => n >= 0))) {
      columns = detected;
      detailsColumn = writeoff ? values.findIndex((value) => detailsHeading.test(value)) : -1;
      continue;
    }
    if (!columns) continue;
    if (skip.test(first)) continue;
    if (footer.test(first) || footer.test(values[columns.name] ?? '')) {
      if (excludesTax.test(first) && columns.gross >= 0) continue;
      const printed = amount(row[columns.gross]) ?? values.map(amount).filter((value): value is number => value !== null).at(-1);
      if (printed !== undefined) preview.total = printed;
      continue;
    }
    const name = values[columns.name];
    if (!name) {
      if ([columns.quantity, columns.price, columns.total].some(index => amount(row[index]) !== null)) preview.warnings.push(text.slice(0, 240));
      continue;
    }
    if (!writeoff && ![columns.quantity, columns.price, columns.total].some(index => amount(row[index]) !== null)) {
      if (text !== name || row[columns.quantity] || row[columns.price] || row[columns.total]) preview.warnings.push(text.slice(0, 240));
      continue;
    }
    const line = { name: name.slice(0, 240), unit: (values[columns.unit] ?? '').slice(0, 40),
      quantity: amount(row[columns.quantity]), price: amount(row[columns.price]), total: amount(row[columns.total]) };
    if (writeoff) {
      if (/\p{L}/u.test(name)) preview.lines.push({ ...line, details: values[detailsColumn]?.slice(0, 300) });
      continue;
    }
    const taxed = [columns.taxRate, columns.taxAmount, columns.unspecifiedTax, columns.grossPrice, columns.gross].some(n => n >= 0);
    preview.lines.push(taxed ? taxedLine(row, columns, line) : { ...line,
      price: amount(row[columns.netPrice]) ?? line.price, total: amount(row[columns.net]) ?? line.total });
  }
  return !!columns;
}

// On paper invoices most rows end with quantity, unit price and line total. Keep the printed
// amounts independent so a discount or OCR disagreement is visible during review.
export function addInvoiceText(preview: InvoicePreview, text: string) {
  const uncertainTax = taxWord.test(text.replace(/без\s+(?:ндс|налог[а-я]*)/giu, ''));
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[|¦]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    metadata(preview, line);
    if (skip.test(line)) continue;
    if (footer.test(line)) {
      const match = /([\d][\d\s]*(?:[,.]\d+)?)\s*(?:сом|KGS|с)?\s*$/iu.exec(line);
      if (match && amount(match[1]) !== null) preview.total = amount(match[1]);
      continue;
    }
    if (/^(?:дата|сч[её]т|накладная|поставщик|получатель|телефон|инн|итого|invoice|supplier|vendor)/iu.test(line)) continue;
    const tail = /(?:^|\s)(\d+(?:[.,]\d+)?)\s+(?:(шт\.?|кг|г|л|мл|уп\.?|кор\.?|kg|pcs|ml|g|l)\s+)?(\d+(?:[.,]\d+)?)(?:\s+(\d+(?:[.,]\d+)?))?\s*(?:сом|KGS|с)?$/iu.exec(line);
    if (!tail) {
      if (/\p{L}/u.test(line) && /\s\d+[.,]\d+\s*$/u.test(line)) preview.warnings.push(line.slice(0, 240));
      continue;
    }
    const prefix = line.slice(0,tail.index).trim().replace(/^\d+[.)]?\s+/u, '');
    const unit = /(?:^|\s)(шт\.?|кг|г|л|мл|уп\.?|кор\.?|kg|pcs|ml|g|l)\s*$/iu.exec(prefix);
    const name = (unit ? prefix.slice(0, unit.index) : prefix).trim();
    if (!/\p{L}/u.test(name)) continue;
    const row = { name: name.slice(0, 240), unit: unit?.[1] ?? tail[2] ?? '',
      quantity: amount(tail[1]), price: amount(tail[3]), total: amount(tail[4]) };
    if (uncertainTax) {
      preview.warnings.push('Проверьте количество и суммы с налогом: ' + line.slice(0, 200));
      preview.lines.push({ ...row, quantity: null, price: null, total: null,
        tax: { rate: null, amount: null, totalWithTax: null, needsReview: true } });
    } else preview.lines.push(row);
  }
}

type Word = { x: number; right: number; centerY: number; height: number; value: string };

/** Real invoices often put prices, totals and units in a different order. Use the
 * printed column headings and word coordinates whenever the page has a table. */
export function addInvoicePage(preview: InvoicePreview, text: string, tsv: string | null, writeoff = false) {
  const fallback = () => {
    if (!writeoff) return addInvoiceText(preview, text);
    for (const raw of text.split(/\r?\n/u)) {
      const line = raw.trim().replace(/^\d+[.)]?\s+/u, '');
      if (skip.test(line) || footer.test(line)) continue;
      const match = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s+(шт\.?|кг|г|мл|л|порц\.?|kg|pcs|ml|g|l)\s*$/iu.exec(line);
      if (match && /\p{L}/u.test(match[1])) preview.lines.push({
        name: match[1].slice(0, 240), quantity: amount(match[2]), unit: match[3], price: null, total: null,
      });
    }
  };
  const words: Word[] = [];
  for (const line of (tsv ?? '').split('\n')) {
    const fields = line.split('\t');
    if (fields[0] !== '5' || !fields[11]?.trim()) continue;
    const [x, y, width, height] = fields.slice(6, 10).map(Number);
    words.push({ x, right: x + width, centerY: y + height / 2, height, value: fields[11].trim() });
  }
  const rows: Word[][] = [];
  for (const word of words.sort((a, b) => a.centerY - b.centerY)) {
    const previous = rows.at(-1);
    if (previous && Math.abs(previous[0].centerY - word.centerY) < Math.max(4, Math.max(previous[0].height, word.height) * 0.6)) previous.push(word);
    else rows.push([word]);
  }
  rows.forEach(row => row.sort((a, b) => a.x - b.x));
  const headerIndex = rows.findIndex(row => {
    const has = (pattern: RegExp) => row.some(word => pattern.test(word.value));
    return has(headerNames.name) && has(headerNames.quantity) && (writeoff || has(headerNames.price) || has(headerNames.total));
  });
  if (headerIndex < 0) { fallback(); return; }
  // Printed Cyrillic «НДС» is often read as Latin HOC or HAC. Normalize only table headings.
  const header = rows[headerIndex].map(word => /^[нh][дaаoо][сc][.:,]?$/iu.test(word.value) ? { ...word, value: 'НДС' } : word);
  const columns: Word[] = [];
  for (const word of header) {
    const previous = columns.at(-1);
    const close = previous && word.x - previous.right < Math.max(10, word.height * 1.3);
    const startsColumn = Object.values(headerNames).some(pattern => pattern.test(word.value))
      || (writeoff && detailsHeading.test(word.value))
      || /^(?:№|код|артикул|barcode|sku|ндс|налог|vat|tax|ставка)$/iu.test(word.value);
    const continues = previous && (/^(?:ндс|налог|vat|tax)$/iu.test(word.value)
      && /(?:без|(?:^|\s)с|сумма|ставка|incl\.?|excl\.?|rate|with)$/iu.test(previous.value)
      || /^(?:товара|продукта|ингредиента|единицу)$/iu.test(word.value) && /^(?:наименование|название|цена\s+за)$/iu.test(previous.value));
    if (previous && close && (!startsColumn || continues)) {
      previous.value += ' ' + word.value;
      previous.right = word.right;
    } else if (startsColumn) columns.push({ ...word });
  }
  const starts = columns.map((word, i) => i ? (columns[i - 1].right + word.x) / 2 : -Infinity);
  const cells = rows.slice(headerIndex + 1).map(row => {
    const values = Array<string>(columns.length).fill('');
    for (const word of row) {
      let column = 0;
      const center = (word.x + word.right) / 2;
      while (column + 1 < starts.length && center >= starts[column + 1]) column++;
      values[column] += (values[column] ? ' ' : '') + word.value;
    }
    return values;
  });
  const page = newInvoicePreview();
  const headings = columns.map(word => word.value);
  while (cells[0]?.some(Boolean) && cells[0].every(value => /^(?:(?:без|с|ндс|налога?|ставка|%|за|единицу|изм\.?|vat|tax|incl\.?|excl\.?)\s*)*$/iu.test(value))) {
    cells.shift()!.forEach((value, i) => { if (value) headings[i] += ' ' + value; });
  }
  addSheet(page, [headings, ...cells], writeoff);
  if (!page.lines.length) { fallback(); return; }
  for (const row of rows.slice(0, headerIndex)) metadata(preview, row.map(word => word.value).join(' '));
  preview.lines.push(...page.lines);
  preview.warnings.push(...page.warnings);
  if (page.total !== null) preview.total = page.total;
}
