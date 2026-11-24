import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { parentPort, workerData } from 'node:worker_threads';
import { extname, join } from 'node:path';
import { PDFiumLibrary } from '@hyzyla/pdfium';
import { PNG } from 'pngjs';
import { imageSize } from 'image-size';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { readImportSpreadsheet } from './read-import-spreadsheet';
import { addInvoicePage, addSheet, newInvoicePreview } from './invoice-lines';

export interface InvoiceFile { originalname: string; buffer: Uint8Array }
const tableExtensions = new Set(['.csv', '.xls', '.xlsx']);
const photoExtensions = new Set(['.jpg', '.jpeg', '.png']);
const documentLimit = 12;
const lineLimit = 300;


async function ocrWorker(): Promise<Worker> {
  const langPath = await mkdtemp(join(tmpdir(), 'edu-invoice-ocr-'));
  try {
    await Promise.all(['rus', 'eng'].map(code => copyFile(
      require.resolve('@tesseract.js-data/' + code + '/4.0.0_best_int/' + code + '.traineddata.gz'),
      join(langPath, code + '.traineddata.gz'))));
    const worker = await createWorker('rus+eng', OEM.LSTM_ONLY, { langPath, cacheMethod: 'none', errorHandler: () => {} });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
    return worker;
  } finally { await rm(langPath, { recursive: true, force: true }); }
}

export async function recognizeInvoice(files: InvoiceFile[], writeoff = false) {
  if (!files.length || files.length > 2) throw new Error('Выберите одну таблицу, PDF или до двух фотографий одного документа.');
  const preview = newInvoicePreview();
  let worker: Worker | undefined;
  async function readPhoto(data: Buffer) {
    worker ??= await ocrWorker();
    const { data: result } = await worker.recognize(data, { rotateAuto: true }, { text: true, tsv: true });
    const before = preview.lines.length;
    addInvoicePage(preview, result.text, result.tsv, writeoff);
    if (preview.lines.length === before) preview.warnings.push('На одной из страниц не найдены позиции. Сверьте состав с оригиналом.');
  }
  try {
    for (const file of files) {
      const ext = extname(file.originalname).toLowerCase();
      const bytes = Buffer.from(file.buffer);
      if (!bytes.length) throw new Error('Загружен пустой файл.');
      if (files.length > 1 && !photoExtensions.has(ext)) throw new Error('Несколько файлов можно загрузить только для фотографий одного документа.');
      if (tableExtensions.has(ext)) {
        const recognized = readImportSpreadsheet(bytes, ext, true).map(cells => addSheet(preview, cells, writeoff));
        if (!recognized.some(Boolean)) throw new Error(writeoff
          ? 'Не найдены заголовки таблицы. Укажите столбцы «Наименование» и «Количество».'
          : 'Не найдены заголовки таблицы. Укажите столбцы «Наименование», «Количество» и «Цена» или «Сумма».');
      }
      else if (ext === '.pdf') {
        if (!bytes.subarray(0, 8).toString().startsWith('%PDF-')) throw new Error('Проверьте формат PDF.');
        const library = await PDFiumLibrary.init();
        try {
          const document = await library.loadDocument(bytes);
          try {
            if (document.getPageCount() > documentLimit) throw new Error('Загрузите PDF до 12 страниц.');
            for (const page of document.pages()) {
              const { originalWidth, originalHeight } = page.getOriginalSize();
              const scale = Math.min(2.7, 2400 / Math.max(originalWidth, originalHeight));
              if (!(scale > 0 && Number.isFinite(scale))) throw new Error('Не удалось прочитать размер страницы.');
              const image = await page.render({ scale, render: async ({ data, width, height }) => {
                const png = new PNG({ width, height });
                png.data = Buffer.from(data);
                return PNG.sync.write(png);
              } });
              await readPhoto(Buffer.from(image.data));
            }
          } finally { document.destroy(); }
        } finally { library.destroy(); }
      } else if (photoExtensions.has(ext)) {
        if (!(bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' || bytes.subarray(0, 3).toString('hex') === 'ffd8ff'))
          throw new Error('Выберите фотографию JPEG или PNG.');
        const { width, height } = imageSize(bytes);
        if (!(width > 0 && height > 0) || width * height > 25_000_000) throw new Error('Уменьшите фото до 25 мегапикселей и загрузите снова.');
        await readPhoto(bytes);
      } else throw new Error('Поддерживаются JPEG, PNG, PDF, CSV, XLS и XLSX.');
    }
  } finally { await worker?.terminate(); }
  if (writeoff && preview.lines.length > 200) throw new Error('Разделите документ на файлы по 200 позиций.');
  if (preview.lines.length > lineLimit) throw new Error('Разделите накладную на файлы по 300 позиций.');
  if (!preview.lines.length) throw new Error(writeoff
    ? 'Не удалось выделить позиции. Загрузите более чёткое фото или таблицу с количеством.'
    : 'Не удалось выделить позиции. Загрузите более чёткое фото или таблицу с количеством и ценой.');
  preview.warnings = preview.warnings.slice(0, 25);
  return preview;
}

if (parentPort && workerData?.invoiceFiles) {
  recognizeInvoice(workerData.invoiceFiles, workerData.writeoff === true).then(
    result => parentPort!.postMessage({ result }),
    error => parentPort!.postMessage({ error: error instanceof Error ? error.message : '' }),
  );
}
