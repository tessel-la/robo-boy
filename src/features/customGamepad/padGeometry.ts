// Where components go on a pad's grid: fitting a new one into the room there is, resizing without running into its
// neighbours, and how small the grid can get around what is on it. Positions and sizes are in whole cells.

export interface GridRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridSize {
  width: number;
  height: number;
}

/** A pointer on the grid in cell units: 0 at the first cell's leading edge, 1 at the next cell's. */
export interface GridPoint {
  x: number;
  y: number;
}

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const overlaps = (a: GridRect, b: GridRect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const isInsideGrid = (rect: GridRect, grid: GridSize) =>
  rect.width >= 1 && rect.height >= 1 && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= grid.width && rect.y + rect.height <= grid.height;

/** Inside the grid and clear of every occupied area. */
export const isAreaFree = (rect: GridRect, grid: GridSize, occupied: readonly GridRect[]) =>
  isInsideGrid(rect, grid) && !occupied.some(other => overlaps(rect, other));

/**
 * Where a new component goes: at most its preferred size, as large as the free room allows, covering the cell under
 * the pointer and centred on it as nearly as it can be. Without a pointer, the first place in reading order.
 * Null when there is no room: the pointer is over another component, or the grid is full.
 */
export function fitNewComponent(preferred: GridSize, grid: GridSize, occupied: readonly GridRect[], at?: GridPoint): GridRect | null {
  const maxWidth = Math.min(Math.max(1, Math.round(preferred.width)), grid.width);
  const maxHeight = Math.min(Math.max(1, Math.round(preferred.height)), grid.height);
  if (maxWidth < 1 || maxHeight < 1) return null;

  // Free cells as a summed-area table, so any rectangle is checked in constant time.
  const free = Array.from({ length: grid.height + 1 }, () => new Array<number>(grid.width + 1).fill(0));
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const taken = occupied.some(o => x >= o.x && x < o.x + o.width && y >= o.y && y < o.y + o.height);
      free[y + 1][x + 1] = (taken ? 0 : 1) + free[y][x + 1] + free[y + 1][x] - free[y][x];
    }
  }
  const allFree = (x: number, y: number, w: number, h: number) =>
    free[y + h][x + w] - free[y][x + w] - free[y + h][x] + free[y][x] === w * h;

  const pointer = at && {
    x: Math.min(grid.width - 0.5, Math.max(0.5, at.x)),
    y: Math.min(grid.height - 0.5, Math.max(0.5, at.y)),
  };
  const cell = pointer && { x: Math.floor(pointer.x), y: Math.floor(pointer.y) };
  if (cell && !allFree(cell.x, cell.y, 1, 1)) return null;

  // Largest first; between equal areas, the shape nearest the preferred one.
  const preferredRatio = Math.log(maxWidth / maxHeight);
  const sizes: GridSize[] = [];
  for (let w = maxWidth; w >= 1; w--) for (let h = maxHeight; h >= 1; h--) sizes.push({ width: w, height: h });
  sizes.sort((a, b) => b.width * b.height - a.width * a.height
    || Math.abs(Math.log(a.width / a.height) - preferredRatio) - Math.abs(Math.log(b.width / b.height) - preferredRatio));

  for (const { width, height } of sizes) {
    const xs = cell ? range(Math.max(0, cell.x - width + 1), Math.min(cell.x, grid.width - width)) : range(0, grid.width - width);
    const ys = cell ? range(Math.max(0, cell.y - height + 1), Math.min(cell.y, grid.height - height)) : range(0, grid.height - height);
    let best: GridRect | null = null;
    let bestDistance = Infinity;
    for (const y of ys) {
      for (const x of xs) {
        if (!allFree(x, y, width, height)) continue;
        if (!pointer) return { x, y, width, height };
        const distance = Math.hypot(x + width / 2 - pointer.x, y + height / 2 - pointer.y);
        if (distance < bestDistance - 1e-9) { best = { x, y, width, height }; bestDistance = distance; }
      }
    }
    if (best) return best;
  }
  return null;
}

const range = (from: number, to: number) => (to < from ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i));

/**
 * A resize from one edge or corner by whole cells: at least one cell, never past the grid, and stopping at the first
 * neighbour in the way rather than covering it.
 */
export function resizeWithin(start: GridRect, edge: ResizeEdge, columns: number, rows: number, grid: GridSize, occupied: readonly GridRect[]): GridRect {
  let rect = { ...start };
  const blocked = (r: GridRect) => occupied.some(other => overlaps(r, other));
  if (edge.includes('e')) {
    rect.width = clamp(start.width + columns, 1, grid.width - start.x);
    while (rect.width > start.width && blocked(rect)) rect.width--;
  } else if (edge.includes('w')) {
    const right = start.x + start.width;
    rect.x = clamp(start.x + columns, 0, right - 1);
    rect.width = right - rect.x;
    while (rect.x < start.x && blocked(rect)) { rect.x++; rect.width--; }
  }
  const horizontal = rect;
  if (edge.includes('s')) {
    rect = { ...horizontal, height: clamp(start.height + rows, 1, grid.height - start.y) };
    while (rect.height > start.height && blocked(rect)) rect.height--;
  } else if (edge.includes('n')) {
    const bottom = start.y + start.height;
    rect = { ...horizontal, y: clamp(start.y + rows, 0, bottom - 1) };
    rect.height = bottom - rect.y;
    while (rect.y < start.y && blocked(rect)) { rect.y++; rect.height--; }
  }
  return rect;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** The smallest grid that still holds every component where it is. */
export const occupiedExtent = (components: readonly { position: GridRect }[]): GridSize => ({
  width: Math.max(1, ...components.map(c => c.position.x + c.position.width)),
  height: Math.max(1, ...components.map(c => c.position.y + c.position.height)),
});

/** Where the cells of a rendered grid are: the first one's box and the step to the next column and row. */
export interface GridCellMetrics {
  left: number;
  top: number;
  cellWidth: number;
  cellHeight: number;
  columnStep: number;
  rowStep: number;
}

/** Measures the cells the editor draws behind the grid (`.grid-background .grid-cell`). */
export function measureGridCells(gridEl: Element, grid: GridSize): GridCellMetrics | null {
  const cells = gridEl.querySelectorAll<HTMLElement>('.grid-background .grid-cell');
  const first = cells[0]?.getBoundingClientRect();
  if (!first || first.width <= 0 || first.height <= 0) return null;
  const nextColumn = grid.width > 1 ? cells[1]?.getBoundingClientRect() : null;
  const nextRow = grid.height > 1 ? cells[grid.width]?.getBoundingClientRect() : null;
  const columnStep = nextColumn ? nextColumn.left - first.left : first.width;
  const rowStep = nextRow ? nextRow.top - first.top : first.height;
  if (columnStep <= 0 || rowStep <= 0) return null;
  return { left: first.left, top: first.top, cellWidth: first.width, cellHeight: first.height, columnStep, rowStep };
}
