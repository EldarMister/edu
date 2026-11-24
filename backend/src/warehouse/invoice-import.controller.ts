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

@Controller('admin/warehouse/purchases/import')
@Roles(Role.ADMIN, Role.OWNER)
@RequirePermission('sections.warehouse')
export class InvoiceImportController {
  private busy = false;

  @Post('preview') @HttpCode(200)
  @RequirePermission('actions.warehouseReceive', 'actions.warehouseCosts')
  @UseInterceptors(FilesInterceptor('files', 2, { limits: { files: 2, fileSize: 12 * 1024 * 1024, fields: 0, parts: 3 } }))
  async preview(@UploadedFiles() files: InvoiceFile[], @CurrentUser() user: AuthUser, @Req() request: Request): Promise<InvoicePreview> {
    if (!user.cafeId || getCafeId() !== user.cafeId) throw new ForbiddenException('Заведение не назначено');
    if (!files?.length) throw new BadRequestException('Выберите документ накладной.');
    if (this.busy) throw new HttpException('Сейчас обрабатывается другая накладная. Повторите через минуту.', 429);
    // PDF decoding, OCR and workbook parsing must not block the API event loop.
    const worker = new Worker(require.resolve('./invoice-recognition.worker'), {
      workerData: { invoiceFiles: files.map(({ buffer, originalname }) => ({ buffer, originalname })) },
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
        worker.once('error', () => fail('Не удалось прочитать накладную. Попробуйте файл меньшего размера.'));
        worker.once('exit', () => fail('Распознавание прервалось. Попробуйте ещё раз.'));
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) request.res?.off('close', abort);
      try { await worker.terminate(); } finally { this.busy = false; }
    }
  }
}
