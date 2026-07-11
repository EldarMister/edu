import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dish } from '@/types';
import { dishUnitPrice, money } from '@/lib/format';
import { useT } from '@/lib/i18n';

const BASE_DIAL_MAX = 1000;
const DEFAULT_WEIGHT = 500;
const STEP = 10;
const START_ANGLE = 135;
const END_ANGLE = 405;
const SHEET_MS = 420;

function polar(cx: number, cy: number, radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function arcPath(cx: number, cy: number, radius: number, from: number, to: number) {
  const start = polar(cx, cy, radius, from);
  const end = polar(cx, cy, radius, to);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${end.x} ${end.y}`;
}

function clampWeight(value: number) {
  return Math.max(0, Math.round(value / STEP) * STEP);
}

function formatWeight(value: number) {
  if (value < 1000) return { value: String(value), unit: 'г' };
  const kilograms = value / 1000;
  const formatted = Number.isInteger(kilograms)
    ? String(kilograms)
    : kilograms.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return { value: formatted, unit: 'кг' };
}

export function WeightPickerSheet({
  dish,
  onClose,
  onAdd,
}: {
  dish: Dish | null;
  onClose: () => void;
  onAdd: (weightGrams: number) => void;
}) {
  const t = useT();
  const [renderDish, setRenderDish] = useState<Dish | null>(dish);
  const [visible, setVisible] = useState(false);
  const [weight, setWeight] = useState(DEFAULT_WEIGHT);
  const [editingWeight, setEditingWeight] = useState(false);
  const [weightInput, setWeightInput] = useState(String(DEFAULT_WEIGHT));
  const dialRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ lastAngle: number; scale: number } | null>(null);

  useEffect(() => {
    if (dish) {
      setRenderDish(dish);
      setWeight(DEFAULT_WEIGHT);
      setEditingWeight(false);
      setWeightInput(String(DEFAULT_WEIGHT));
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const id = setTimeout(() => setRenderDish(null), SHEET_MS);
    return () => clearTimeout(id);
  }, [dish]);

  const dialMax = Math.max(BASE_DIAL_MAX, Math.ceil(weight / BASE_DIAL_MAX) * BASE_DIAL_MAX);
  const angle = START_ANGLE + (weight / dialMax) * (END_ANGLE - START_ANGLE);
  const knob = polar(180, 180, 116, angle);
  const displayWeight = formatWeight(weight);
  const weightNumberWidth = [...displayWeight.value].reduce((sum, character) => sum + (character === '.' ? 12 : 27), 0);
  const weightTextStart = 180 - (weightNumberWidth + 22) / 2;
  const ticks = useMemo(() => Array.from({ length: 51 }, (_, index) => {
    const tickAngle = START_ANGLE + (index / 50) * (END_ANGLE - START_ANGLE);
    const major = index % 5 === 0;
    return {
      outer: polar(180, 180, 144, tickAngle),
      inner: polar(180, 180, major ? 132 : 137, tickAngle),
      major,
    };
  }), []);

  if (!renderDish) return null;

  const price = dishUnitPrice(renderDish.price, renderDish.discountType, renderDish.discountValue);

  function pointerAngle(event: React.PointerEvent<SVGSVGElement>) {
    const rect = dialRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = ((event.clientX - rect.left) / rect.width) * 360;
    const y = ((event.clientY - rect.top) / rect.height) * 360;
    return (((Math.atan2(y - 180, x - 180) * 180) / Math.PI) + 360) % 360;
  }

  function updateFromPointer(event: React.PointerEvent<SVGSVGElement>, dragging = false) {
    const rawAngle = pointerAngle(event);
    if (rawAngle === null) return;
    if (dragging && dragRef.current) {
      let delta = rawAngle - dragRef.current.lastAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      dragRef.current.lastAngle = rawAngle;
      const scale = dragRef.current.scale;
      setWeight((current) => clampWeight(current + (delta / (END_ANGLE - START_ANGLE)) * scale));
      return;
    }

    let selectedAngle = rawAngle;
    if (selectedAngle < START_ANGLE) selectedAngle += 360;
    selectedAngle = Math.max(START_ANGLE, Math.min(END_ANGLE, selectedAngle));
    setWeight(clampWeight(((selectedAngle - START_ANGLE) / (END_ANGLE - START_ANGLE)) * dialMax));
  }

  function adjust(delta: number) {
    setWeight((current) => clampWeight(current + delta));
  }

  return (
    <div className="fixed inset-0 z-[75]">
      <button
        type="button"
        className="absolute inset-0 h-full w-full bg-slate-950/40 transition-opacity"
        style={{ opacity: visible ? 1 : 0, transitionDuration: `${SHEET_MS}ms` }}
        onClick={onClose}
        aria-label={t('Закрыть')}
      />
      <div
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl"
        style={{
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: `transform ${SHEET_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        }}
        role="dialog"
        aria-modal="true"
        aria-label={t('Выбор веса')}
      >
        <div className="no-scrollbar flex min-h-[55dvh] flex-col overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2.5 sm:px-5">
          <div className="mx-auto h-1.5 w-10 rounded-full bg-slate-300" />
          <div className="mt-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[24px] font-bold leading-tight text-text-primary">{t('Весовой')}</h2>
              <p className="mt-2 text-[16px] text-text-muted">{t('Выберите вес')}</p>
            </div>
            <button
              type="button"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700"
              onClick={onClose}
              aria-label={t('Закрыть')}
            >
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 5l14 14M19 5 5 19" />
              </svg>
            </button>
          </div>

          <div className="mt-1 grid grid-cols-[50px_minmax(0,1fr)_50px] items-center gap-1 sm:grid-cols-[58px_minmax(0,1fr)_58px] sm:gap-2">
            <div className="flex flex-col gap-2 pt-12">
              <StepButton label="−50" onClick={() => adjust(-50)} disabled={weight === 0} />
              <StepButton label="−100" onClick={() => adjust(-100)} disabled={weight === 0} />
            </div>

            <div className="relative aspect-square w-full">
              <svg
                ref={dialRef}
                viewBox="0 0 360 360"
                className="h-full w-full touch-none select-none overflow-visible"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const rawAngle = pointerAngle(event);
                  dragRef.current = rawAngle === null ? null : { lastAngle: rawAngle, scale: dialMax };
                  updateFromPointer(event);
                }}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event, true);
                }}
                onPointerUp={(event) => {
                  dragRef.current = null;
                  event.currentTarget.releasePointerCapture?.(event.pointerId);
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
                aria-label={`${formatWeight(weight).value} ${formatWeight(weight).unit}`}
              >
              <defs>
                <filter id="weight-dial-shadow" x="-30%" y="-30%" width="160%" height="170%">
                  <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#0f172a" floodOpacity="0.10" />
                </filter>
                <linearGradient id="weight-progress" x1="50" y1="270" x2="300" y2="65" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#9cc4ff" />
                  <stop offset="0.55" stopColor="#1672f9" />
                  <stop offset="1" stopColor="#075ce5" />
                </linearGradient>
              </defs>

              {ticks.map((tick, index) => (
                <line
                  key={index}
                  x1={tick.inner.x}
                  y1={tick.inner.y}
                  x2={tick.outer.x}
                  y2={tick.outer.y}
                  stroke={index / 50 <= weight / dialMax ? '#2478ef' : '#d6deea'}
                  strokeWidth={tick.major ? 2.4 : 1.7}
                  strokeLinecap="round"
                />
              ))}

              <circle cx="180" cy="180" r="110" fill="white" filter="url(#weight-dial-shadow)" />
              <path d={arcPath(180, 180, 116, START_ANGLE, END_ANGLE)} fill="none" stroke="#e9eef5" strokeWidth="7" strokeLinecap="round" />
              {weight > 0 && (
                <path d={arcPath(180, 180, 116, START_ANGLE, angle)} fill="none" stroke="url(#weight-progress)" strokeWidth="7" strokeLinecap="round" />
              )}
              <circle cx={knob.x} cy={knob.y} r="11" fill="white" stroke="#1268ee" strokeWidth="7" />

              <g opacity={editingWeight ? 0 : 1}>
                <text x={weightTextStart} y="197" fill="#07152d" fontSize="50" fontWeight="700">{displayWeight.value}</text>
                <text x={weightTextStart + weightNumberWidth + 8} y="197" fill="#07152d" fontSize="22" fontWeight="600">{displayWeight.unit}</text>
              </g>
              <text x="180" y="27" textAnchor="middle" fill="#60708d" fontSize="15">{formatWeight(dialMax / 2).value} {formatWeight(dialMax / 2).unit}</text>
              <text x="40" y="130" textAnchor="middle" fill="#60708d" fontSize="15">{formatWeight(dialMax / 4).value} {formatWeight(dialMax / 4).unit}</text>
              <text x="320" y="130" textAnchor="middle" fill="#60708d" fontSize="15">{formatWeight((dialMax * 3) / 4).value} {formatWeight((dialMax * 3) / 4).unit}</text>
              <text x="71" y="322" textAnchor="middle" fill="#60708d" fontSize="15">0</text>
              <text x="289" y="322" textAnchor="middle" fill="#60708d" fontSize="15">{formatWeight(dialMax).value} {formatWeight(dialMax).unit}</text>
              </svg>

            {editingWeight ? (
              <input
                autoFocus
                type="number"
                min="0"
                step={STEP}
                inputMode="numeric"
                value={weightInput}
                onChange={(event) => setWeightInput(event.target.value)}
                onBlur={() => {
                  const next = Number(weightInput);
                  setWeight(clampWeight(Number.isFinite(next) ? next : weight));
                  setEditingWeight(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') setEditingWeight(false);
                }}
                className="absolute left-1/2 top-[52%] w-28 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-primary bg-white/95 px-2 py-1 text-center text-[28px] font-bold text-text-primary outline-none ring-2 ring-primary/15"
                aria-label={t('Вес в граммах')}
              />
            ) : (
              <button
                type="button"
                className="absolute left-[29%] top-[34%] h-[34%] w-[42%] rounded-full"
                onClick={() => {
                  setWeightInput(String(weight));
                  setEditingWeight(true);
                }}
                aria-label={`${t('Изменить вес')}: ${weight} ${t('грамм')}`}
              />
              )}
            </div>

            <div className="flex flex-col gap-2 pt-6">
              <StepButton label="+50" onClick={() => adjust(50)} disabled={false} />
              <StepButton label="+100" onClick={() => adjust(100)} disabled={false} />
              <StepButton label="+200" onClick={() => adjust(200)} disabled={false} />
            </div>
          </div>

          <div className="mt-3 flex min-h-[62px] items-center justify-between rounded-xl border border-border bg-white px-4 py-2.5 shadow-sm">
            <p className="text-[13px] text-text-muted">{t('Стоимость')}</p>
            <p className="text-[20px] font-semibold leading-6 text-text-primary">{money(price)}</p>
          </div>

          <button
            type="button"
            className="btn-primary mt-4 h-14 w-full rounded-xl text-[18px] font-semibold disabled:opacity-50"
            disabled={weight <= 0}
            onClick={() => onAdd(weight)}
          >
            {t('Добавить')}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      className="flex h-[54px] w-full items-center justify-center rounded-xl border border-border bg-white text-[17px] font-semibold text-primary shadow-md transition active:scale-95 disabled:opacity-35"
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
