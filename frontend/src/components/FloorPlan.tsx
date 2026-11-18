import type { CSSProperties, ReactNode, Ref } from 'react';
import type { FloorPlanTable } from '@/types';
import './floor-plan.css';

export const FLOOR_COLUMNS = 24;
export const FLOOR_MAX_ROWS = 600;
export const FLOOR_MIN_SIZE = 4;

export function layoutFloorTables(tables: { id: string }[], saved: FloorPlanTable[] | null | undefined) {
  const savedByTable = new Map(saved?.map((table) => [table.tableId, table]));
  const placements = new Map<string, FloorPlanTable>();
  for (const { id } of tables) {
    const table = savedByTable.get(id);
    if (table) placements.set(id, table);
  }
  let slot = 0;
  for (const { id } of tables) {
    if (placements.has(id)) continue;
    let x: number;
    let y: number;
    do {
      x = 1 + (slot % 4) * 6;
      y = 1 + Math.floor(slot / 4) * 6;
      slot++;
    } while ([...placements.values()].some((table) =>
      x < table.x + table.width && x + FLOOR_MIN_SIZE > table.x &&
      y < table.y + table.height && y + FLOOR_MIN_SIZE > table.y));
    placements.set(id, { tableId: id, x, y, width: FLOOR_MIN_SIZE, height: FLOOR_MIN_SIZE, shape: 'rectangle' });
  }
  return tables.map(({ id }) => placements.get(id)!);
}

export function floorTableStyle(table: FloorPlanTable, rows: number): CSSProperties {
  return {
    left: `${100 * table.x / FLOOR_COLUMNS}%`,
    top: `${100 * table.y / rows}%`,
    width: `${100 * table.width / FLOOR_COLUMNS}%`,
    height: `${100 * table.height / rows}%`,
  };
}

export function FloorPlan({ placements, renderTable, canvasRef, editing, minRows = 14 }: {
  placements: FloorPlanTable[];
  renderTable: (table: FloorPlanTable, style: CSSProperties) => ReactNode;
  canvasRef?: Ref<HTMLDivElement>;
  editing?: boolean;
  minRows?: number;
}) {
  const rows = placements.reduce((max, table) => Math.max(max, table.y + table.height + 2), minRows);
  return <div className="floor-plan-scroll">
    <div ref={canvasRef} className="floor-plan-canvas" data-editing={editing || undefined}
      style={{ aspectRatio: `${FLOOR_COLUMNS} / ${rows}`, backgroundSize: `${100 / FLOOR_COLUMNS}% ${100 / rows}%` }}>
      {placements.map((table) => renderTable(table, floorTableStyle(table, rows)))}
    </div>
  </div>;
}
