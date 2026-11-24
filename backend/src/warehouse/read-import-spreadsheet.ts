import * as XLSX from 'xlsx';

function checkWorkbookSize(bytes: Buffer) {
  // Check the advertised uncompressed sizes before handing a compressed workbook to SheetJS.
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > bytes.length) throw new Error('Не удалось прочитать архив XLSX.');
  let offset = bytes.readUInt32LE(end + 16);
  const entries = bytes.readUInt16LE(end + 10);
  if (!entries || entries > 2000) throw new Error('Таблица слишком большая.');
  let size = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Файл XLSX повреждён.');
    size += bytes.readUInt32LE(offset + 24);
    if (size > 48 * 1024 * 1024) throw new Error('Таблица слишком большая.');
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
}

export function readImportSpreadsheet(bytes: Buffer, extension: string, formatPercentages = false): unknown[][][] {
  if (!['.csv', '.xls', '.xlsx'].includes(extension) || !bytes.length) throw new Error('Выберите непустой файл CSV, XLS или XLSX.');
  if (extension === '.xlsx') checkWorkbookSize(bytes);
  if (extension === '.xls' && bytes.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') throw new Error('Неверный формат XLS.');
  let input: string | Buffer = bytes;
  if (extension === '.csv') {
    if (bytes.includes(0) && bytes.subarray(0, 2).toString('hex') !== 'fffe') throw new Error('Укажите текстовый CSV или таблицу Excel.');
    input = bytes.subarray(0, 2).toString('hex') === 'fffe' ? bytes.toString('utf16le') : bytes.toString('utf8');
    if (input.includes('\uFFFD')) input = new TextDecoder('windows-1251').decode(bytes);
    input = input.replace(/^\uFEFF/u, '');
  }
  const book = XLSX.read(input, { type: typeof input === 'string' ? 'string' : 'buffer', raw: true, sheetRows: 1002, cellFormula: false });
  const sheets: unknown[][][] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (book.Workbook?.Sheets?.find((entry) => entry.name === name)?.Hidden || !sheet['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!fullref'] ?? sheet['!ref']);
    if (range.e.r > 1000 || range.e.c > 100) throw new Error('Оставьте в таблице до 1000 строк и 100 столбцов.');
    if (formatPercentages) for (const key of Object.keys(sheet)) {
      const cell = sheet[key];
      if (cell?.t === 'n' && cell.w?.includes('%')) sheet[key] = { t: 's', v: cell.w };
    }
    const cells = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' });
    sheets.push(cells);
  }
  return sheets;
}
