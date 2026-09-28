import { describe, expect, it } from 'vitest';
import { fitNewComponent, isAreaFree, occupiedExtent, resizeWithin } from './padGeometry';

const grid = { width: 8, height: 4 };

describe('fitNewComponent', () => {
  it('keeps the preferred size where there is room, centred on the pointer', () => {
    expect(fitNewComponent({ width: 2, height: 2 }, grid, [], { x: 3.96, y: 1.96 })).toEqual({ x: 3, y: 1, width: 2, height: 2 });
  });

  it('shrinks a component larger than the whole grid to the grid', () => {
    expect(fitNewComponent({ width: 6, height: 4 }, { width: 4, height: 3 }, [], { x: 1.5, y: 1.5 })).toEqual({ x: 0, y: 0, width: 4, height: 3 });
  });

  it('stays inside the grid when dropped against its edge', () => {
    expect(fitNewComponent({ width: 3, height: 3 }, grid, [], { x: 7.9, y: 3.9 })).toEqual({ x: 5, y: 1, width: 3, height: 3 });
  });

  it('shrinks to the largest free room around the pointer, keeping its shape where it can', () => {
    // Joysticks fill columns 0-2 and 5-7; the gap between them is 2 wide and 4 high.
    const joysticks = [{ x: 0, y: 0, width: 3, height: 4 }, { x: 5, y: 0, width: 3, height: 4 }];
    const physical = fitNewComponent({ width: 6, height: 4 }, grid, joysticks, { x: 3.5, y: 2 });
    expect(physical).toEqual({ x: 3, y: 0, width: 2, height: 4 });

    // With the bottom of the gap taken too: a 3x3 becomes the 2x3 that is left, a 2x2 lands under the pointer.
    const occupiedBelow = [...joysticks, { x: 3, y: 3, width: 2, height: 1 }];
    expect(fitNewComponent({ width: 3, height: 3 }, grid, occupiedBelow, { x: 4, y: 0.5 })).toEqual({ x: 3, y: 0, width: 2, height: 3 });
    expect(fitNewComponent({ width: 2, height: 2 }, grid, occupiedBelow, { x: 4, y: 2.5 })).toEqual({ x: 3, y: 1, width: 2, height: 2 });
  });

  it('refuses a pointer over another component, and a full grid', () => {
    const taken = [{ x: 0, y: 0, width: 4, height: 4 }];
    expect(fitNewComponent({ width: 2, height: 2 }, grid, taken, { x: 1, y: 1 })).toBeNull();
    expect(fitNewComponent({ width: 1, height: 1 }, { width: 4, height: 4 }, taken)).toBeNull();
  });

  it('without a pointer, takes the first room in reading order', () => {
    expect(fitNewComponent({ width: 2, height: 2 }, grid, [{ x: 0, y: 0, width: 3, height: 2 }])).toEqual({ x: 3, y: 0, width: 2, height: 2 });
  });

  it('always returns a free area inside the grid', () => {
    const occupied = [{ x: 1, y: 1, width: 2, height: 2 }, { x: 5, y: 0, width: 1, height: 3 }];
    for (let px = 0; px < grid.width; px += 0.5) {
      for (let py = 0; py < grid.height; py += 0.5) {
        const rect = fitNewComponent({ width: 4, height: 3 }, grid, occupied, { x: px, y: py });
        if (rect) expect(isAreaFree(rect, grid, occupied)).toBe(true);
      }
    }
  });
});

describe('resizeWithin', () => {
  const start = { x: 2, y: 1, width: 2, height: 2 };

  it('grows and shrinks by whole cells from any edge, at least one cell', () => {
    expect(resizeWithin(start, 'e', 2, 0, grid, [])).toEqual({ x: 2, y: 1, width: 4, height: 2 });
    expect(resizeWithin(start, 'w', -1, 0, grid, [])).toEqual({ x: 1, y: 1, width: 3, height: 2 });
    expect(resizeWithin(start, 'n', 0, 5, grid, [])).toEqual({ x: 2, y: 2, width: 2, height: 1 });
    expect(resizeWithin(start, 'se', -5, -5, grid, [])).toEqual({ x: 2, y: 1, width: 1, height: 1 });
  });

  it('stops at the grid', () => {
    expect(resizeWithin(start, 'nw', -9, -9, grid, [])).toEqual({ x: 0, y: 0, width: 4, height: 3 });
    expect(resizeWithin(start, 'se', 9, 9, grid, [])).toEqual({ x: 2, y: 1, width: 6, height: 3 });
  });

  it('stops at the first neighbour instead of covering it', () => {
    const neighbours = [{ x: 5, y: 0, width: 2, height: 4 }, { x: 0, y: 3, width: 8, height: 1 }];
    expect(resizeWithin(start, 'e', 4, 0, grid, neighbours)).toEqual({ x: 2, y: 1, width: 3, height: 2 });
    expect(resizeWithin(start, 'se', 4, 4, grid, neighbours)).toEqual({ x: 2, y: 1, width: 3, height: 2 });
  });
});

it('knows how small the grid can get around its components', () => {
  expect(occupiedExtent([])).toEqual({ width: 1, height: 1 });
  expect(occupiedExtent([{ position: { x: 5, y: 0, width: 3, height: 2 } }, { position: { x: 0, y: 1, width: 2, height: 3 } }])).toEqual({ width: 8, height: 4 });
});
