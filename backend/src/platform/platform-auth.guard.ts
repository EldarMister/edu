import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getJwtAccessSecret } from '../auth/jwt.config';
import { PlatformAuthService, type PlatformJwtPayload } from './platform-auth.service';

/**
 * Guard платформенных роутов. Роуты помечены @Public (чтобы пропустить guard'ы персонала),
 * а доступ платформы проверяет этот guard: валидный JWT со scope='platform' + активный админ.
 */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: PlatformAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = (req.headers?.authorization as string | undefined) ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Требуется вход администратора');

    let payload: PlatformJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<PlatformJwtPayload>(token, { secret: getJwtAccessSecret() });
    } catch {
      throw new UnauthorizedException('Сессия истекла, войдите заново');
    }
    if (payload.scope !== 'platform') {
      throw new UnauthorizedException('Недостаточно прав');
    }
    req.platformAdmin = await this.auth.validate(payload.sub);
    return true;
  }
}
