import { useState } from 'react';
import { ColumnCheckbox, ColumnPopover } from '../../components/ColumnPopover';

export function visibleWarehouseColumns<Key extends string>(value: string, defaults: Key[], available = defaults) {
  if (!value) return defaults;
  const requested = new Set(value.split(','));
  const [required] = defaults;
  return [required, ...[...requested].filter((key): key is Key => key !== required && available.includes(key as Key))];
}

export function WarehouseColumnSettings<Key extends string>({ columns, defaults, resetColumns = defaults, anchor, label, onClose, onChange }: {
  columns: Key[];
  defaults: Key[];
  resetColumns?: Key[];
  anchor: HTMLButtonElement;
  label: (key: Key) => string;
  onClose: () => void;
  onChange: (selected: Key[], reset: boolean) => void;
}) {
  const [order, setOrder] = useState(() => [...new Set([...columns, ...defaults])]);
  const [dragged, setDragged] = useState<Key | null>(null);
  const [dropTarget, setDropTarget] = useState<Key | null>(null);
  const [required] = defaults;
  const keys = [...new Set([...order.filter((key) => defaults.includes(key)), ...defaults])];

  function move(key: Key, target: Key) {
    if (key === target || key === required || target === required) return;
    const next = keys.filter((column) => column !== key);
    next.splice(keys.indexOf(target), 0, key);
    setOrder(next);
    onChange(next.filter((column) => columns.includes(column)), false);
  }

  function finishDrag() {
    setDragged(null);
    setDropTarget(null);
  }

  return (
    <ColumnPopover anchor={anchor} onClose={onClose} onReset={() => {
      setOrder([...new Set([...resetColumns, ...defaults])]);
      onChange(resetColumns, true);
    }}>
      <ul>
        {keys.map((key) => {
          const checked = columns.includes(key);
          const canMove = checked && key !== required;
          return (
            <li key={key} className="column-option" data-drop-target={dropTarget === key}
              onDragOver={(event) => {
                if (!dragged || !canMove) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget(key);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged && canMove) move(dragged, key);
                finishDrag();
              }}>
              <ColumnCheckbox checked={checked} disabled={key === required}
                onChange={(show) => onChange(keys.filter((column) => column === key ? show : columns.includes(column)), false)}
                onKeyDown={canMove ? (event) => {
                  if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                  const step = event.key === 'ArrowUp' ? -1 : 1;
                  const visible = keys.filter((column) => column !== required && columns.includes(column));
                  const target = visible[visible.indexOf(key) + step];
                  if (!target) return;
                  event.preventDefault();
                  move(key, target);
                } : undefined}>
                {label(key)}
              </ColumnCheckbox>
              {canMove && <span draggable className="column-option-grip"
                aria-hidden="true" title="Перетащить столбец"
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', key);
                  setDragged(key);
                }}
                onDragEnd={finishDrag}>⠿</span>}
            </li>
          );
        })}
      </ul>
    </ColumnPopover>
  );
}
