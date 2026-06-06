import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import type { BankOp } from './reconciliation.types';

const MAX_OPS = 20_000;

/** Парсит банковскую выписку в список операций (сумма + время). */
export async function parseStatement(
  buffer: Buffer,
  filename: string,
  mimetype: string,
): Promise<BankOp[]> {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const isPdf = ext === 'pdf' || mimetype === 'application/pdf';
  const isSheet =
    ['xlsx', 'xls', 'csv'].includes(ext) ||
    /spreadsheet|excel|csv/.test(mimetype);

  if (isPdf) return parsePdf(buffer);
  if (isSheet) return parseSheet(buffer);
  throw new BadRequestException('Поддерживаются файлы PDF, XLS, XLSX или CSV');
}

/* ---------- Таблицы (xlsx/xls/csv) ---------- */

function parseSheet(buffer: Buffer): BankOp[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    throw new BadRequestException('Не удалось прочитать файл выписки');
  }

  const ops: BankOp[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: true });
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const time = firstDate(row);
      if (!time) continue; // без времени операцию сопоставить нельзя
      const raw = rowText(row);
      for (const amount of amountsOf(row)) {
        ops.push({ amount, time, raw });
        if (ops.length >= MAX_OPS) return ops;
      }
    }
  }
  return ops;
}

function firstDate(row: unknown[]): Date | null {
  for (const cell of row) {
    const d = toDate(cell);
    if (d) return d;
  }
  return null;
}

function amountsOf(row: unknown[]): number[] {
  const out: number[] = [];
  for (const cell of row) {
    if (toDate(cell)) continue; // не путаем дату с суммой
    const n = toAmount(cell);
    if (n != null && n > 0) out.push(n);
  }
  return out;
}

function rowText(row: unknown[]): string {
  return row
    .map((c) => (c instanceof Date ? c.toISOString() : String(c ?? '')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/* ---------- PDF (best-effort) ---------- */

async function parsePdf(buffer: Buffer): Promise<BankOp[]> {
  let text: string;
  try {
    // pdf-parse v2: класс PDFParse.
    const { PDFParse } = require('pdf-parse') as typeof import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const res = await parser.getText();
    text = res.text ?? '';
    await parser.destroy();
  } catch {
    throw new BadRequestException('Не удалось распознать PDF-выписку');
  }

  const ops: BankOp[] = [];
  for (const line of text.split(/\r?\n/)) {
    const time = lineDate(line);
    if (!time) continue;
    const cleaned = stripDates(line);
    for (const amount of lineAmounts(cleaned)) {
      ops.push({ amount, time, raw: line.replace(/\s+/g, ' ').trim().slice(0, 160) });
      if (ops.length >= MAX_OPS) return ops;
    }
  }
  return ops;
}

const DATE_RE =
  /(\d{4}-\d{2}-\d{2}|\d{2}[.\-/]\d{2}[.\-/]\d{4})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?/;

function lineDate(line: string): Date | null {
  const m = line.match(DATE_RE);
  if (!m) return null;
  return parseDateString(m[1], m[2]);
}

function stripDates(line: string): string {
  return line.replace(new RegExp(DATE_RE, 'g'), ' ');
}

function lineAmounts(s: string): number[] {
  const out: number[] = [];
  // Числа вида 1 234,56 / 1234.56 / 1234
  const re = /-?\d[\d  ]*(?:[.,]\d{1,2})?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const n = toAmount(m[0]);
    if (n != null && n > 0) out.push(n);
  }
  return out;
}

/* ---------- Общие хелперы ---------- */

function toDate(cell: unknown): Date | null {
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : cell;
  if (typeof cell === 'string') {
    const m = cell.match(DATE_RE);
    if (m) return parseDateString(m[1], m[2]);
  }
  return null;
}

function parseDateString(date: string, time?: string): Date | null {
  let y: number, mo: number, d: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    [y, mo, d] = date.split('-').map(Number);
  } else {
    const [dd, mm, yy] = date.split(/[.\-/]/).map(Number);
    y = yy;
    mo = mm;
    d = dd;
  }
  let hh = 0;
  let mi = 0;
  let ss = 0;
  if (time) {
    const parts = time.split(':').map(Number);
    hh = parts[0] ?? 0;
    mi = parts[1] ?? 0;
    ss = parts[2] ?? 0;
  }
  const dt = new Date(y, mo - 1, d, hh, mi, ss);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toAmount(cell: unknown): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? Math.abs(cell) : null;
  if (typeof cell !== 'string') return null;
  let s = cell.trim().replace(/[ \s]/g, '').replace(/[^\d.,-]/g, '');
  if (!s) return null;
  // Десятичный разделитель: если есть и ',' и '.', считаем ',' разделителем тысяч.
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return null;
  // Отсекаем явно «не суммы» (годы, огромные id).
  const abs = Math.abs(n);
  if (abs > 100_000_000) return null;
  return abs;
}
