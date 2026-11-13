/** Widths are React Native logical pixels, including split-screen resizing. */
export function gridLayout(width: number, padding: number, gap: number, minimum: number, maximum: number, phoneColumns = 1) {
  const available = Math.max(0, width - padding * 2);
  const columns = width < 600 ? phoneColumns : Math.max(phoneColumns, Math.min(maximum, Math.floor((available + gap) / (minimum + gap))));
  return { columns, itemWidth: Math.max(0, (available - gap * (columns - 1)) / columns) };
}

/** Keep the hall's column count stable when the viewport changes. */
export function tableGridLayout(count: number, width: number, height: number, gap: number) {
  const columns = Math.min(Math.max(1, count), count <= 6 || count === 8 ? 2 : 3);
  const rowsToFit = Math.max(1, Math.ceil(Math.min(count, 9) / columns));
  const maxSide = count <= 2 ? 420 : 240;
  const sideAtWidth = Math.max(0, Math.floor((width - gap * (columns - 1)) / columns));
  const sideAtHeight = Math.floor((height - gap * (rowsToFit - 1)) / rowsToFit);
  const side = Math.min(maxSide, sideAtWidth, Math.max(64, sideAtHeight));
  return { columns, side, gap, gridWidth: side * columns + gap * (columns - 1) };
}

export const tabletContentWidth = 1280;
