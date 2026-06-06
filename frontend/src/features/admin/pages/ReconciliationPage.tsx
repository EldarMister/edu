import { useMemo, useRef, useState } from 'react';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { money } from '@/lib/format';
import { useNotifications } from '@/store/notifications';
import { useReconcile, type ReconResult, type ReconRow, type ReconStatus } from '../api';

const TOLERANCES = [1, 3, 5, 10];
const ACCEPT = '.pdf,.xls,.xlsx,.csv';

const STATUS_META: Record<ReconStatus, { label: string; cls: string }> = {
  matched: { label: 'Совпало', cls: 'bg-success/10 text-success' },
  not_found: { label: 'Не найдено', cls: 'bg-slate-100 text-text-muted' },
  needs_review: { label: 'Требует проверки', cls: 'bg-amber-50 text-amber-600' },
  amount_mismatch: { label: 'Сумма отличается', cls: 'bg-rose-50 text-rose-500' },
  extra: { label: 'Лишняя операция', cls: 'bg-slate-100 text-slate-500' },
};

const METHOD_LABEL: Record<string, string> = { qr: 'QR', cash: 'Наличные', card: 'Карта' };

export function ReconciliationPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const weekAgo = useMemo(() => new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10), []);

  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [tolerance, setTolerance] = useState(5);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ReconResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const push = useNotifications((s) => s.push);
  const recon = useReconcile();

  async function start() {
    if (!file) {
      push({ message: 'Сначала загрузите файл выписки', type: 'error', at: new Date().toISOString() });
      return;
    }
    try {
      const res = await recon.mutateAsync({ file, from, to, toleranceMin: tolerance });
      setResult(res);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  return (
    <div className="space-y-5">
      {/* Панель управления */}
      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="С даты">
            <input className="input h-10 w-[150px]" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="По дату">
            <input className="input h-10 w-[150px]" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Погрешность времени">
            <div className="inline-flex rounded-xl bg-background p-1">
              {TOLERANCES.map((t) => (
                <button
                  key={t}
                  onClick={() => setTolerance(t)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    tolerance === t ? 'bg-white text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  ±{t} мин
                </button>
              ))}
            </div>
          </Field>

          <div className="ml-auto flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button className="btn-secondary btn-md" onClick={() => fileRef.current?.click()}>
              {file ? 'Заменить файл' : 'Загрузить выписку'}
            </button>
            <button className="btn-primary btn-md px-5 font-semibold" onClick={start} disabled={recon.isPending || !file}>
              {recon.isPending ? <Spinner /> : 'Начать сверку'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
          {file ? (
            <span className="font-medium text-text-secondary">Файл: {file.name}</span>
          ) : (
            <span>Поддерживаются PDF, XLS, XLSX, CSV.</span>
          )}
          <span>Сверяются безналичные оплаты (QR, карта). Файл выписки не сохраняется.</span>
        </div>
      </div>

      {!result ? (
        <div className="card flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-text-secondary">Загрузите банковскую выписку и нажмите «Начать сверку»</p>
          <p className="max-w-md text-xs text-text-muted">
            Система сопоставит оплаченные заказы POS с операциями из выписки по сумме и времени (±{tolerance} мин).
            Личные операции, не относящиеся к заказам, не отображаются.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            <StatCard label="Оплат в POS" value={result.stats.paidCount} tone="text-text-primary" />
            <StatCard label="Найдено в банке" value={result.stats.matched} tone="text-success" />
            <StatCard label="Не найдено" value={result.stats.notFound} tone="text-text-muted" />
            <StatCard label="Требует проверки" value={result.stats.needsReview} tone="text-amber-600" />
            <StatCard label="Расхождения" value={result.stats.amountMismatch} tone="text-rose-500" />
          </div>

          <ResultsTable rows={result.rows} />
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="card p-4">
      <p className="text-[13px] text-text-muted">{label}</p>
      <p className={`mt-1 text-[26px] font-semibold leading-none ${tone}`}>{value}</p>
    </div>
  );
}

function ResultsTable({ rows }: { rows: ReconRow[] }) {
  if (rows.length === 0) {
    return <p className="card py-12 text-center text-text-muted">Совпадений и расхождений не найдено</p>;
  }
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <Th>№ заказа</Th>
              <Th>Дата и время заказа</Th>
              <Th className="text-right">Сумма POS</Th>
              <Th className="text-right">Сумма в банке</Th>
              <Th>Время операции</Th>
              <Th className="text-right">Разница</Th>
              <Th>Оплата</Th>
              <Th>Официант</Th>
              <Th>Статус</Th>
              <Th>Комментарий</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const meta = STATUS_META[r.status];
              return (
                <tr key={`${r.orderId ?? 'op'}-${i}`} className="border-b border-border last:border-0 hover:bg-background/60">
                  <Td className="font-medium text-text-primary">{r.orderNumber ?? '—'}</Td>
                  <Td className="text-text-secondary">{fmtDateTime(r.orderTime)}</Td>
                  <Td className="text-right font-medium text-text-primary">{r.posAmount != null ? money(r.posAmount) : '—'}</Td>
                  <Td className="text-right text-text-secondary">{r.bankAmount != null ? money(r.bankAmount) : '—'}</Td>
                  <Td className="text-text-secondary">{fmtDateTime(r.bankTime)}</Td>
                  <Td className="text-right text-text-secondary">{fmtDiff(r.timeDiffSec)}</Td>
                  <Td className="text-text-secondary">{r.paymentMethod ? METHOD_LABEL[r.paymentMethod] ?? r.paymentMethod : '—'}</Td>
                  <Td className="text-text-secondary">{r.waiter ?? '—'}</Td>
                  <Td>
                    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${meta.cls}`}>
                      {meta.label}
                    </span>
                  </Td>
                  <Td className="text-text-muted">{r.comment || '—'}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      {label}
      {children}
    </label>
  );
}
function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtDiff(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} мин ${s} с` : `${m} мин`;
}
