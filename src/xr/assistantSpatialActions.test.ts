import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { applySpatialWorkspaceOperation, spatialWorkspaceSnapshot } from './assistantSpatialActions';
import { parseWorkspaceEditOperations } from '../features/assistant/tools/workspaceTool';
import { composeAssistantSystemPrompt } from '../features/assistant/prompt';

const setup = () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(2, 1.6, 3);
  camera.rotation.y = Math.PI / 2;
  camera.updateMatrixWorld();
  const room = new THREE.Group();
  room.rotation.y = 0.3;
  room.position.set(1, 0.1, -1);
  room.updateMatrixWorld();
  const panels = ['Camera', 'Pad', 'TF'].map((title, i) => {
    const object = new THREE.Group();
    room.add(object);
    object.position.set(i, 1, -2);
    return { id: `p${i}`, title, object };
  });
  return { camera, panels };
};
describe('assistant spatial placement', () => {
  it('validates only semantic directions/layouts at the model boundary', () => {
    const parsed = parseWorkspaceEditOperations([
      { op: 'movePanel', panelId: 'p', direction: 'front' },
      { op: 'movePanel', panelId: 'p', direction: 'teleport' },
      { op: 'arrangePanels', layout: 'grid' },
      { op: 'arrangePanels', layout: 'anything' },
    ]);
    expect(parsed.operations).toHaveLength(2);
    expect(parsed.rejected).toHaveLength(2);
  });
  it('places in front of a rotated viewer/room, preserves scale and persists only after cancel', () => {
    const { camera, panels } = setup();
    panels[0].object.scale.setScalar(1.7);
    const events: string[] = [];
    const result = applySpatialWorkspaceOperation(
      { op: 'movePanel', panelId: 'p0', direction: 'front' },
      camera,
      panels,
      () => events.push('cancel'),
      () => events.push('persist')
    );
    expect(result.ok).toBe(true);
    expect(events).toEqual(['cancel', 'persist']);
    expect(spatialWorkspaceSnapshot(camera, panels).panels[0]).toEqual({
      id: 'p0',
      right: 0,
      up: -0.15,
      forward: 1.4,
      scale: 1.7,
    });
    const towardsHead = camera.position.clone().sub(panels[0].object.getWorldPosition(new THREE.Vector3())).normalize();
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
      panels[0].object.getWorldQuaternion(new THREE.Quaternion())
    );
    expect(normal.dot(towardsHead)).toBeGreaterThan(0.98);
  });
  it('rejects unmounted targets and unsafe distances without cancelling or persisting', () => {
    const { camera, panels } = setup();
    const cancel = vi.fn(),
      persist = vi.fn();
    expect(
      applySpatialWorkspaceOperation(
        { op: 'movePanel', panelId: 'absent', direction: 'front' },
        camera,
        panels,
        cancel,
        persist
      ).ok
    ).toBe(false);
    panels[0].object.position.copy(
      panels[0].object.parent!.worldToLocal(camera.position.clone().add(new THREE.Vector3(-0.75, 0, 0)))
    );
    expect(
      applySpatialWorkspaceOperation(
        { op: 'movePanel', panelId: 'p0', direction: 'closer' },
        camera,
        panels,
        cancel,
        persist
      ).ok
    ).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
  it.each(['arc', 'grid'] as const)(
    'arranges %s in front of the viewer and preserves panel identities/scales',
    layout => {
      const { camera, panels } = setup();
      const persist = vi.fn();
      expect(applySpatialWorkspaceOperation({ op: 'arrangePanels', layout }, camera, panels, vi.fn(), persist).ok).toBe(
        true
      );
      const snapshot = spatialWorkspaceSnapshot(camera, panels);
      expect(snapshot.panels.map(p => p.id)).toEqual(['p0', 'p1', 'p2']);
      expect(snapshot.panels.every(p => p.forward > 0 && p.scale === 1)).toBe(true);
      expect(new Set(snapshot.panels.map(p => p.right)).size).toBe(3);
      expect(persist).toHaveBeenCalledTimes(3);
    }
  );
  it('advertises spatial operations only when a spatial snapshot exists', () => {
    const autoContext = {
      workspace: {
        openPanels: [],
        savedLayouts: [],
        panelCatalog: [],
        connectionStatus: 'connected' as const,
        selectedPadLayoutId: null,
        openBehaviorTreeId: null,
        fetchedAt: 0,
      },
      padLibrary: [],
      behaviorTreeLibrary: [],
    };
    const input = {
      settings: { systemContext: '', robotContext: '' },
      autoContext,
      pinnedChips: [],
      needs: { workspace: true, pad: false, behaviorTree: false, rosAction: false },
    };
    expect(composeAssistantSystemPrompt(input)).not.toContain('"op":"movePanel"');
    expect(
      composeAssistantSystemPrompt({
        ...input,
        autoContext: { ...autoContext, workspace: { ...autoContext.workspace, spatial: { panels: [] } } },
      })
    ).toContain('"op":"movePanel"');
  });
});
