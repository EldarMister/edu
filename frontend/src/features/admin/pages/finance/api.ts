import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PositionSalary } from '../positions-api';

export type AccountType = 'cash' | 'noncash';
export type CategoryKind = 'income' | 'expense' | 'both';
export type TransactionKind = Exclude<CategoryKind, 'both'> | 'transfer';
export type EntryKind = TransactionKind | 'sale' | 'refund' | 'salary' | 'adjustment';
export interface FinanceAccount {
  id: string;
  name: string;
  type: AccountType;
  isDefault: boolean;
  isCollection?: boolean;
  openingBalance: number | null;
  createdAt: string;
  balance: number | null;
}
export interface FinanceCategory {
  id: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  showOnPos?: boolean;
  userIds: string[];
  positionIds: string[];
}
export interface FinanceEntry {
  id: string;
  accountId: string;
  kind: EntryKind;
  amount: number;
  balanceAfter?: number;
  createdAt?: string;
  categoryId?: string;
  counterpartyAccountId?: string;
  note?: string;
  occurredAt: string;
  actorName?: string;
  sourceKey?: string;
  cashShiftId?: string;
  editable?: boolean;
  reversible?: boolean;
  reversedAt?: string | null;
  reversalOf?: string | null;
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
  accountOpening?: Record<string, number>;
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
  collectionAmount: number;
  openingDifference: number;
  number: number;
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

export function useFinance(params: { from?: string; to?: string; month?: string; accountId?: string; accountIds?: string }, enabled = true) {
  return useQuery({
    queryKey: [...financeKey, 'overview', params],
    queryFn: async () => (await api.get<FinanceData>(entrypoint, { params })).data,
    enabled,
    retry: false,
  });
}

type AccountInput = { name: string; type: AccountType; openingBalance?: number; isDefault?: boolean };
type CategoryInput = Pick<FinanceCategory, 'name' | 'kind' | 'parentId' | 'showOnPos' | 'userIds' | 'positionIds'>;
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
        return api.patch(entrypoint + '/accounts/' + id, {
          name: values.name, isDefault: values.isDefault, openingBalance: values.openingBalance,
        });
      }, onSuccess,
    }),
    saveCategory: useMutation({
      mutationFn: ({ id, values }: { id?: string; values: CategoryInput }) => id
        ? api.patch(entrypoint + '/categories/' + id, values)
        : api.post(entrypoint + '/categories', values),
      onSuccess: () => Promise.all([onSuccess(), cache.invalidateQueries({ queryKey: cashShiftKey })]),
    }),
    setCategoryVisibility: useMutation({
      mutationFn: ({ id, showOnPos }: { id: string; showOnPos: boolean }) =>
        api.patch(entrypoint + '/categories/' + id, { showOnPos }),
      onSuccess: () => Promise.all([onSuccess(), cache.invalidateQueries({ queryKey: cashShiftKey })]),
    }),
    postTransaction: useMutation({
      mutationFn: (values: TransactionInput) => api.post(entrypoint + '/transactions', values), onSuccess,
    }),
    editTransaction: useMutation({
      mutationFn: ({ id, categoryId, note }: { id: string; categoryId?: string | null; note?: string }) =>
        api.patch(entrypoint + '/transactions/' + id, { categoryId, note }), onSuccess,
    }),
    reverseTransaction: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        api.post(entrypoint + '/transactions/' + id + '/reverse', { reason }),
      onSuccess: () => Promise.all([onSuccess(), cache.invalidateQueries({ queryKey: cashShiftKey })]),
    }),
    accrue: useMutation({
      mutationFn: ({ calculated, ...values }: AccrualInput & { calculated?: boolean }) =>
        api.post(entrypoint + '/payroll' + (calculated ? '/calculated' : ''), values), onSuccess,
    }),
    payout: useMutation({
      mutationFn: ({ id, values }: { id: string; values: PayoutInput }) => api.post(entrypoint + '/payroll/' + id + '/pay', values),
      onSuccess,
    }),
  };
}

export interface PayrollStaffRow {
  userId: string;
  name: string;
  positionId: string | null;
  position: string;
  hours: number | null;
  shifts: number | null;
  days: number | null;
  rateMonth: string | null;
  rates: PositionSalary;
  personalSales: number;
  shiftSales: number;
  hourlyPay: number;
  shiftPay: number;
  monthlyPay: number;
  personalCommission: number;
  shiftCommission: number;
  estimate: number;
  available: number;
  accrued: number;
  paid: number;
  due: number;
}

export interface PayrollReport {
  staff: PayrollStaffRow[];
  records: (PayrollAccrual & {
    calculation?: Pick<PayrollStaffRow, 'rates' | 'hours' | 'shifts' | 'days' | 'personalSales' | 'shiftSales' | 'rateMonth' | 'estimate'> | null;
    createdAt: string;
  })[];
}

export function usePayroll(period: string | { from: string; to: string }, enabled = true) {
  const params = typeof period === 'string' ? { month: period } : period;
  const valid = typeof period === 'string' ? /^\d{4}-(0[1-9]|1[0-2])$/.test(period)
    : Boolean(period.from && period.to && period.from <= period.to);
  return useQuery({
    queryKey: [...financeKey, 'payroll', params], enabled: enabled && valid,
    queryFn: async () => (await api.get<PayrollReport>(entrypoint + '/payroll', { params })).data,
  });
}

export function useCashShifts(enabled = true, endpoint = shiftEndpoint, period?: { from: string; to: string }) {
  return useQuery({
    queryKey: [...cashShiftKey, endpoint, period],
    queryFn: async () => (await api.get<CashShifts>(endpoint, { params: period })).data,
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
