/** Widths are React Native logical pixels, including split-screen resizing. */
export function gridLayout(width: number, padding: number, gap: number, minimum: number, maximum: number, phoneColumns = 1) {
  const available = Math.max(0, width - padding * 2);
  const columns = width < 600 ? phoneColumns : Math.max(phoneColumns, Math.min(maximum, Math.floor((available + gap) / (minimum + gap))));
  return { columns, itemWidth: Math.max(0, (available - gap * (columns - 1)) / columns) };
}

/** Fit every row in the viewport using the largest square cards. */
export function tableGridLayout(count: number, width: number, height: number, preferredGap: number) {
  const maxSide = count <= 2 ? 420 : 240;
  let columns = 1;
  let side = 0;
  let gap = 0;

  for (let candidate = 1; candidate <= count; candidate++) {
    const widthPerCard = width / candidate;
    if (widthPerCard < side) break;

    const rows = Math.ceil(count / candidate);
    const candidateGap = Math.min(preferredGap, Math.floor(Math.min(widthPerCard, height / rows) / 4));
    const fittedSide = Math.floor(Math.min(
      maxSide,
      (width - candidateGap * (candidate - 1)) / candidate,
      (height - candidateGap * (rows - 1)) / rows,
    ));

    if (fittedSide >= side) {
      columns = candidate;
      side = fittedSide;
      gap = candidateGap;
    }
  }
  return { columns, side, gap, gridWidth: side * columns + gap * (columns - 1) };
}

export const tabletContentWidth = 1280;
