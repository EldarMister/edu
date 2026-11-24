import { useState } from 'react';
import { Modal } from '@/components/Modal';

export function visibleWarehouseColumns<Key extends string>(value: string, defaults: Key[], available = defaults) {
  if (!value) return defaults;
  const requested = new Set(value.split(','));
  const [required] = defaults;
  return [required, ...[...requested].filter((key): key is Key => key !== required && available.includes(key as Key))];
}

export function WarehouseColumnSettings<Key extends string>({ columns, defaults, resetColumns = defaults, label, onClose, onApply }: {
  columns: Key[];
  defaults: Key[];
  resetColumns?: Key[];
  label: (key: Key) => string;
  onClose: () => void;
  onApply: (selected: Key[], reset: boolean) => void;
}) {
  const [order, setOrder] = useState(() => [...columns, ...defaults.filter((key) => !columns.includes(key))]);
  const [selected, setSelected] = useState<Key[]>(columns);
  const [reset, setReset] = useState(false);
  const [dragged, setDragged] = useState<Key | null>(null);
  const [dropTarget, setDropTarget] = useState<Key | null>(null);
  const [required] = defaults;

  function move(index: number, step: number) {
    const next = [...order];
    const [column] = next.splice(index, 1);
    next.splice(index + step, 0, column);
    setOrder(next);
  }

  function moveTo(target: Key) {
    if (!dragged || dragged === target || target === required) return;
    setOrder((current) => {
      const next = current.filter((key) => key !== dragged);
      next.splice(current.indexOf(target), 0, dragged);
      return next;
    });
    setDragged(null);
    setDropTarget(null);
  }

  return (
    <Modal open manageFocus title="Столбцы" onClose={onClose} footer={
      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" className="btn-secondary btn-md" onClick={() => {
          setOrder([...resetColumns, ...defaults.filter((key) => !resetColumns.includes(key))]);
          setSelected(resetColumns);
          setReset(true);
        }}>Сбросить к стандартным</button>
        <button type="button" className="btn-primary btn-md"
          onClick={() => onApply(order.filter((key) => selected.includes(key)), reset)}>Применить</button>
      </div>
    }>
      <ul className="divide-y divide-border">
        {order.map((key, index) => {
          const caption = label(key);
          const checked = selected.includes(key);
          return (
            <li key={key} className={`flex min-h-10 items-center gap-2 px-1 text-sm ${dropTarget === key ? 'bg-primary/10' : ''}`}
              onDragOver={(event) => {
                if (!dragged || key === required) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget(key);
              }} onDrop={(event) => { event.preventDefault(); moveTo(key); }}>
              {key !== required ? <span draggable className="cursor-grab select-none px-1 py-2 text-text-muted active:cursor-grabbing"
                aria-hidden="true" title="Перетащите, чтобы изменить порядок"
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', key);
                  setDragged(key);
                }} onDragEnd={() => { setDragged(null); setDropTarget(null); }}>⠿</span> : <span className="w-5" aria-hidden="true" />}
              <label className="flex min-w-0 flex-1 items-center gap-3 py-2">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={checked} disabled={key === required}
                  onChange={() => setSelected((current) => checked ? current.filter((value) => value !== key) : [...current, key])} />
                <span>{caption}</span>
              </label>
              {key !== required && <>
                <button type="button" className="h-8 w-8 rounded border border-border text-text-muted disabled:opacity-30"
                  aria-label={`Поднять столбец «${caption}»`} disabled={index <= 1} onClick={() => move(index, -1)}>↑</button>
                <button type="button" className="h-8 w-8 rounded border border-border text-text-muted disabled:opacity-30"
                  aria-label={`Опустить столбец «${caption}»`} disabled={index === order.length - 1} onClick={() => move(index, 1)}>↓</button>
              </>}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
