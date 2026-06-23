import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { getJwtAccessSecret } from '../auth/jwt.config';

export interface PlatformJwtPayload {
  sub: string;
  scope: 'platform';
}

export interface PlatformAdminInfo {
  id: string;
  login: string;
  name: string;
}

@Injectable()
export class PlatformAuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(login: string, password: string) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { login: login.trim() } });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }
    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }
    const payload: PlatformJwtPayload = { sub: admin.id, scope: 'platform' };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: getJwtAccessSecret(),
      expiresIn: process.env.JWT_PLATFORM_EXPIRES_IN ?? '12h',
    });
    return { accessToken, admin: this.toInfo(admin) };
  }

  /** Проверка токена в guard: грузим админа и убеждаемся, что он активен. */
  async validate(adminId: string): Promise<PlatformAdminInfo> {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: adminId } });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Доступ запрещён');
    }
    return this.toInfo(admin);
  }

  private toInfo(admin: { id: string; login: string; name: string }): PlatformAdminInfo {
    return { id: admin.id, login: admin.login, name: admin.name };
  }
}
