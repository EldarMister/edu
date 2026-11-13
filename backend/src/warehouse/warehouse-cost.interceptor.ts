import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Role } from '@prisma/client';
import { map } from 'rxjs/operators';
import { hasPermission, resolvePermissions } from '../common/permissions';

const costFields = new Set(['avgCost', 'avgCostBase', 'costAtMoment', 'stockValue', 'foodCost', 'totalCost',
  'lineCost', 'cost', 'margin', 'marginAmount', 'marginPercent', 'foodCostPercent', 'directCost', 'ingredientCost', 'packagingCost',
  'netRevenue', 'actualCost', 'grossMargin',
  'valuationAdjustment', 'totalValuationAdjustment',
  'openingAvgCost', 'openingValue', 'closingAvgCost', 'closingValue',
  'unitCost', 'varianceValue', 'value', 'ingredientWriteOffTotal', 'purchasesTotal', 'lossesTotal', 'lastPurchasePrice']);

export function redactWarehouseCosts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactWarehouseCosts);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, costFields.has(key) ? null : redactWarehouseCosts(item)]));
}

@Injectable()
export class WarehouseCostInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || !/\/admin\/warehouse(?:\/|$)/.test(request.url ?? '')
      || hasPermission(resolvePermissions(user.role as Role, user.permissions), 'actions.warehouseCosts')) return next.handle();
    return next.handle().pipe(map(redactWarehouseCosts));
  }
}
