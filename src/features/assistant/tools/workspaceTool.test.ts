import { describe, expect, it } from 'vitest';
import { describeWorkspaceEditResults, parseWorkspaceEditOperations, resolvePanelType, WORKSPACE_CAPABILITY } from './workspaceTool';
import { parseAssistantResponse } from '../responseParser';

describe('workspace tool', () => {
  it('keeps well-formed operations in order and reports each malformed one', () => {
    const { operations, rejected } = parseWorkspaceEditOperations([
      { op: 'addPanel', panelType: 'behaviorTree', title: ' Tree ' },
      { op: 'removePanel', panelId: 'p1' },
      { op: 'setCameraTopic', panelId: 'p2', cameraTopic: '/image_raw' },
      { op: 'setPanelPad', panelId: 'p3', padId: 'drive' },
      { op: 'applyLayout', layoutId: 'l1' },
      { op: 'saveLayout', title: 'Teleop' },
      { op: 'removePanel' },
      { op: 'teleport' },
      null,
    ]);

    expect(operations).toEqual([
      { op: 'addPanel', panelType: 'behaviorTree', title: 'Tree' },
      { op: 'removePanel', panelId: 'p1' },
      { op: 'setCameraTopic', panelId: 'p2', cameraTopic: '/image_raw' },
      { op: 'setPanelPad', panelId: 'p3', padId: 'drive' },
      { op: 'applyLayout', layoutId: 'l1' },
      { op: 'saveLayout', title: 'Teleop' },
    ]);
    expect(rejected).toEqual([
      'Operation 7: removePanel needs a panelId.',
      'Operation 8: unknown op "teleport".',
      'Operation 9: unknown op "undefined".',
    ]);
  });

  it('is a response kind the parser accepts, and refuses a turn with nothing valid in it', () => {
    const parsed = parseAssistantResponse(
      JSON.stringify({ kind: 'workspaceEdit', summary: 'Add it', operations: [{ op: 'addPanel', panelType: '3d' }, { op: 'x' }] }),
      { actions: {}, services: {} }
    );
    expect(parsed).toEqual({ kind: 'workspaceEdit', summary: 'Add it', operations: [{ op: 'addPanel', panelType: '3d' }], rejected: ['Operation 2: unknown op "x".'] });
    expect(WORKSPACE_CAPABILITY.responseKind).toBe('workspaceEdit');

    expect(() => parseAssistantResponse(JSON.stringify({ kind: 'workspaceEdit', operations: [{ op: 'x' }] }), { actions: {}, services: {} }))
      .toThrow(/no valid workspace change/);
  });

  it('resolves a panel type by id or display name, ignoring case and spacing', () => {
    const catalog = [{ id: 'behaviorTree', name: 'Behavior tree' }, { id: '3d', name: '3D view' }, { id: 'tfTree', name: 'TF tree' }];
    expect(resolvePanelType('behaviorTree', catalog)).toBe('behaviorTree');
    expect(resolvePanelType('behavior tree', catalog)).toBe('behaviorTree');
    expect(resolvePanelType('3D View', catalog)).toBe('3d');
    expect(resolvePanelType('tf-tree', catalog)).toBe('tfTree');
    expect(resolvePanelType('lidar', catalog)).toBeNull();
  });

  it('summarizes outcomes with a mark per line', () => {
    expect(describeWorkspaceEditResults([
      { operation: { op: 'addPanel', panelType: '3d' }, ok: true, message: 'Added a 3D view panel.' },
      { operation: { op: 'removePanel', panelId: 'x' }, ok: false, message: 'No open panel with id "x".' },
    ])).toBe('✓ Added a 3D view panel.\n✗ No open panel with id "x".');
    expect(describeWorkspaceEditResults([])).toBe('Nothing to change.');
  });
});
