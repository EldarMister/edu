import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { DeliveryIntegrationService } from './delivery-integration.service';

@Injectable()
export class DeliveryApiKeyGuard implements CanActivate {
  constructor(private readonly delivery: DeliveryIntegrationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const raw = request.headers['x-api-key'];
    const apiKey = Array.isArray(raw) ? raw[0] : raw;
    if (!apiKey) throw new UnauthorizedException('Не указан X-API-Key');
    await this.delivery.authenticate(apiKey);
    return true;
  }
}
