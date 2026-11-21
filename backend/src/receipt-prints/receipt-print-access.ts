import { ForbiddenException } from '@nestjs/common';
import { Prisma, ReceiptPrintStatus, ReceiptPrintType, Role } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { assertAdminSectionAccess } from '../common/admin-section-access';
import { assertOwnerOperation } from '../common/permissions';

export const RECEIPT_REQUEST_TTL_MS = 2 * 60 * 60 * 1000;

export function assertReceiptPrintOperator(user: AuthUser, write = false) {
  if (user.role === Role.WAITER && !user.permissions.actions.printReceipts) {
    throw new ForbiddenException('Для вашей должности отключена печать чеков');
  }
  assertAdminSectionAccess(user, 'checks', write);
}

export function terminalReceiptOrderScope(user: AuthUser, requestId?: string, fiscal = false): Prisma.OrderWhereInput {
  assertReceiptPrintOperator(user, true);
  if (!requestId) return { waiterId: user.id };
  assertOwnerOperation(user, 'printRequests');
  return { receiptPrintRequests: { some: {
    id: requestId,
    decidedById: user.id,
    status: ReceiptPrintStatus.approved,
    createdAt: { gte: new Date(Date.now() - RECEIPT_REQUEST_TTL_MS) },
    ...(fiscal ? { type: ReceiptPrintType.receipt } : {}),
  } } };
}
