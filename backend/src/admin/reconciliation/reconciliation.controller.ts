import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReconciliationService } from './reconciliation.service';

interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/** Ручная сверка оплат — только владелец. Файл выписки не сохраняется. */
@Controller('admin/reconciliation')
@Roles(Role.OWNER)
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  reconcile(
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() body: { from?: string; to?: string; toleranceMin?: string },
  ) {
    return this.service.reconcile(file, body);
  }
}
