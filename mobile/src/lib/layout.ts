/** Widths are React Native logical pixels, including split-screen resizing. */
export function gridLayout(width: number, padding: number, gap: number, minimum: number, maximum: number, phoneColumns = 1) {
  const available = Math.max(0, width - padding * 2);
  const columns = width < 600 ? phoneColumns : Math.max(phoneColumns, Math.min(maximum, Math.floor((available + gap) / (minimum + gap))));
  return { columns, itemWidth: Math.max(0, (available - gap * (columns - 1)) / columns) };
}
export const tabletContentWidth = 1280;
