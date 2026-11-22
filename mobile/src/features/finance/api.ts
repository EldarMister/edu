import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PositionSalary } from '@/services/api/positions';

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
  hasCashShifts?: boolean;
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
  counterpartyName?: string;
  counterpartyArchived?: boolean;
  note?: string;
  occurredAt: string;
  actorName?: string;
  sourceKey?: string;
  cashShiftId?: string;
  editable?: boolean;
  detailsEditable?: boolean;
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
  supplemental?: boolean;
  revision: number;
  voidedAt?: string | null;
  voidReason?: string | null;
  note?: string;
  createdAt: string;
}
export interface CashFlow {
  opening: number;
  income: number;
  expense: number;
  transfers?: number;
  closing: number;
  accountOpening?: Record<string, number>;
  firstFinancialDay?: string;
  days: { date: string; income: number; expense: number; transfers?: number; net: number; balance: number }[];
}
interface Choice { id: string; name: string }
export interface FinanceData {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  entries: FinanceEntry[];
  payroll: PayrollAccrual[];
  flow: CashFlow | null;
  employees: (Choice & { role: string; adminAccess?: boolean })[];
  positions: Choice[];
  canManage: boolean;
  canViewAll: boolean;
  canEditPermissions: boolean;
}
export interface CashShift {
  id: string;
  openedById: string;
  closedById?: string | null;
  openedByName?: string | null;
  closedByName?: string | null;
  openedAt: string;
  closedAt?: string | null;
  closingComment?: string | null;
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
export const financeEndpoint = '/admin/finance';
export const shiftEndpoint = '/admin/cash-shifts';
export const cashShiftKey = ['cash-shifts'] as const;

export interface FinanceAccess {
  allowed: boolean;
  level: 'none' | 'limited' | 'view' | 'full';
  canViewAll: boolean;
  canManage: boolean;
}
export function useFinanceAccess(enabled: boolean) {
  return useQuery({
    queryKey: [...financeKey, 'access'],
    queryFn: async () => (await api.get<FinanceAccess>(financeEndpoint + '/access')).data,
    enabled, retry: false,
  });
}

export function useFinance(params: { from?: string; to?: string; month?: string; accountId?: string; accountIds?: string }, enabled = true) {
  return useQuery({
    queryKey: [...financeKey, 'overview', params],
    queryFn: async () => (await api.get<FinanceData>(financeEndpoint, { params })).data,
    enabled,
    retry: false,
  });
}

export interface CashHandoverRow {
  id: string;
  employeeId: string;
  employee: string;
  date: string;
  due: number;
  received: number | null;
  difference: number;
  receivedAt: string | null;
}

interface CashHandoverReport {
  enabled: boolean;
  canReceive: boolean;
  canConfigure: boolean;
  rows: CashHandoverRow[];
  daily: { date: string; amount: number }[];
}

const cashHandoverEndpoint = financeEndpoint + '/cash-handover';
export const cashHandoverKey = [...financeKey, 'cash-handover'] as const;

export function useCashHandover(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: [...cashHandoverKey, from, to],
    queryFn: async () => (await api.get<CashHandoverReport>(cashHandoverEndpoint, { params: { from, to } })).data,
    enabled, retry: false,
  });
}

export function useCashHandoverWrites() {
  const cache = useQueryClient();
  const refresh = () => Promise.all([
    cache.invalidateQueries({ queryKey: financeKey }),
    cache.invalidateQueries({ queryKey: cashShiftKey }),
    cache.invalidateQueries({ queryKey: ['admin', 'staff', 'shift-report'] }),
  ]);
  const receive = useMutation({
    mutationFn: (input: { employeeId: string; date: string; amount: number; expectedReceivedAt?: string }) =>
      api.post(cashHandoverEndpoint, input),
    onSuccess: refresh,
    onError: () => cache.invalidateQueries({ queryKey: cashHandoverKey }),
  });
  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) => api.patch(cashHandoverEndpoint + '/settings', { enabled }),
    onSuccess: refresh,
  });
  return { receive, setEnabled };
}

type AccountInput = { name: string; type: AccountType; openingBalance?: number; isDefault?: boolean };
type SaveAccountInput = { id?: undefined; values: AccountInput }
  | { id: string; values: Partial<AccountInput> };
interface TrashedAccount extends Pick<FinanceAccount, 'id' | 'name' | 'type'> {
  archivedAt: string;
  balance: number;
}

export function useTrashedFinanceAccounts() {
  return useQuery({
    queryKey: [...financeKey, 'accounts-trash'],
    queryFn: async () => (await api.get<TrashedAccount[]>(financeEndpoint + '/accounts/trash')).data,
    retry: false,
  });
}
type CategoryInput = Pick<FinanceCategory, 'name' | 'kind' | 'parentId' | 'showOnPos' | 'userIds' | 'positionIds'>;
export type TransactionValues = {
  kind: TransactionKind;
  accountId: string;
  categoryId?: string;
  destinationAccountId?: string;
  amount: number;
  note?: string;
  occurredAt?: string;
};
type AccrualInput = { userId: string; month: string; amount: number; note?: string; requestKey: string; supplemental?: boolean };
type PayoutInput = { accountId: string; amount: number; note?: string; requestKey: string };

export interface SalaryPaymentRecord {
  id: string; amount: number; occurredAt: string; createdAt: string; accountName: string; actorName: string;
  note: string | null; reversedAt: string | null; reversalOf: string | null;
  reversible: boolean; reverseBlockedReason: string | null;
}
export interface SalaryAccrualDetails extends PayrollAccrual {
  createdByName: string;
  history: { revision: number; type: 'edit' | 'cancel'; at: string; actorName: string; reason: string;
    before: { amount: number; note: string | null }; after: { amount: number; note: string | null } }[];
  payments: SalaryPaymentRecord[];
}
export function useSalaryAccrual(id: string) {
  return useQuery({ queryKey: [...financeKey, 'salary-accrual', id],
    queryFn: async () => (await api.get<SalaryAccrualDetails>(financeEndpoint + '/payroll/' + id)).data });
}
type SalaryCorrection = { requestKey: string; revision: number; reason: string };

export function useFinanceCategoryRemoval(id: string) {
  return useQuery({
    queryKey: [...financeKey, 'category-removal', id],
    queryFn: async () => (await api.get<{ entryCount: number; childCount: number; replacementIds: string[] }>(
      financeEndpoint + '/categories/' + id + '/removal',
    )).data,
    retry: false,
  });
}

export function useFinanceWrites() {
  const cache = useQueryClient();
  const onSuccess = () => Promise.all([
    cache.invalidateQueries({ queryKey: financeKey }), cache.invalidateQueries({ queryKey: ['audit'] }),
  ]);
  return {
    saveAccount: useMutation({
      mutationFn: async ({ id, values }: SaveAccountInput) => (id
        ? await api.patch<FinanceAccount>(financeEndpoint + '/accounts/' + id, values)
        : await api.post<FinanceAccount>(financeEndpoint + '/accounts', values)).data,
      onSuccess: () => Promise.all([onSuccess(), cache.invalidateQueries({ queryKey: cashShiftKey })]),
    }),
    archiveAccount: useMutation({
      mutationFn: (id: string) => api.delete(financeEndpoint + '/accounts/' + id),
      onSuccess,
    }),
    restoreAccount: useMutation({
      mutationFn: (id: string) => api.post(financeEndpoint + '/accounts/' + id + '/restore'),
      onSuccess,
    }),
    saveCategory: useMutation({
      mutationFn: ({ id, values }: { id?: string; values: CategoryInput }) => id
        ? api.patch(financeEndpoint + '/categories/' + id, values)
        : api.post(financeEndpoint + '/categories', values),
      onSuccess: () => Promise.all([onSuccess(), cache.invalidateQueries({ queryKey: cashShiftKey })]),
    }),
    setCategoryVisibility: useMutation({
      mutationFn: ({ id, showOnPos }: { id: string; showOnPos: boolean }) =>
        api.patch(financeEndpoint + '/categories/' + id, { showOnPos }),
      onSuccess: () => Promise.all([onSuccess(), cache.invalidateQueries({ queryKey: cashShiftKey })]),
    }),
    deleteCategory: useMutation({
      mutationFn: ({ id, replacementId }: { id: string; replacementId?: string }) =>
        api.delete(financeEndpoint + '/categories/' + id, { data: { replacementId } }),
      onSuccess: () => Promise.all([onSuccess(), cache.invalidateQueries({ queryKey: cashShiftKey })]),
    }),
    postTransaction: useMutation({
      mutationFn: (values: TransactionValues & { requestKey: string }) => api.post(financeEndpoint + '/transactions', values),
      onSuccess: () => Promise.all([onSuccess(), cache.invalidateQueries({ queryKey: cashShiftKey })]),
    }),
    editTransactionDetails: useMutation({
      mutationFn: ({ id, values }: { id: string; values: TransactionValues }) => api.patch(financeEndpoint + '/transactions/' + id + '/details', values),
      onSuccess,
    }),
    editTransaction: useMutation({
      mutationFn: ({ id, categoryId, note }: { id: string; categoryId?: string | null; note?: string }) =>
        api.patch(financeEndpoint + '/transactions/' + id, { categoryId, note }), onSuccess,
    }),
    reverseTransaction: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        api.post(financeEndpoint + '/transactions/' + id + '/reverse', { reason }),
      onSuccess: () => Promise.all([onSuccess(), cache.invalidateQueries({ queryKey: cashShiftKey })]),
    }),
    accrue: useMutation({
      mutationFn: ({ calculated, ...values }: AccrualInput & { calculated?: boolean }) =>
        api.post(financeEndpoint + '/payroll' + (calculated ? '/calculated' : ''), values), onSuccess,
    }),
    payout: useMutation({
      mutationFn: ({ id, values }: { id: string; values: PayoutInput }) => api.post(financeEndpoint + '/payroll/' + id + '/pay', values),
      onSuccess: () => Promise.all([onSuccess(), cache.invalidateQueries({ queryKey: cashShiftKey })]),
      onError: onSuccess,
    }),
    editAccrual: useMutation({
      mutationFn: ({ id, ...values }: SalaryCorrection & { id: string; amount: number; note?: string }) =>
        api.patch(financeEndpoint + '/payroll/' + id, values), onSuccess, onError: onSuccess,
    }),
    cancelAccrual: useMutation({
      mutationFn: ({ id, ...values }: SalaryCorrection & { id: string }) => api.post(financeEndpoint + '/payroll/' + id + '/cancel', values), onSuccess, onError: onSuccess,
    }),
    reverseSalaryPayment: useMutation({
      mutationFn: ({ id, paymentId, reason }: { id: string; paymentId: string; reason: string }) =>
        api.post(financeEndpoint + '/payroll/' + id + '/payments/' + paymentId + '/reverse', { reason }),
      onSuccess: () => Promise.all([onSuccess(), cache.invalidateQueries({ queryKey: cashShiftKey })]),
      onError: () => Promise.all([onSuccess(), cache.invalidateQueries({ queryKey: cashShiftKey })]),
    }),
  };
}

export interface PayrollStaffRow {
  userId: string;
  name: string;
  positionId: string | null;
  position: string;
  timeTrackingAvailable: boolean;
  hours: number | null;
  shifts: number | null;
  days: number | null;
  rateMonth: string | null;
  rates: PositionSalary;
  ratesByMonth?: { month: string; rates: PositionSalary }[];
  personalSales: number;
  shiftSales: number;
  hourlyPay: number;
  shiftPay: number;
  monthlyPay: number;
  personalCommission: number;
  shiftCommission: number;
  estimate: number;
  available: number;
  baseAccrued: number;
  supplementalAccrued: number;
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
    queryFn: async () => (await api.get<PayrollReport>(financeEndpoint + '/payroll', { params })).data,
  });
}

export function useCashShifts(enabled = true, endpoint = shiftEndpoint, period?: { from: string; to: string }) {
  return useQuery({
    queryKey: [...cashShiftKey, endpoint, period],
    queryFn: async () => (await api.get<CashShifts>(endpoint, { params: period })).data,
    enabled, retry: false,
  });
}
