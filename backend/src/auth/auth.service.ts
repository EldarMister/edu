import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { assertCafeActive } from '../platform/cafe-status';
import { resolveUserPermissions } from '../common/permissions';
import { workspaceAccess } from '../common/workspace-access';
import { accountPhoneAliases, normalizeAccountPhone } from '../common/account-phone';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { getJwtAccessSecret, getJwtRefreshSecret } from './jwt.config';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private async findUserByPhone(input: string) {
    const phone = input.trim().replace(/[^\d+]/g, '');
    const include = { position: true } as const;
    const exact = await this.prisma.user.findUnique({ where: { phone }, include });
    if (exact) return exact;
    const normalized = normalizeAccountPhone(input);
    if (!normalized) return null;
    // Older accounts may have saved the same number without an international prefix.
    const matches = await this.prisma.user.findMany({
      where: { phone: { in: accountPhoneAliases(normalized) } },
      include,
      take: 2,
    });
    return matches.length === 1 ? matches[0] : null;
  }

  async login(dto: LoginDto) {
    const user = await this.findUserByPhone(dto.phone);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Неверный телефон или пароль');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Неверный телефон или пароль');
    }

    // Кафе приостановлено — не пускаем персонал (сообщение видит пользователь на входе).
    await assertCafeActive(this.prisma, user.cafeId);

    const tokens = await this.issueTokens(user.id, user.role);
    const now = new Date();
    await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: now } }] },
      data: { lastLoginAt: now },
    });
    return {
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        cafeId: user.cafeId,
        prepStation: user.prepStation,
        positionId: user.position?.role === user.role ? user.positionId : null,
        positionName: user.position?.role === user.role ? user.position.name : null,
        permissions: resolveUserPermissions(user),
        access: workspaceAccess(user.role, resolveUserPermissions(user)),
      },
    };
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: getJwtRefreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Сессия истекла, войдите заново');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Пользователь не найден или отключён');
    }

    return this.issueTokens(user.id, user.role);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, phone: true, role: true, cafeId: true, prepStation: true, permissions: true,
        positionId: true, position: { select: { name: true, role: true, permissions: true, isStarter: true } } },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      cafeId: user.cafeId,
      prepStation: user.prepStation,
      positionId: user.position?.role === user.role ? user.positionId : null,
      positionName: user.position?.role === user.role ? user.position.name : null,
      permissions: resolveUserPermissions(user),
      access: workspaceAccess(user.role, resolveUserPermissions(user)),
    };
  }

  private async issueTokens(userId: string, role: string) {
    const payload: JwtPayload = { sub: userId, role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: getJwtAccessSecret(),
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
      }),
      this.jwt.signAsync(payload, {
        secret: getJwtRefreshSecret(),
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
      }),
    ]);
    return { accessToken, refreshToken };
  }
}
