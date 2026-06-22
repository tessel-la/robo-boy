import { TfTreeState, computeConnectedComponents } from './tfTreeModel';

export interface TfNodePosition {
  x: number;
  y: number;
}

const NODE_WIDTH = 172;
const NODE_HEIGHT = 48;
const COLUMN_GAP = 72;
const ROW_GAP = 58;
const COMPONENT_GAP = 110;

export const layoutTfTree = (state: TfTreeState): Map<string, TfNodePosition> => {
  const positions = new Map<string, TfNodePosition>();
  let componentOffsetX = 0;

  computeConnectedComponents(state).forEach(component => {
    const componentSet = new Set(component);
    const childrenByParent = new Map<string, string[]>();
    const children = new Set<string>();

    state.transformsByChild.forEach(transform => {
      if (!componentSet.has(transform.parentFrame) || !componentSet.has(transform.childFrame)) return;
      const siblings = childrenByParent.get(transform.parentFrame) ?? [];
      siblings.push(transform.childFrame);
      childrenByParent.set(transform.parentFrame, siblings);
      children.add(transform.childFrame);
    });
    childrenByParent.forEach(siblings => siblings.sort());

    const roots = component.filter(frame => !children.has(frame));
    const depthByFrame = new Map<string, number>();
    const visitFrom = (startFrames: string[]) => {
      const queue = startFrames.map(frame => ({ frame, depth: 0 }));
      while (queue.length > 0) {
        const { frame, depth } = queue.shift()!;
        if (depthByFrame.has(frame)) continue;
        depthByFrame.set(frame, depth);
        (childrenByParent.get(frame) ?? []).forEach(child => {
          queue.push({ frame: child, depth: depth + 1 });
        });
      }
    };

    visitFrom(roots.length > 0 ? roots : [component[0]]);
    component.forEach(frame => {
      if (!depthByFrame.has(frame)) visitFrom([frame]);
    });

    const framesByDepth = new Map<number, string[]>();
    component.forEach(frame => {
      const depth = depthByFrame.get(frame) ?? 0;
      const frames = framesByDepth.get(depth) ?? [];
      frames.push(frame);
      framesByDepth.set(depth, frames);
    });

    let componentWidth = NODE_WIDTH;
    framesByDepth.forEach(frames => {
      frames.sort();
      componentWidth = Math.max(
        componentWidth,
        frames.length * NODE_WIDTH + Math.max(0, frames.length - 1) * COLUMN_GAP
      );
    });

    framesByDepth.forEach((frames, depth) => {
      const rowWidth = frames.length * NODE_WIDTH + Math.max(0, frames.length - 1) * COLUMN_GAP;
      const rowOffset = componentOffsetX + (componentWidth - rowWidth) / 2;
      frames.forEach((frame, index) => {
        positions.set(frame, {
          x: rowOffset + index * (NODE_WIDTH + COLUMN_GAP),
          y: depth * (NODE_HEIGHT + ROW_GAP),
        });
      });
    });

    componentOffsetX += componentWidth + COMPONENT_GAP;
  });

  return positions;
};
