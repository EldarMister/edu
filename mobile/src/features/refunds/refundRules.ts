import type { Order, OrderItem } from '@/types';
import type { RefundApproval, RefundQuote } from './api';

export function refundableQuantity(item: OrderItem): number {
  if (item.status === 'cancelled' || item.status === 'rejected') return 0;
  return Math.max(0, item.quantity - (item.refundedQuantity ?? 0));
}

export function canRefundOrder(order: Order): boolean {
  return order.status === 'paid' && order.paymentStatus !== 'refunded' && order.paymentStatus !== 'cancelled';
}

export function refundStatusLabel(order: Pick<Order, 'paymentStatus' | 'refundedAmount'>): string | undefined {
  if (order.paymentStatus === 'refunded') return 'Возвращён';
  if (Number(order.refundedAmount ?? 0) > 0) return 'Частичный возврат';
}

export function canConfirmRefund(
  refund: Pick<RefundQuote, 'paymentParts' | 'requireFiscalReference'>,
  approval: RefundApproval,
): boolean {
  return (!refund.paymentParts.length || approval.fundsReturned === true)
    && (!refund.requireFiscalReference || !!approval.fiscalRefundReference?.trim());
}

export function confirmedRefundApproval(approval: RefundApproval): RefundApproval {
  return {
    ...approval,
    fiscalRefundReference: approval.fiscalRefundReference?.trim() || undefined,
  };
}
