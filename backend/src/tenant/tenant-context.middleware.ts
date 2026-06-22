import { Injectable, NestMiddleware } from '@nestjs/common';
import { runWithTenant } from './tenant-context';

/**
 * Открывает пустой контекст тенанта на весь запрос. cafeId в него кладёт позже
 * JwtStrategy (после авторизации) или QrService (по токену стола). Store —
 * один и тот же объект на запрос, поэтому заполнение «позже» работает.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(_req: unknown, _res: unknown, next: () => void) {
    runWithTenant({}, () => next());
  }
}
