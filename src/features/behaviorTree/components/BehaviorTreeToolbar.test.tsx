import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BehaviorTreeToolbar from './BehaviorTreeToolbar';
import { BehaviorTreeEngine } from '../types';

const baseProps = {
  currentTree: null,
  isExecuting: false,
  isPaletteCollapsed: true,
  selectedNodeCount: 0,
  backendLabel: 'Local',
  backendStatus: 'Local executor',
  backendConnected: true,
  onSave: vi.fn(),
  onLoad: vi.fn(),
  onNew: vi.fn(),
  onExecute: vi.fn(),
  onStop: vi.fn(),
  onExport: vi.fn(),
  onTogglePalette: vi.fn(),
  onCycleBackend: vi.fn(),
  onDeleteSelected: vi.fn(),
  onDuplicateSelected: vi.fn(),
  onRename: vi.fn(),
};

describe('BehaviorTreeToolbar', () => {
  it('loads engine-published trees from the normal tree menu', () => {
    const onLoadEngineTree = vi.fn();
    const engineTree = {
      id: 'camera_demo',
      name: 'Camera Demo',
      engine: BehaviorTreeEngine.PyTrees,
      format: 'yaml' as const,
      spec: 'name: Camera Demo\nroot:\n  sequence:\n    name: root\n',
    };

    render(
      <BehaviorTreeToolbar
        {...baseProps}
        engineTrees={[engineTree]}
        onLoadEngineTree={onLoadEngineTree}
      />
    );

    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Camera Demo'));

    expect(onLoadEngineTree).toHaveBeenCalledWith(engineTree);
  });
});
