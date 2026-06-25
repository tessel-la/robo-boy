import React, { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MainControlView from './MainControlView';

const connect = vi.fn();
const disconnect = vi.fn();
const getTopics = vi.fn();
const mockRos = { getTopics };
const stopBehaviorTree = vi.fn();
const loadGamepadLibrary = vi.fn();
const getGamepadLayout = vi.fn();
const cloneGamepadTemplate = vi.fn();
const saveGamepadFromEditor = vi.fn();

vi.mock('../hooks/useRos', () => ({
  useRos: () => ({
    ros: mockRos,
    isConnected: true,
    connect,
    disconnect,
  }),
}));

vi.mock('../hooks/useResizablePanels', () => ({
  useResizablePanels: () => ({
    topHeight: 60,
    bottomHeight: 40,
    handleMouseDown: vi.fn(),
    handleTouchStart: vi.fn(),
    containerRef: { current: null },
    isDragging: false,
  }),
}));

vi.mock('animejs', () => ({
  default: {
    timeline: vi.fn(() => ({
      add: vi.fn((options) => {
        options?.complete?.();
        return undefined;
      }),
    })),
  },
}));

vi.mock('../features/customGamepad/gamepadStorage', () => ({
  loadGamepadLibrary: () => loadGamepadLibrary(),
  getGamepadLayout: (layoutId: string) => getGamepadLayout(layoutId),
  cloneGamepadTemplate: (layoutId: string) => cloneGamepadTemplate(layoutId),
}));

vi.mock('./CameraView', () => ({
  default: ({ cameraTopic, availableTopics, onTopicChange, selectId }: any) => (
    <div data-testid="camera-view">
      <span>{cameraTopic}</span>
      <select
        aria-label="Camera topic"
        id={selectId}
        value={cameraTopic}
        onChange={(event) => onTopicChange(event.target.value)}
      >
        {availableTopics.map((topic: string) => (
          <option key={topic} value={topic}>{topic}</option>
        ))}
      </select>
    </div>
  ),
}));

vi.mock('./VisualizationPanel', () => ({
  default: ({ storageKey }: any) => (
    <div data-testid="visualization-panel">{storageKey || 'base-visualization'}</div>
  ),
}));

vi.mock('./gamepads/custom/CustomGamepadWrapper', () => ({
  default: ({ layoutId }: any) => <div data-testid="custom-gamepad">{layoutId}</div>,
}));

vi.mock('./AddPanelMenu', () => ({
  default: ({ isOpen, onSelectLayout, onOpenTemplate, onOpenCustomEditor }: any) => (
    isOpen ? (
      <div data-testid="add-panel-menu">
        <button type="button" onClick={() => onSelectLayout('custom-drive')}>Add custom drive</button>
        <button type="button" onClick={() => onOpenTemplate('template-drive')}>Open template</button>
        <button type="button" onClick={() => onOpenCustomEditor()}>Open editor</button>
      </div>
    ) : null
  ),
}));

vi.mock('../features/customGamepad/components/GamepadEditor', () => ({
  default: ({ onSave, onClose, initialLayout }: any) => (
    <div data-testid="gamepad-editor">
      <span>{initialLayout?.name || 'New pad'}</span>
      <button
        type="button"
        onClick={() => {
          saveGamepadFromEditor();
          onSave({
            id: 'saved-pad',
            name: 'Saved Pad',
            description: '',
            gridSize: { width: 4, height: 4 },
            cellSize: 80,
            components: [],
            rosConfig: { defaultTopic: '/joy', defaultMessageType: 'sensor_msgs/msg/Joy' },
            metadata: { created: '', modified: '', version: '1.0.0' },
          });
        }}
      >
        Save pad
      </button>
      <button type="button" onClick={onClose}>Close editor</button>
    </div>
  ),
}));

vi.mock('../features/behaviorTree/components/BehaviorTreePanel', () => ({
  default: ({ onExecutionChange, onExecutionControlsChange, isActive }: any) => {
    useEffect(() => {
      onExecutionControlsChange?.({ stop: stopBehaviorTree });
    }, []);

    return (
      <div data-testid="behavior-tree-panel">
        <span>{isActive ? 'active behavior tree' : 'inactive behavior tree'}</span>
        <button
          type="button"
          onClick={() => onExecutionChange?.({
            isExecuting: true,
            treeName: 'Inspect Tree',
            activeNodeLabel: 'Move arm',
          })}
        >
          Start mocked tree
        </button>
      </div>
    );
  },
}));

const workspacePanelsKey = 'robo-boy-desktop-workspace-panels-v1';
const workspaceLayoutKey = 'robo-boy-desktop-workspace-layout-v1';
const workspaceTileOrderKey = 'robo-boy-desktop-workspace-tile-order-v1';
const workspaceSavedLayoutsKey = 'robo-boy-desktop-workspace-saved-layouts-v1';
const workspaceActiveLayoutKey = 'robo-boy-desktop-workspace-active-layout-v1';
const workspaceOpenKey = 'robo-boy-desktop-workspace-open-v1';
const customTemplatesKey = 'robo-boy-desktop-workspace-custom-templates-v1';

const connectionParams = {
  ip: '127.0.0.1',
  port: 9090,
  ros2Option: 'domain' as const,
  ros2Value: '0',
};

const makePanel = (id: string, type: 'camera' | '3d' | 'pad' | 'behaviorTree', title: string) => ({
  id,
  type,
  title,
  cameraTopic: type === 'camera' ? '/camera/image_raw' : undefined,
  layoutId: type === 'pad' ? 'custom-drive' : undefined,
});

const renderMainControlView = () => (
  render(<MainControlView connectionParams={connectionParams} onDisconnect={vi.fn()} />)
);

describe('MainControlView desktop workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    loadGamepadLibrary.mockReturnValue([
      { id: 'custom-drive', name: 'Drive Pad', layout: { id: 'custom-drive' }, isDefault: false },
    ]);
    getGamepadLayout.mockReturnValue({ id: 'custom-drive', name: 'Drive Pad', layout: { id: 'custom-drive', name: 'Drive Pad' } });
    cloneGamepadTemplate.mockReturnValue({ id: 'template-copy', name: 'Template Copy' });
    getTopics.mockImplementation((success: any) => {
      success({
        topics: ['/camera/image_raw', '/status'],
        types: ['sensor_msgs/Image', 'std_msgs/String'],
      });
    });
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes('1024px'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('opens the grid workspace and adds each workspace panel type', async () => {
    renderMainControlView();

    await screen.findByTestId('camera-view');
    fireEvent.click(screen.getByLabelText('Open grid workspace'));

    expect(screen.getByLabelText('Desktop workspace')).toBeInTheDocument();
    expect(screen.getByTitle('Unsaved workspace layout')).toHaveTextContent('Unsaved layout');
    expect(screen.getByLabelText('View component')).toBeInTheDocument();
    expect(screen.getByLabelText('Pad controls component')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Add workspace panel'));
    fireEvent.click(screen.getByText('Camera'));
    expect(await screen.findByLabelText('Camera')).toBeInTheDocument();
    expect(screen.getAllByTestId('camera-view')).toHaveLength(2);

    fireEvent.click(screen.getByLabelText('Add workspace panel'));
    fireEvent.click(screen.getByText('3D panel'));
    expect(await screen.findByLabelText('3D view')).toBeInTheDocument();
    expect(screen.getByTestId('visualization-panel')).toHaveTextContent('roboboy_3d_visualization_state_');

    fireEvent.click(screen.getByLabelText('Add workspace panel'));
    fireEvent.click(screen.getByText('Behavior tree'));
    expect(await screen.findByLabelText('Behavior tree')).toBeInTheDocument();
    expect(screen.getByTestId('behavior-tree-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Add workspace panel'));
    fireEvent.click(screen.getByRole('button', { name: 'Pad controls' }));
    expect(await screen.findByLabelText('Pad controls')).toBeInTheDocument();
    expect(screen.getByTestId('custom-gamepad')).toHaveTextContent('custom-drive');
  });

  it('saves, loads, deletes, imports, and exports workspace layouts', async () => {
    const savedLayout = {
      id: 'layout-one',
      title: 'Inspection layout',
      panels: [makePanel('panel-camera', 'camera', 'Camera')],
      tileOrder: ['base-view', 'panel-camera', 'base-pads'],
      layout: { rowSizes: [2, 1], rowRatios: [1, 1], columnRatiosByRow: { 0: [1, 1], 1: [1] } },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    localStorage.setItem(workspaceOpenKey, 'true');
    localStorage.setItem(workspaceSavedLayoutsKey, JSON.stringify([savedLayout]));
    localStorage.setItem(workspaceActiveLayoutKey, 'layout-one');
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:workspace');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderMainControlView();

    await screen.findByLabelText('Desktop workspace');
    fireEvent.click(screen.getByLabelText('Manage workspace layouts'));

    expect(screen.getByLabelText('Load Inspection layout')).toBeInTheDocument();
    expect(screen.getByText('Edited')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Layout name'), { target: { value: 'Updated layout' } });
    fireEvent.click(screen.getByLabelText('Update current layout'));
    expect(screen.getAllByText('Updated layout')[0]).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Layout name'), { target: { value: 'Copy layout' } });
    fireEvent.click(screen.getByLabelText('Save as new layout'));
    expect(screen.getAllByText('Copy layout')[0]).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Export layouts'));
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:workspace');

    const imported = {
      ...savedLayout,
      id: 'imported',
      title: 'Imported layout',
    };
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(fileInput, {
      target: {
        files: [new File([JSON.stringify({ layouts: [imported] })], 'layouts.json', { type: 'application/json' })],
      },
    });
    expect(await screen.findByLabelText('Load Imported layout')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Delete Updated layout'));
    expect(screen.queryByLabelText('Load Updated layout')).not.toBeInTheDocument();

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    clickSpy.mockRestore();
  });

  it('loads persisted workspace panels, removes tiles, and returns to split view', async () => {
    localStorage.setItem(workspaceOpenKey, 'true');
    localStorage.setItem(workspacePanelsKey, JSON.stringify([
      makePanel('panel-camera', 'camera', 'Camera'),
      makePanel('panel-pad', 'pad', 'Pad controls'),
      { bad: 'panel' },
    ]));
    localStorage.setItem(workspaceTileOrderKey, JSON.stringify(['base-view', 'panel-camera', 'panel-pad', 'base-pads']));
    localStorage.setItem(workspaceLayoutKey, JSON.stringify({ rowSizes: [2, 2], rowRatios: [2, 1], columnRatiosByRow: { 0: [2, 1], 1: [1, 1] } }));
    localStorage.setItem(customTemplatesKey, JSON.stringify([
      { id: 'custom-layout', title: 'Custom snap', rowSizes: [2], rowRatios: [1], columnRatiosByRow: { 0: [1, 1] } },
      { id: 'bad-layout', title: 'Bad', rowSizes: [] },
    ]));

    renderMainControlView();

    await screen.findByLabelText('Desktop workspace');
    expect(screen.getByLabelText('Camera')).toBeInTheDocument();
    expect(screen.getByLabelText('Pad controls')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Remove Camera'));
    await waitFor(() => {
      expect(screen.queryByLabelText('Camera')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Remove view tile'));
    expect(screen.queryByLabelText('View component')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Return to split view'));
    expect(screen.getByLabelText('Open grid workspace')).toBeInTheDocument();
    expect(screen.queryByLabelText('Desktop workspace')).not.toBeInTheDocument();
  });

  it('opens standard pad flows and stops running behavior trees', async () => {
    renderMainControlView();

    await screen.findByTestId('camera-view');
    fireEvent.click(screen.getByLabelText('Add Panel'));
    expect(screen.getByTestId('add-panel-menu')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Add custom drive'));
    expect(screen.getByRole('tab', { name: /Drive Pad/ })).toBeInTheDocument();
    expect(screen.getByTestId('custom-gamepad')).toHaveTextContent('custom-drive');

    fireEvent.click(screen.getByLabelText('Add Panel'));
    fireEvent.click(screen.getByText('Open template'));
    expect(screen.getByTestId('gamepad-editor')).toHaveTextContent('Template Copy');
    fireEvent.click(screen.getByText('Save pad'));
    expect(saveGamepadFromEditor).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Switch to Behavior Tree'));
    fireEvent.click(await screen.findByText('Start mocked tree'));
    expect(await screen.findByText('Move arm')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Stop behavior tree'));
    expect(stopBehaviorTree).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Disconnect'));
    expect(stopBehaviorTree).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });

  it('renders connection placeholders and handles topic fetch failures', async () => {
    getTopics.mockImplementation((_success: any, failure: any) => failure(new Error('no rosapi')));
    renderMainControlView();

    await waitFor(() => {
      expect(screen.getByText('No camera topics found')).toBeInTheDocument();
    });
  });
});
