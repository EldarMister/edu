import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { setCafeId } from '../../tenant/tenant-context';
import { assertCafeActive } from '../../platform/cafe-status';
import { resolvePermissions } from '../../common/permissions';
import { getJwtAccessSecret } from '../jwt.config';

export interface JwtPayload {
  sub: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtAccessSecret(),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Пользователь не найден или отключён');
    }
    // Кафе приостановлено (не оплачено / вручную) — блокируем работу персонала на каждом запросе.
    await assertCafeActive(this.prisma, user.cafeId);
    // Кафе пользователя — в контекст тенанта на весь остаток запроса (авто-скоуп Prisma).
    setCafeId(user.cafeId);
    return {
      id: user.id,
      role: user.role,
      name: user.name,
      phone: user.phone,
      cafeId: user.cafeId,
      permissions: resolvePermissions(user.role, user.permissions),
    };
  }
}
