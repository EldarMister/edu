import { useEffect, useRef, useState } from 'react';
import { money } from '@/lib/format';

/**
 * График «Динамика остатков» в том же стиле, что и график выручки на странице
 * Статистика (RevenueChart): адаптивный viewBox, градиентная заливка, плавная
 * линия, подписи осей, hover-тултип. Переиспользует CSS-классы `revenue-*`.
 */
export function StockTrendChart({ data }: { data: Array<{ date: string; value: number }> }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = Math.max(280, Math.round(width));
  const H = W < 480 ? 230 : 270;
  const padL = 50;
  const padR = 18;
  const padT = 20;
  const padB = 36;

  const n = data.length;
  if (n === 0) {
    return <p className="py-20 text-center text-sm text-text-muted">Нет данных для графика</p>;
  }

  const max = Math.max(1, ...data.map((p) => p.value));
  const niceMax = niceCeil(max);
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1);
  const y = (v: number) => padT + (1 - v / niceMax) * (H - padT - padB);

  const pts = data.map((p, i) => [x(i), y(p.value)] as const);
  const line = smoothPath(pts);
  const area = `${line} L ${x(n - 1)} ${H - padB} L ${x(0)} ${H - padB} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(niceMax * t));

  const maxLabels = W < 480 ? 5 : 7;
  const step = Math.max(1, Math.ceil(n / maxLabels));
  const xLabelIdx = data.map((_, i) => i).filter((i) => i % step === 0);
  const lastIdx = n - 1;
  if (lastIdx - (xLabelIdx[xLabelIdx.length - 1] ?? 0) >= step) xLabelIdx.push(lastIdx);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vbX = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const dist = Math.abs(x(i) - vbX);
      if (dist < best) { best = dist; nearest = i; }
    }
    setHover(nearest);
  }

  const hi = hover != null ? data[hover] : null;

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        className="revenue-chart-svg touch-none overflow-visible"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="stock-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#005BFF" stopOpacity="0.18" />
            <stop offset="58%" stopColor="#005BFF" stopOpacity="0.055" />
            <stop offset="100%" stopColor="#005BFF" stopOpacity="0" />
          </linearGradient>
          <filter id="stock-active-glow" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0 0 0 0 0 0.356 0 0 0 0 1 0 0 0 0.24 0" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {ticks.map((t) => {
          const yy = y(t);
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="#F1F5F9" strokeWidth="0.8" />
              <text x={padL - 12} y={yy + 4} textAnchor="end" className="fill-text-light text-[11px] font-medium">
                {shortMoney(t)}
              </text>
            </g>
          );
        })}

        <path d={area} fill="url(#stock-fill)" className="revenue-area" />
        <path
          d={line}
          fill="none"
          stroke="#005BFF"
          strokeWidth="2.8"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          className="revenue-line"
        />

        {xLabelIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 10} textAnchor="middle" className="fill-text-light text-[11px] font-medium">
            {formatAxisLabel(data[i].date)}
          </text>
        ))}

        {hi && hover != null && (
          <g className="revenue-active-point">
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="#D8E2F0" strokeWidth="0.9" strokeDasharray="3 6" />
            <circle cx={x(hover)} cy={y(hi.value)} r="9" fill="#005BFF" opacity="0.1" />
            <circle cx={x(hover)} cy={y(hi.value)} r="5.4" fill="#fff" stroke="#005BFF" strokeWidth="2.6" filter="url(#stock-active-glow)" />
          </g>
        )}
      </svg>

      {hi && hover != null && (
        <div
          className="revenue-tooltip pointer-events-none absolute z-10 -translate-x-1/2 rounded-xl border border-[#E6ECF5] bg-white px-3.5 py-2.5 shadow-[0_16px_36px_rgba(15,23,42,0.12),0_2px_8px_rgba(15,23,42,0.06)]"
          style={{ left: `clamp(76px, ${(x(hover) / W) * 100}%, calc(100% - 76px))`, top: `${(y(hi.value) / H) * 100}%`, transform: 'translate(-50%, calc(-100% - 14px))' }}
        >
          <p className="whitespace-nowrap text-[11px] font-medium leading-none text-text-muted">{formatTooltipLabel(hi.date)}</p>
          <p className="mt-1.5 whitespace-nowrap text-[15px] font-semibold leading-none text-text-primary">{money(hi.value)}</p>
        </div>
      )}
    </div>
  );
}

function smoothPath(pts: readonly (readonly [number, number])[]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0][0]} ${pts[0][1]}` : '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }
  return d;
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function shortMoney(value: number): string {
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1000) return `${trim(value / 1000)}k`;
  return String(value);
}
function trim(n: number) {
  return Number(n.toFixed(1)).toString();
}

function formatAxisLabel(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const dt = new Date(`${raw}T00:00:00`);
    return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  return raw;
}

function formatTooltipLabel(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const dt = new Date(`${raw}T00:00:00`);
    return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }
  return raw;
}
