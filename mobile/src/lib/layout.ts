/** Widths are React Native logical pixels, including split-screen resizing. */
export function gridLayout(width: number, padding: number, gap: number, minimum: number, maximum: number, phoneColumns = 1) {
  const available = Math.max(0, width - padding * 2);
  const columns = width < 600 ? phoneColumns : Math.max(phoneColumns, Math.min(maximum, Math.floor((available + gap) / (minimum + gap))));
  return { columns, itemWidth: Math.max(0, (available - gap * (columns - 1)) / columns) };
}

/** Size squares by the available width and let extra rows scroll. */
export function tableGridLayout(count: number, width: number, height: number, gap: number) {
  const fewTables = count <= 2;
  const stack = count <= 1 || (count === 2 && height >= width);
  const phoneColumns = stack ? 1 : count <= 6 || width < 240 ? 2 : 3;
  const maxColumns = fewTables ? phoneColumns : Math.min(count, 6);
  const { columns, itemWidth } = gridLayout(width, 0, gap, 168, maxColumns, phoneColumns);
  const rows = Math.max(1, Math.ceil(count / columns));
  const heightPerRow = (height - gap * (rows - 1)) / rows;
  const maxSide = fewTables ? Math.min(420, Math.max(96, heightPerRow)) : 240;
  const fittedSide = count >= 3 && count <= 6 ? Math.min(maxSide, Math.max(0, heightPerRow)) : maxSide;
  const side = Math.floor(Math.min(itemWidth, fittedSide));
  return { columns, side, gap, gridWidth: side * columns + gap * (columns - 1) };
}

export const tabletContentWidth = 1280;
