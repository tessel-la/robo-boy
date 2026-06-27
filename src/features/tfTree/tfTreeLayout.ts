import { TfTreeState } from './tfTreeModel';

export interface TfNodePosition {
  x: number;
  y: number;
}

const NODE_WIDTH = 172;
const NODE_HEIGHT = 48;
const HORIZONTAL_GAP = 72;
const VERTICAL_GAP = 58;
const COMPONENT_GAP = 110;

/** Arranges TF frames as a top-down forest using the same subtree allocation as BT. */
export const layoutTfTree = (state: TfTreeState): Map<string, TfNodePosition> => {
  const positions = new Map<string, TfNodePosition>();
  const frames = [...state.knownFrames].sort();
  if (frames.length === 0) return positions;

  const frameSet = new Set(frames);
  const incomingCount = new Map(frames.map(frame => [frame, 0]));
  const childrenByFrame = new Map(frames.map(frame => [frame, [] as string[]]));

  state.transformsByChild.forEach(transform => {
    if (!frameSet.has(transform.parentFrame) || !frameSet.has(transform.childFrame)) return;
    childrenByFrame.get(transform.parentFrame)?.push(transform.childFrame);
    incomingCount.set(transform.childFrame, (incomingCount.get(transform.childFrame) ?? 0) + 1);
  });
  childrenByFrame.forEach(children => children.sort());

  const roots = frames.filter(frame => (incomingCount.get(frame) ?? 0) === 0);
  const traversalStarts = [...roots, ...frames];
  const visited = new Set<string>();
  let nextLeafX = 0;

  const layoutSubtree = (frame: string, depth: number, ancestors: Set<string>): number => {
    visited.add(frame);
    const nextAncestors = new Set(ancestors).add(frame);
    const children = Array.from(new Set(childrenByFrame.get(frame) ?? [])).filter(
      child => !visited.has(child) && !nextAncestors.has(child)
    );

    let centerX: number;
    if (children.length === 0) {
      centerX = nextLeafX + NODE_WIDTH / 2;
      nextLeafX += NODE_WIDTH + HORIZONTAL_GAP;
    } else {
      const childCenters = children.map(child => layoutSubtree(child, depth + 1, nextAncestors));
      centerX = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    }

    positions.set(frame, {
      x: centerX - NODE_WIDTH / 2,
      y: depth * (NODE_HEIGHT + VERTICAL_GAP),
    });
    return centerX;
  };

  traversalStarts.forEach(frame => {
    if (visited.has(frame)) return;
    layoutSubtree(frame, 0, new Set());
    nextLeafX += COMPONENT_GAP;
  });

  return positions;
};
