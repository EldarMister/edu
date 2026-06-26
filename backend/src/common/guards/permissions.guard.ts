import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { EmployeePermissions, hasPermission, resolvePermissions } from '../permissions';

/**
 * Проверка прав доступа к разделам/действиям поверх ролей.
 * Срабатывает только если на маршруте есть @RequirePermission(...).
 * Владелец проходит всегда. Запрет — 403 «У вас нет доступа к этому разделу».
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('У вас нет доступа к этому разделу');
    }
    if (user.role === Role.OWNER) return true;

    const perms: EmployeePermissions =
      user.permissions ?? resolvePermissions(user.role, null);
    if (!hasPermission(perms, required)) {
      throw new ForbiddenException('У вас нет доступа к этому разделу');
    }
    return true;
  }
}
