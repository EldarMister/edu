import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { money } from '@/lib/format';
import { useNotifications } from '@/store/notifications';
import { StatCard, StatCardsRow } from '../../components/StatCard';
import { IconCart, IconUsers, IconMoney, IconPlus, IconTrash, IconCheck, IconEye } from '../../components/icons';
import {
  usePurchases,
  usePurchase,
  usePurchasesOverview,
  usePurchaseMutations,
  useIngredients,
  purchaseNumber,
  qty,
  type Purchase,
  type PurchaseStatus,
} from './api';

type StatusFilter = '' | 'completed' | 'draft';

const STATUS_LABEL: Record<PurchaseStatus, { label: string; tone: 'success' | 'warning' | 'muted' }> = {
  completed: { label: 'Проведена', tone: 'success' },
  draft: { label: 'Черновик', tone: 'warning' },
  cancelled: { label: 'Отменена', tone: 'muted' },
};

export function PurchasesTab() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const overview = usePurchasesOverview();
  const purchasesQ = usePurchases({ status, search });
  const { complete, cancel } = usePurchaseMutations();
  const push = useNotifications((s) => s.push);
  const o = overview.data;

  async function onComplete(p: Purchase) {
    try {
      await complete.mutateAsync(p.id);
      push({ message: `Закупка ${purchaseNumber(p.number)} проведена`, at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  async function onCancel(p: Purchase) {
    if (!confirm(`Отменить закупку ${purchaseNumber(p.number)}?`)) return;
    try {
      await cancel.mutateAsync(p.id);
      push({ message: 'Закупка отменена', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  return (
    <div className="space-y-4">
      <StatCardsRow>
        <StatCard label="Закупок за период" value={o?.count ?? '—'} icon={<IconCart />} tone="primary" />
        <StatCard label="Поставщиков" value={o?.suppliers ?? '—'} icon={<IconUsers />} tone="muted" />
        <StatCard label="Сумма закупок" value={o ? money(o.sum) : '—'} icon={<IconMoney />} tone="success" />
      </StatCardsRow>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        {/* История закупок */}
        <div className="card flex flex-col overflow-hidden">
          <div className="border-b border-border p-4">
            <h3 className="mb-3 text-[15px] font-semibold text-text-primary">История закупок</h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input h-9 flex-1 sm:max-w-[220px]"
                placeholder="Поиск по поставщику"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="flex gap-1">
                <FilterTab active={status === ''} onClick={() => setStatus('')}>
                  Все
                </FilterTab>
                <FilterTab active={status === 'completed'} onClick={() => setStatus('completed')}>
                  Проведённые
                </FilterTab>
                <FilterTab active={status === 'draft'} onClick={() => setStatus('draft')}>
                  Черновики
                </FilterTab>
              </div>
            </div>
          </div>

          {purchasesQ.isLoading ? (
            <div className="flex justify-center py-12 text-primary">
              <Spinner className="h-6 w-6" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-background/50 text-left text-xs text-text-muted">
                    <th className="px-3 py-2.5 font-medium">№</th>
                    <th className="px-3 py-2.5 font-medium">Дата</th>
                    <th className="px-3 py-2.5 font-medium">Поставщик</th>
                    <th className="px-3 py-2.5 text-center font-medium">Позиций</th>
                    <th className="px-3 py-2.5 text-right font-medium">Сумма</th>
                    <th className="px-3 py-2.5 font-medium">Статус</th>
                    <th className="px-3 py-2.5 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {purchasesQ.data?.map((p) => {
                    const st = STATUS_LABEL[p.status];
                    return (
                      <tr key={p.id} className="border-b border-border last:border-0 hover:bg-background/60">
                        <td className="px-3 py-2.5 font-medium text-text-primary">{purchaseNumber(p.number)}</td>
                        <td className="px-3 py-2.5 text-text-secondary">{formatDate(p.date)}</td>
                        <td className="px-3 py-2.5 text-text-secondary">{p.supplier}</td>
                        <td className="px-3 py-2.5 text-center text-text-secondary">{p.itemsCount}</td>
                        <td className="px-3 py-2.5 text-right font-medium text-text-primary">{money(p.totalAmount)}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setDetailsId(p.id)}
                              className="p-1.5 text-text-light transition-colors hover:text-primary"
                              title="Просмотр"
                            >
                              <IconEye className="h-4 w-4" />
                            </button>
                            {p.status === 'draft' && (
                              <>
                                <button
                                  onClick={() => onComplete(p)}
                                  className="p-1.5 text-text-light transition-colors hover:text-success"
                                  title="Провести"
                                >
                                  <IconCheck className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => onCancel(p)}
                                  className="p-1.5 text-text-light transition-colors hover:text-danger"
                                  title="Отменить"
                                >
                                  <IconTrash className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {purchasesQ.data?.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-text-muted">
                        Закупки не найдены
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Новая закупка */}
        <NewPurchaseForm />
      </div>

      <div className="card flex items-start gap-3 p-4 text-sm text-text-secondary">
        <span className="mt-0.5 text-primary">
          <IconMoney className="h-5 w-5" />
        </span>
        <div>
          <p className="font-medium text-text-primary">Формула средневзвешенной себестоимости</p>
          <p className="mt-1">
            новая себестоимость = (старый остаток × старая себестоимость + кол-во × цена закупки) ÷ (старый остаток + кол-во)
          </p>
        </div>
      </div>

      {detailsId && <PurchaseDetailsModal id={detailsId} onClose={() => setDetailsId(null)} />}
    </div>
  );
}

function PurchaseDetailsModal({ id, onClose }: { id: string; onClose: () => void }) {
  const purchaseQ = usePurchase(id);
  const p = purchaseQ.data;
  const st = p ? STATUS_LABEL[p.status] : null;

  return (
    <Modal open onClose={onClose} title={p ? `Закупка ${purchaseNumber(p.number)}` : 'Закупка'} panelClassName="max-w-lg">
      {purchaseQ.isLoading || !p ? (
        <div className="flex justify-center py-10 text-primary">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label="Дата">{formatDate(p.date)}</Info>
            <Info label="Поставщик">{p.supplier}</Info>
            <Info label="Статус">{st && <Badge tone={st.tone}>{st.label}</Badge>}</Info>
            <Info label="Позиций">{p.itemsCount}</Info>
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background/50 text-left text-xs text-text-muted">
                  <th className="px-3 py-2 font-medium">Сырьё</th>
                  <th className="px-3 py-2 text-center font-medium">Кол-во</th>
                  <th className="px-3 py-2 text-right font-medium">Цена за ед.</th>
                  <th className="px-3 py-2 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {p.items?.map((it) => (
                  <tr key={it.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium text-text-primary">{it.ingredientName}</td>
                    <td className="px-3 py-2 text-center text-text-secondary">{qty(it.quantity, it.unit)}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">{money(it.purchasePrice)}</td>
                    <td className="px-3 py-2 text-right font-medium text-text-primary">{money(it.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-background/60">
                  <td colSpan={3} className="px-3 py-2.5 text-right font-medium text-text-secondary">
                    Итого
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-text-primary">{money(p.totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-0.5 text-text-primary">{children}</p>
    </div>
  );
}

function NewPurchaseForm() {
  const today = new Date().toISOString().slice(0, 10);
  const ingredientsQ = useIngredients('');
  const { create } = usePurchaseMutations();
  const push = useNotifications((s) => s.push);

  const [date, setDate] = useState(today);
  const [supplier, setSupplier] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [error, setError] = useState('');

  const ingredients = ingredientsQ.data ?? [];
  const total = useMemo(
    () => rows.reduce((acc, r) => acc + (Number(r.quantity) || 0) * (Number(r.purchasePrice) || 0), 0),
    [rows],
  );

  function unitOf(ingredientId: string) {
    return ingredients.find((i) => i.id === ingredientId)?.unit ?? '';
  }

  function updateRow(uid: string, patch: Partial<Row>) {
    setRows((cur) => cur.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  }
  // Сумма позиции = кол-во × цена за ед. (для редактируемого поля «Сумма»).
  function lineTotalStr(quantity: string, unitPrice: string) {
    const lt = (Number(quantity) || 0) * (Number(unitPrice) || 0);
    return lt ? String(Math.round(lt * 100) / 100) : '';
  }
  function setQuantity(uid: string, quantity: string) {
    setRows((cur) =>
      cur.map((r) => (r.uid === uid ? { ...r, quantity, total: lineTotalStr(quantity, r.purchasePrice) } : r)),
    );
  }
  function setUnitPrice(uid: string, purchasePrice: string) {
    setRows((cur) =>
      cur.map((r) => (r.uid === uid ? { ...r, purchasePrice, total: lineTotalStr(r.quantity, purchasePrice) } : r)),
    );
  }
  // Владелец вводит сумму напрямую — выводим цену за единицу обратным счётом.
  function setLineTotal(uid: string, total: string) {
    setRows((cur) =>
      cur.map((r) => {
        if (r.uid !== uid) return r;
        const q = Number(r.quantity) || 0;
        const purchasePrice = q > 0 && total !== '' ? String(Math.round((Number(total) / q) * 10000) / 10000) : r.purchasePrice;
        return { ...r, total, purchasePrice };
      }),
    );
  }
  function addRow() {
    setRows((cur) => [...cur, emptyRow()]);
  }
  function removeRow(uid: string) {
    setRows((cur) => (cur.length > 1 ? cur.filter((r) => r.uid !== uid) : cur));
  }
  function reset() {
    setSupplier('');
    setRows([emptyRow()]);
    setError('');
  }

  async function onSubmit() {
    setError('');
    if (!supplier.trim()) {
      setError('Укажите поставщика');
      return;
    }
    const items = rows
      .filter((r) => r.ingredientId && Number(r.quantity) > 0)
      .map((r) => {
        // Сумма, если введена, — авторитетна; иначе считаем по цене за единицу.
        const hasTotal = r.total !== '' && Number.isFinite(Number(r.total));
        return {
          ingredientId: r.ingredientId,
          quantity: Number(r.quantity),
          purchasePrice: Number(r.purchasePrice) || 0,
          total: hasTotal ? Number(r.total) : undefined,
        };
      });
    if (items.length === 0) {
      setError('Добавьте хотя бы одну позицию с количеством');
      return;
    }
    try {
      await create.mutateAsync({ date, supplier: supplier.trim(), items, complete: true });
      push({ message: 'Закупка проведена', at: new Date().toISOString() });
      reset();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <div className="card flex flex-col p-4">
      <h3 className="mb-3 text-[15px] font-semibold text-text-primary">Новая закупка</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Дата">
          <input className="input h-9" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Поставщик">
          <input
            className="input h-9"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="ФудСервис"
          />
        </Field>
      </div>

      <div className="mt-4 space-y-2">
        {rows.map((r) => {
          const unit = unitOf(r.ingredientId);
          const lineTotal = (Number(r.quantity) || 0) * (Number(r.purchasePrice) || 0);
          return (
            <div key={r.uid} className="rounded-xl border border-border bg-background/40 p-2.5">
              <div className="flex items-center gap-2">
                <Select
                  className="h-9 flex-1 text-sm"
                  value={r.ingredientId}
                  onChange={(v) => updateRow(r.uid, { ingredientId: v })}
                  placeholder="Выберите сырьё…"
                  options={ingredients.map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }))}
                />
                <button
                  type="button"
                  onClick={() => removeRow(r.uid)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-danger transition-colors hover:bg-danger/10"
                  title="Удалить позицию"
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-3 items-end gap-2">
                <Field label={`Кол-во${unit ? ` (${unit})` : ''}`}>
                  <input
                    className="input h-9 text-sm"
                    type="number"
                    step="0.001"
                    value={r.quantity}
                    onChange={(e) => setQuantity(r.uid, e.target.value)}
                  />
                </Field>
                <Field label={`Цена за ед.${unit ? ` (с/${unit})` : ' (с)'}`}>
                  <input
                    className="input h-9 text-sm"
                    type="number"
                    step="0.01"
                    value={r.purchasePrice}
                    onChange={(e) => setUnitPrice(r.uid, e.target.value)}
                  />
                </Field>
                <Field label="Сумма (с)">
                  <input
                    className="input h-9 text-sm"
                    type="number"
                    step="0.01"
                    value={r.total}
                    placeholder="0"
                    onChange={(e) => setLineTotal(r.uid, e.target.value)}
                  />
                </Field>
              </div>
              <p className="mt-1 text-right text-xs text-text-muted">
                Итого по позиции: {money(lineTotal)}
              </p>
            </div>
          );
        })}
      </div>

      <button type="button" className="btn-secondary btn-md mt-2 self-start" onClick={addRow}>
        <IconPlus className="h-4 w-4" /> Добавить позицию
      </button>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <span className="text-sm text-text-secondary">Итого</span>
        <span className="text-lg font-semibold text-text-primary">{money(total)}</span>
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-secondary btn-md flex-1" onClick={reset} disabled={create.isPending}>
          Отмена
        </button>
        <button type="button" className="btn-primary btn-md flex-1 font-semibold" onClick={onSubmit} disabled={create.isPending}>
          {create.isPending ? <Spinner /> : 'Провести закупку'}
        </button>
      </div>
    </div>
  );
}

interface Row {
  uid: string;
  ingredientId: string;
  quantity: string;
  purchasePrice: string;
  total: string;
}
function emptyRow(): Row {
  return { uid: `r-${Date.now()}-${Math.random()}`, ingredientId: '', quantity: '', purchasePrice: '', total: '' };
}

function formatDate(value: string): string {
  const d = new Date(value);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? 'bg-primary text-white' : 'text-text-secondary hover:bg-background'
      }`}
    >
      {children}
    </button>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'success' | 'warning' | 'danger' | 'muted' }) {
  const cls = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-danger/10 text-danger',
    muted: 'bg-slate-100 text-text-muted',
  }[tone];
  return <span className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}
