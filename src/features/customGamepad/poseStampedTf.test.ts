import { describe, expect, it } from 'vitest';
import { lookupTfTransform, TfGraph, updateTfGraph } from './poseStampedTf';

const addTransform = (
  graph: TfGraph,
  parentFrame: string,
  childFrame: string,
  translation: { x: number; y: number; z: number },
  rotation = { x: 0, y: 0, z: 0, w: 1 }
) => updateTfGraph(graph, {
  transforms: [{
    header: { frame_id: parentFrame },
    child_frame_id: childFrame,
    transform: { translation, rotation },
  }],
}, false);

describe('PoseStamped TF lookup', () => {
  it('resolves the reference pose in the output frame', () => {
    const graph: TfGraph = new Map();
    addTransform(graph, 'base_link', 'end_effector', { x: 1, y: 2, z: 3 });

    expect(lookupTfTransform(graph, 'base_link', 'end_effector')).toEqual({
      translation: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
  });

  it('resolves a transform through intermediate links', () => {
    const graph: TfGraph = new Map();
    addTransform(graph, 'base_link', 'arm_link', { x: 1, y: 0, z: 0 });
    addTransform(graph, 'arm_link', 'end_effector', { x: 0, y: 2, z: 0 });

    expect(lookupTfTransform(graph, 'base_link', 'end_effector')).toEqual({
      translation: { x: 1, y: 2, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
  });

  it('inverts the chain when output and reference frames are swapped', () => {
    const graph: TfGraph = new Map();
    addTransform(graph, 'base_link', 'end_effector', { x: 1, y: 2, z: 3 });

    expect(lookupTfTransform(graph, 'end_effector', 'base_link')).toEqual({
      translation: { x: -1, y: -2, z: -3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
  });
});
