import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { EmployeePermissions } from '../permissions';

export interface AuthUser {
  id: string;
  role: string;
  name: string;
  phone: string;
  cafeId: string | null;
  /** Итоговые права доступа (дефолты по роли + сохранённые). */
  permissions: EmployeePermissions;
}

/** Достаёт пользователя, положенного в request JwtStrategy. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | AuthUser[keyof AuthUser] | null => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser;
    return data ? user?.[data] : user;
  },
);
