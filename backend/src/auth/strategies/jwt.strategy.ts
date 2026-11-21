import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { setCafeId } from '../../tenant/tenant-context';
import { assertCafeActive } from '../../platform/cafe-status';
import { resolveUserPermissions } from '../../common/permissions';
import { projectWorkspaceUser, workspaceAccess } from '../../common/workspace-access';
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
      passReqToCallback: true,
    });
  }

  async validate(request: { headers?: Record<string, unknown>; originalUrl?: string; url?: string }, payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: { position: true } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Пользователь не найден или отключён');
    }
    // Кафе приостановлено (не оплачено / вручную) — блокируем работу персонала на каждом запросе.
    await assertCafeActive(this.prisma, user.cafeId);
    // Кафе пользователя — в контекст тенанта на весь остаток запроса (авто-скоуп Prisma).
    setCafeId(user.cafeId);
    const permissions = resolveUserPermissions(user);
    const identity: AuthUser = {
      id: user.id,
      role: user.role,
      identityRole: user.role,
      access: workspaceAccess(user.role, permissions),
      name: user.name,
      phone: user.phone,
      cafeId: user.cafeId,
      prepStation: user.prepStation,
      positionId: user.position?.role === user.role ? user.positionId : null,
      permissions,
    };
    // Account refresh must still work after the currently open workspace is revoked.
    const path = (request.originalUrl ?? request.url ?? '').split('?')[0].replace(/\/$/, '');
    if (path.endsWith('/auth/me')) return identity;
    return projectWorkspaceUser(identity, request.headers?.['x-edu-workspace']);
  }
}
