import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type AccountType = 'cash' | 'noncash';
export type CategoryKind = 'income' | 'expense';
export type TransactionKind = CategoryKind | 'transfer';
export type EntryKind = TransactionKind | 'sale' | 'refund' | 'salary' | 'adjustment';
export interface FinanceAccount {
  id: string;
  name: string;
  type: AccountType;
  isDefault: boolean;
  openingBalance: number | null;
  createdAt: string;
  balance: number | null;
}
export interface FinanceCategory {
  id: string;
  name: string;
  kind: CategoryKind;
  userIds: string[];
  positionIds: string[];
}
export interface FinanceEntry {
  id: string;
  accountId: string;
  kind: EntryKind;
  amount: number;
  categoryId?: string;
  counterpartyAccountId?: string;
  note?: string;
  occurredAt: string;
  actorName?: string;
  sourceKey?: string;
  cashShiftId?: string;
}
export interface PayrollAccrual {
  id: string;
  userId: string;
  employeeName: string;
  month: string;
  amount: number;
  paidAmount: number;
  note?: string;
  createdAt: string;
}
export interface CashFlow {
  opening: number;
  income: number;
  expense: number;
  closing: number;
  days: { date: string; income: number; expense: number; net: number; balance: number }[];
}
interface Choice { id: string; name: string }
interface FinanceData {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  entries: FinanceEntry[];
  payroll: PayrollAccrual[];
  flow: CashFlow | null;
  employees: (Choice & { role: string })[];
  positions: Choice[];
  canManage: boolean;
}
export interface CashShift {
  id: string;
  openedById: string;
  closedById?: string | null;
  openedByName?: string | null;
  closedByName?: string | null;
  openedAt: string;
  closedAt?: string | null;
  openingAmount: number;
  expectedAmount: number;
  actualAmount: number | null;
  difference: number | null;
}
interface CashShifts {
  enabled: boolean;
  current: CashShift | null;
  history: CashShift[];
}

export const financeKey = ['admin', 'finance'] as const;
const entrypoint = '/admin/finance';
const shiftEndpoint = '/admin/cash-shifts';
export const cashShiftKey = ['cash-shifts'] as const;

export function useFinanceAccess(enabled: boolean) {
  return useQuery({
    queryKey: [...financeKey, 'access'],
    queryFn: async () => (await api.get<{ allowed: boolean }>(entrypoint + '/access')).data,
    enabled, retry: false,
  });
}

export function useFinance(params: { from?: string; to?: string; month?: string; accountId?: string }, enabled = true) {
  return useQuery({
    queryKey: [...financeKey, 'overview', params],
    queryFn: async () => (await api.get<FinanceData>(entrypoint, { params })).data,
    enabled,
    retry: false,
  });
}

type AccountInput = { name: string; type: AccountType; openingBalance?: number; isDefault?: boolean };
type CategoryInput = { name: string; kind: CategoryKind; userIds: string[]; positionIds: string[] };
type TransactionInput = {
  kind: TransactionKind;
  accountId: string;
  categoryId?: string;
  destinationAccountId?: string;
  amount: number;
  note?: string;
  occurredAt?: string;
  requestKey: string;
};
type AccrualInput = { userId: string; month: string; amount: number; note?: string; requestKey: string };
type PayoutInput = { accountId: string; amount: number; note?: string; requestKey: string };

export function useFinanceWrites() {
  const cache = useQueryClient();
  const onSuccess = () => cache.invalidateQueries({ queryKey: financeKey });
  return {
    saveAccount: useMutation({
      mutationFn: ({ id, values }: { id?: string; values: AccountInput }) => {
        if (!id) return api.post(entrypoint + '/accounts', values);
        return api.patch(entrypoint + '/accounts/' + id, { name: values.name, isDefault: values.isDefault });
      }, onSuccess,
    }),
    saveCategory: useMutation({
      mutationFn: ({ id, values }: { id?: string; values: CategoryInput }) => {
        if (!id) return api.post(entrypoint + '/categories', values);
        const { name, userIds, positionIds } = values;
        return api.patch(entrypoint + '/categories/' + id, { name, userIds, positionIds });
      }, onSuccess,
    }),
    postTransaction: useMutation({
      mutationFn: (values: TransactionInput) => api.post(entrypoint + '/transactions', values), onSuccess,
    }),
    accrue: useMutation({
      mutationFn: (values: AccrualInput) => api.post(entrypoint + '/payroll', values), onSuccess,
    }),
    payout: useMutation({
      mutationFn: ({ id, values }: { id: string; values: PayoutInput }) => api.post(entrypoint + '/payroll/' + id + '/pay', values),
      onSuccess,
    }),
  };
}

export function useCashShifts(enabled = true, endpoint = shiftEndpoint) {
  return useQuery({
    queryKey: [...cashShiftKey, endpoint],
    queryFn: async () => (await api.get<CashShifts>(endpoint)).data,
    enabled, retry: false,
  });
}

export function useCashShiftMutation(action: 'open' | 'close', endpoint = shiftEndpoint) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (values: { amount: number; shiftId?: string; expectedAmount?: number }) => api.post(endpoint + '/' + action, values),
    onSuccess: async () => {
      await Promise.all([cache.invalidateQueries({ queryKey: cashShiftKey }), cache.invalidateQueries({ queryKey: financeKey })]);
    },
  });
}
