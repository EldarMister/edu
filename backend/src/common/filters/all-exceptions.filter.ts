import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Внутренняя ошибка сервера';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as any).message ?? message;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Уникальность / не найдено и т.п.
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'Запись с такими данными уже существует';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'Запись не найдена';
      } else {
        status = HttpStatus.BAD_REQUEST;
        message = 'Ошибка базы данных';
      }
    }

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url}`, (exception as Error)?.stack);
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
