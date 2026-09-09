import { describe, expect, it } from 'vitest';
import {
  createWorkspaceLayoutFromRows,
  getWorkspaceLayoutTileIds,
  normalizeWorkspaceLayout,
  placeWorkspaceLayoutTile,
  removeWorkspaceLayoutTile,
  updateWorkspaceSplitRatio,
} from './workspaceLayout';

describe('workspaceLayout', () => {
  it('migrates the legacy row model without changing tile order', () => {
    const layout = normalizeWorkspaceLayout(
      { rowSizes: [2, 1], rowRatios: [2, 1], columnRatiosByRow: { 0: [1, 2], 1: [1] } },
      ['a', 'b', 'c']
    );

    expect(layout.version).toBe(2);
    expect(getWorkspaceLayoutTileIds(layout.root)).toEqual(['a', 'b', 'c']);
    expect(layout.root).toMatchObject({ type: 'split', axis: 'y' });
  });

  it('naturally represents a full-height tile beside a stacked pair', () => {
    let layout = createWorkspaceLayoutFromRows([['a', 'b']]);
    layout = placeWorkspaceLayoutTile(layout.root, 'c', {
      mode: 'tile',
      targetTileId: 'b',
      edge: 'bottom',
    });

    expect(layout.root).toMatchObject({
      type: 'split',
      axis: 'x',
      first: { type: 'tile', id: 'a' },
      second: {
        type: 'split',
        axis: 'y',
        first: { type: 'tile', id: 'b' },
        second: { type: 'tile', id: 'c' },
      },
    });
  });

  it('moves a tile without duplicating it and collapses empty splits', () => {
    const original = createWorkspaceLayoutFromRows([['a', 'b'], ['c']]);
    const moved = placeWorkspaceLayoutTile(original.root, 'a', {
      mode: 'tile',
      targetTileId: 'c',
      edge: 'right',
    });

    expect(getWorkspaceLayoutTileIds(moved.root)).toEqual(['b', 'c', 'a']);
    expect(getWorkspaceLayoutTileIds(removeWorkspaceLayoutTile(moved.root, 'c'))).toEqual(['b', 'a']);
  });

  it('updates only the addressed nested split ratio', () => {
    const original = createWorkspaceLayoutFromRows([['a'], ['b', 'c']]);
    const updated = updateWorkspaceSplitRatio(original.root, '1', 0.7);

    expect(updated).toMatchObject({
      type: 'split',
      ratio: 0.5,
      second: { type: 'split', ratio: 0.7 },
    });
  });

  it('drops malformed and duplicate persisted nodes and restores missing tiles', () => {
    const layout = normalizeWorkspaceLayout(
      {
        version: 2,
        root: {
          type: 'split',
          axis: 'x',
          ratio: 4,
          first: { type: 'tile', id: 'a' },
          second: { type: 'tile', id: 'a' },
        },
      },
      ['a', 'b']
    );

    expect(getWorkspaceLayoutTileIds(layout.root)).toEqual(['a', 'b']);
  });
});
