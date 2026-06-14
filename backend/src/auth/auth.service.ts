import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { getJwtAccessSecret, getJwtRefreshSecret } from './jwt.config';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  /** Нормализует телефон: оставляем + и цифры. */
  private normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    const digits = trimmed.replace(/[^\d+]/g, '');
    return digits;
  }

  async login(dto: LoginDto) {
    const phone = this.normalizePhone(dto.phone);
    const user = await this.prisma.user.findUnique({ where: { phone } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Неверный телефон или пароль');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Неверный телефон или пароль');
    }

    const tokens = await this.issueTokens(user.id, user.role);
    return {
      ...tokens,
      user: { id: user.id, name: user.name, phone: user.phone, role: user.role },
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
      select: { id: true, name: true, phone: true, role: true },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
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
