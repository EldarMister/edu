import type { ReactNode } from 'react';

const builtinColors: Record<string, string> = {
  spoilage: '#e87061',
  expired: '#e6aa4a',
  damage: '#d983cc',
  staff_meal: '#63b97e',
  tasting: '#44bec9',
  household: '#a88cf5',
  other: '#9aa8b9',
};

function reasonColor(id?: string | null) {
  if (!id) return '#5495ed';
  if (Object.prototype.hasOwnProperty.call(builtinColors, id)) return builtinColors[id];
  // IDs stay stable when the name changes or the reason is archived.
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 70% 63%)`;
}

export function WriteoffReasonBadge({ id, children }: { id?: string | null; children: ReactNode }) {
  return <span className="inline-flex max-w-full items-baseline gap-2">
    <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: reasonColor(id) }} />
    <span className="min-w-0 break-words">{children}</span>
  </span>;
}
