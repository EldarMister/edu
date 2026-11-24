import type { Prisma, WaiterShift } from '@prisma/client';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import type { AuditActor } from '../audit/audit.service';

export type WorkShiftChange = 'correction' | 'manual-close' | 'self-close' | 'auto-close' | 'cash-close';

const descriptions: Record<WorkShiftChange, string> = {
  correction: 'Исправлено рабочее время сотрудника',
  'manual-close': 'Рабочая смена закрыта администратором',
  'self-close': 'Рабочая смена завершена сотрудником',
  'auto-close': 'Рабочая смена закрыта автоматически',
  'cash-close': 'Рабочая смена закрыта вместе с кассовой',
};

export function recordWorkShiftChange(
  db: Prisma.TransactionClient, before: WaiterShift, after: WaiterShift,
  kind: WorkShiftChange, actor?: AuditActor, reason?: string,
) {
  const times = ({ startedAt, endedAt }: WaiterShift) => ({
    startedAt: startedAt.toISOString(), endedAt: endedAt?.toISOString() ?? null,
  });
  return db.auditLog.create({ data: {
    cafeId: after.cafeId,
    userId: actor?.id ?? null,
    userName: actor?.name ?? null,
    userRole: actor?.identityRole ?? actor?.role ?? null,
    actionType: AuditAction.STAFF_SHIFT_CHANGED,
    entityType: AuditEntity.STAFF_SHIFT,
    entityId: after.id,
    description: descriptions[kind],
    oldValue: times(before),
    newValue: times(after),
    metadata: { kind, employeeId: after.waiterId, reason: reason?.trim() || null },
    createdAt: after.updatedAt,
  } });
}
