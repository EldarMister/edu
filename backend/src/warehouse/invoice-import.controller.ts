import { BadRequestException, Controller, ForbiddenException, HttpCode, HttpException, Post, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { Worker } from 'node:worker_threads';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { getCafeId } from '../tenant/tenant-context';
import type { InvoicePreview } from './invoice-lines';
import type { InvoiceFile } from './invoice-recognition.worker';

const importFiles = () => FilesInterceptor('files', 2, { limits: { files: 2, fileSize: 12 * 1024 * 1024, fields: 0, parts: 3 } });

@Controller('admin/warehouse')
@Roles(Role.ADMIN, Role.OWNER)
@RequirePermission('sections.warehouse')
export class InvoiceImportController {
  private busy = false;

  @Post('purchases/import/preview') @HttpCode(200)
  @RequirePermission('actions.warehouseReceive', 'actions.warehouseCosts')
  @UseInterceptors(importFiles())
  async preview(@UploadedFiles() files: InvoiceFile[], @CurrentUser() user: AuthUser, @Req() request: Request): Promise<InvoicePreview> {
    return this.recognize(files, user, request, false);
  }

  @Post('documents/writeoff-import/preview') @HttpCode(200)
  @RequirePermission('sections.warehouse', 'actions.warehouseWriteoff')
  @UseInterceptors(importFiles())
  async writeoffPreview(@UploadedFiles() files: InvoiceFile[], @CurrentUser() user: AuthUser, @Req() request: Request) {
    const { lines, warnings } = await this.recognize(files, user, request, true);
    return { lines: lines.map(({ name, unit, quantity, details }) => ({ name, unit, quantity, details })), warnings };
  }

  private async recognize(files: InvoiceFile[], user: AuthUser, request: Request, writeoff: boolean): Promise<InvoicePreview> {
    if (!user.cafeId || getCafeId() !== user.cafeId) throw new ForbiddenException('Заведение не назначено');
    if (!files?.length) throw new BadRequestException('Выберите файл документа.');
    if (this.busy) throw new HttpException('Сейчас обрабатывается другой документ. Повторите через минуту.', 429);
    // PDF decoding, OCR and workbook parsing must not block the API event loop.
    const worker = new Worker(require.resolve('./invoice-recognition.worker'), {
      workerData: { invoiceFiles: files.map(({ buffer, originalname }) => ({ buffer, originalname })), writeoff },
      resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    this.busy = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      return await new Promise<InvoicePreview>((resolve, reject) => {
        const fail = (message: string) => reject(new BadRequestException(message));
        abort = () => fail('Распознавание отменено.');
        request.res?.once('close', abort);
        timer = setTimeout(() => fail('Распознавание заняло слишком много времени. Разделите документ или загрузите таблицу.'), 120_000);
        worker.once('message', (message: { error?: string; result?: InvoicePreview }) => {
          if (message.result) resolve(message.result);
          else fail(message.error && /^[А-ЯЁа-яё]/u.test(message.error) ? message.error : 'Не удалось прочитать документ. Проверьте формат и качество изображения.');
        });
        worker.once('error', () => fail('Не удалось прочитать документ. Попробуйте файл меньшего размера.'));
        worker.once('exit', () => fail('Распознавание прервалось. Попробуйте ещё раз.'));
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) request.res?.off('close', abort);
      try { await worker.terminate(); } finally { this.busy = false; }
    }
  }
}
