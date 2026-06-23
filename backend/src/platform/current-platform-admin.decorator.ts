import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PlatformAdminInfo } from './platform-auth.service';

/** Достаёт платформенного админа, положенного в request PlatformAuthGuard. */
export const CurrentPlatformAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformAdminInfo => {
    return ctx.switchToHttp().getRequest().platformAdmin as PlatformAdminInfo;
  },
);
