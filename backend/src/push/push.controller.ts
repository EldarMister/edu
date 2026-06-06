import { Body, Controller, Delete, Get, Post, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PushSubscriptionDto } from './dto';
import { PushService } from './push.service';

@Controller()
export class PushController {
  constructor(private readonly push: PushService) {}

  @Public()
  @Get('push/public-key')
  publicKey() {
    return this.push.getPublicKey();
  }

  @Roles(Role.WAITER, Role.KITCHEN)
  @Post('push/subscribe')
  subscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: PushSubscriptionDto,
    @Req() req: { headers?: Record<string, string | string[] | undefined> },
  ) {
    const userAgent = Array.isArray(req.headers?.['user-agent'])
      ? req.headers?.['user-agent'][0]
      : req.headers?.['user-agent'];
    return this.push.subscribe(user.id, { ...dto, userAgent: dto.userAgent ?? userAgent });
  }

  @Roles(Role.WAITER, Role.KITCHEN)
  @Delete('push/subscribe')
  unsubscribe(@CurrentUser() user: AuthUser, @Body() dto: { endpoint: string }) {
    return this.push.unsubscribe(user.id, dto.endpoint);
  }
}
