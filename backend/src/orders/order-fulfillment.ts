export const OFFSITE_SOURCES = ['delivery', 'pickup'] as const;

export type OffsiteSource = typeof OFFSITE_SOURCES[number];

export function isOffsiteOrder(source?: string): source is OffsiteSource {
  return source === 'delivery' || source === 'pickup';
}

export function offsiteLabel(source: string) {
  return source === 'pickup' ? 'Самовывоз' : 'Доставка';
}
