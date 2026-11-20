import type { CSSProperties, ReactNode, Ref } from 'react';
import type { FloorPlanTable } from '@/types';
import './floor-plan.css';

export const FLOOR_COLUMNS = 24;
export const FLOOR_MAX_ROWS = 600;
export const FLOOR_MIN_SIZE = 4;

type FloorBounds = { x: number; y: number; columns: number; rows: number };
type FloorTableStyle = CSSProperties & { '--floor-plan-table-scale'?: number };

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

function floorTableScale(table: FloorPlanTable, tables: FloorPlanTable[], bounds: FloorBounds) {
  const centerX = table.x + table.width / 2;
  const centerY = table.y + table.height / 2;
  const horizontalRoom = Math.min(centerX - bounds.x, bounds.x + bounds.columns - centerX);
  const verticalRoom = Math.min(centerY - bounds.y, bounds.y + bounds.rows - centerY);
  let scale = Math.min(1.16, 2 * horizontalRoom / table.width, 2 * verticalRoom / table.height);

  for (const other of tables) {
    if (other === table) continue;
    const horizontalScale = 2 * Math.abs(centerX - other.x - other.width / 2) / (table.width + other.width);
    const verticalScale = 2 * Math.abs(centerY - other.y - other.height / 2) / (table.height + other.height);
    // At least one axis must still separate the two tables after scaling.
    scale = Math.min(scale, Math.max(horizontalScale, verticalScale));
    if (scale <= 1) return 1;
  }
  return Math.max(1, scale);
}

function floorTableStyle(table: FloorPlanTable, { x, y, columns, rows }: FloorBounds, fit: boolean): FloorTableStyle {
  // Spread table centres over the visible rectangle while keeping each table's proportions.
  const top = table.y - y + (fit ? table.height / 2 : 0);
  return {
    left: `${100 * (table.x - x) / columns}%`,
    top: `${100 * top / rows}%`,
    width: `${100 * table.width / columns}%`,
    height: fit ? `${100 * table.height / columns}cqw` : `${100 * table.height / rows}%`,
    translate: fit ? '0 -50%' : undefined,
  };
}

export function FloorPlan({ placements, renderTable, canvasRef, editing, fit = false }: {
  placements: FloorPlanTable[];
  renderTable: (table: FloorPlanTable, style: CSSProperties) => ReactNode;
  canvasRef?: Ref<HTMLDivElement>;
  editing?: boolean;
  fit?: boolean;
}) {
  let x = 0;
  let y = 0;
  let columns = FLOOR_COLUMNS;
  let rows = placements.reduce((max, table) => Math.max(max, table.y + table.height + 2), 32);
  if (fit && placements.length) {
    x = Math.max(0, Math.min(...placements.map((table) => table.x)) - 1);
    y = Math.max(0, Math.min(...placements.map((table) => table.y)) - 1);
    columns = Math.max(10, Math.max(...placements.map((table) => table.x + table.width)) - x + 1);
    rows = Math.max(6, Math.max(...placements.map((table) => table.y + table.height)) - y + 1);
  }
  const bounds = { x, y, columns, rows };
  return <div className="floor-plan-scroll" data-fit={fit || undefined}>
    <div ref={canvasRef} className="floor-plan-canvas" data-editing={editing || undefined}
      style={{ aspectRatio: `${columns} / ${rows}`, backgroundSize: `${100 / columns}% ${100 / rows}%` }}>
      {placements.map((table) => {
        const style = floorTableStyle(table, bounds, fit);
        if (fit) style['--floor-plan-table-scale'] = floorTableScale(table, placements, bounds);
        return renderTable(table, style);
      })}
    </div>
  </div>;
}
