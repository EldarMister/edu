export type SelectAnchor = { x: number; y: number; width: number; height: number };

export function anchoredSelectPosition(
  anchor: SelectAnchor,
  viewport: { width: number; height: number },
  desired: { width: number; height: number },
  insets: { left: number; right: number; top: number; bottom: number },
) {
  const gap = 6;
  const leftEdge = insets.left + 8;
  const rightEdge = viewport.width - insets.right - 8;
  const topEdge = insets.top + 8;
  const bottomEdge = viewport.height - insets.bottom - 8;
  const width = Math.max(1, Math.min(rightEdge - leftEdge, Math.max(anchor.width, desired.width)));
  const left = Math.max(leftEdge, Math.min(anchor.x, rightEdge - width));
  const above = anchor.y - gap - topEdge;
  const below = bottomEdge - anchor.y - anchor.height - gap;
  const opensUp = below < desired.height && above > below;
  const height = Math.max(1, Math.min(desired.height, opensUp ? above : below, bottomEdge - topEdge));
  const preferredTop = opensUp ? anchor.y - gap - height : anchor.y + anchor.height + gap;
  const top = Math.max(topEdge, Math.min(preferredTop, bottomEdge - height));
  return { left, top, width, height };
}

export function selectSearchMatches(option: { label: string; searchText?: string }, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return !normalized || (option.label + ' ' + (option.searchText ?? '')).toLocaleLowerCase().includes(normalized);
}
