import { describe, expect, it } from 'vitest';

import { consumeTfMessage, createEmptyTfTreeState } from './tfTreeModel';
import { layoutTfTree } from './tfTreeLayout';

const transform = (parent: string, child: string) => ({
  header: { frame_id: parent, stamp: { sec: 1, nanosec: 0 } },
  child_frame_id: child,
});

describe('layoutTfTree', () => {
  it('places descendants below their parent and separates disconnected trees', () => {
    const state = consumeTfMessage(
      createEmptyTfTreeState(),
      {
        transforms: [transform('map', 'base'), transform('base', 'laser'), transform('world', 'camera')],
      },
      'dynamic',
      2_000
    );
    const positions = layoutTfTree(state);

    expect(positions.get('base')!.y).toBeGreaterThan(positions.get('map')!.y);
    expect(positions.get('laser')!.y).toBeGreaterThan(positions.get('base')!.y);
    expect(positions.get('world')!.x).toBeGreaterThan(positions.get('map')!.x);
  });

  it('lays out cyclic graphs once without hanging', () => {
    const state = consumeTfMessage(
      createEmptyTfTreeState(),
      { transforms: [transform('a', 'b'), transform('b', 'a')] },
      'dynamic',
      2_000
    );

    expect([...layoutTfTree(state).keys()].sort()).toEqual(['a', 'b']);
  });

  it('allocates branch width recursively and centers parents over their descendants', () => {
    const state = consumeTfMessage(
      createEmptyTfTreeState(),
      {
        transforms: [
          transform('root', 'left'),
          transform('root', 'right'),
          transform('left', 'left-a'),
          transform('left', 'left-b'),
          transform('right', 'right-a'),
        ],
      },
      'dynamic',
      2_000
    );
    const positions = layoutTfTree(state);
    const center = (frame: string) => positions.get(frame)!.x + 86;

    expect(center('left-a')).toBeLessThan(center('left-b'));
    expect(center('left-b')).toBeLessThan(center('right-a'));
    expect(center('left')).toBeGreaterThan(center('left-a'));
    expect(center('left')).toBeLessThan(center('left-b'));
    expect(center('root')).toBeGreaterThan(center('left'));
    expect(center('root')).toBeLessThan(center('right'));
  });
});
