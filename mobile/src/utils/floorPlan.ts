import type { FloorPlanTable } from '@/types';

export const FLOOR_COLUMNS = 24;
export const FLOOR_MAX_ROWS = 600;
export const FLOOR_MIN_SIZE = 4;

export function layoutFloorTables(tables: readonly { id: string }[], saved?: readonly FloorPlanTable[] | null) {
  const savedById = new Map(saved?.map((table) => [table.tableId, table]));
  const placements = tables.flatMap(({ id }) => {
    const placement = savedById.get(id);
    return placement ? [placement] : [];
  });
  const byId = new Map(placements.map((placement) => [placement.tableId, placement]));
  let slot = 0;
  for (const { id } of tables) {
    if (byId.has(id)) continue;
    for (; slot < FLOOR_MAX_ROWS / 6 * 4; slot++) {
      const x = 1 + (slot % 4) * 6;
      const y = 1 + Math.floor(slot / 4) * 6;
      if (placements.some((table) => x < table.x + table.width && x + FLOOR_MIN_SIZE > table.x
        && y < table.y + table.height && y + FLOOR_MIN_SIZE > table.y)) continue;
      const placement = { tableId: id, x, y, width: FLOOR_MIN_SIZE, height: FLOOR_MIN_SIZE, shape: 'rectangle' as const };
      placements.push(placement);
      byId.set(id, placement);
      break;
    }
  }
  return tables.flatMap(({ id }) => {
    const placement = byId.get(id);
    return placement ? [placement] : [];
  });
}

const clamp = (number: number, min: number, max: number) => Math.max(min, Math.min(number, max));

export function shiftFloorTable(table: FloorPlanTable, dx: number, dy: number, resize: boolean): Partial<FloorPlanTable> {
  return resize
    ? { width: clamp(table.width + dx, FLOOR_MIN_SIZE, FLOOR_COLUMNS - table.x),
        height: clamp(table.height + dy, FLOOR_MIN_SIZE, FLOOR_MAX_ROWS - table.y) }
    : { x: clamp(table.x + dx, 0, FLOOR_COLUMNS - table.width),
        y: clamp(table.y + dy, 0, FLOOR_MAX_ROWS - table.height) };
}

export function floorPlanBounds(placements: FloorPlanTable[], fit: boolean) {
  if (!fit || placements.length === 0) {
    return { x: 0, y: 0, columns: FLOOR_COLUMNS, rows: placements.reduce((max, table) => Math.max(max, table.y + table.height + 2), 32) };
  }
  const x = Math.max(0, Math.min(...placements.map((table) => table.x)) - 1);
  const y = Math.max(0, Math.min(...placements.map((table) => table.y)) - 1);
  return {
    x, y,
    columns: Math.max(10, Math.max(...placements.map((table) => table.x + table.width)) - x + 1),
    rows: Math.max(6, Math.max(...placements.map((table) => table.y + table.height)) - y + 1),
  };
}

export function tableLabel(table: { name?: string | null; number: number }, prefix = 'Стол') {
  return table.name?.trim() || `${prefix} ${table.number}`;
}
