import React, { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('../features/tfTree/components/TfTreePanel', () => ({
  default: ({ isActive }: any) => (
    <div data-testid="tf-tree-panel">{isActive ? 'active tf tree' : 'inactive tf tree'}</div>
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
  default: function MockBehaviorTreePanel({ onExecutionChange, onExecutionControlsChange, isActive }: any) {
    const [localState, setLocalState] = useState('Initial tree state');

    useEffect(() => {
      onExecutionControlsChange?.({
        stop: () => {
          stopBehaviorTree();
          onExecutionChange?.({ isExecuting: false, treeName: '' });
        },
      });
    }, []);

    return (
      <div data-testid="behavior-tree-panel">
        <span>{isActive ? 'active behavior tree' : 'inactive behavior tree'}</span>
        <label>
          Tree state
          <input
            aria-label="Behavior tree local state"
            value={localState}
            onChange={(event) => setLocalState(event.target.value)}
          />
        </label>
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
const mobileWorkspacePanelsKey = 'robo-boy-mobile-workspace-panels-v1';
const mobileSplitViewKey = 'robo-boy-mobile-split-view-v1';
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
    const firstRender = renderMainControlView();

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

  it('uses persistent single and split panels directly in the mobile view', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    localStorage.setItem(mobileWorkspacePanelsKey, JSON.stringify([
      makePanel('persisted-camera', 'camera', 'Camera'),
      makePanel('persisted-pad', 'pad', 'Pad controls'),
      makePanel('ignored-third', 'behaviorTree', 'Behavior tree'),
    ]));
    loadGamepadLibrary.mockReturnValue([
      { id: 'custom-drive', name: 'Drive Pad', layout: { id: 'custom-drive' }, isDefault: false },
      { id: 'custom-arm', name: 'Arm Pad', layout: { id: 'custom-arm' }, isDefault: false },
    ]);
    getTopics.mockImplementation((success: any) => {
      success({
        topics: ['/camera/image_raw', '/camera/alternate'],
        types: ['sensor_msgs/Image', 'sensor_msgs/Image'],
      });
    });

    const firstRender = renderMainControlView();

    await screen.findByTestId('camera-view');
    expect(screen.getByLabelText('Mobile panels')).toBeInTheDocument();
    expect(screen.getByLabelText('Top mobile window')).toBeInTheDocument();
    expect(screen.queryByLabelText('Bottom mobile window')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Camera topic'), {
      target: { value: '/camera/alternate' },
    });

    fireEvent.click(screen.getByLabelText('Switch to 3D View'));
    expect(screen.getByTestId('visualization-panel')).toHaveTextContent('roboboy_3d_visualization_state_');
    fireEvent.click(screen.getByLabelText('Switch to Camera View'));
    expect(screen.getByLabelText('Camera topic')).toHaveValue('/camera/alternate');
    fireEvent.click(screen.getByLabelText('Switch to 3D View'));

    fireEvent.click(screen.getByLabelText('Split mobile view'));
    expect(screen.getAllByLabelText(/mobile window$/i)).toHaveLength(2);
    fireEvent.click(screen.getByLabelText('Select bottom window'));
    fireEvent.change(screen.getByLabelText('Pad layout'), {
      target: { value: 'custom-arm' },
    });
    fireEvent.click(screen.getByLabelText('Switch to Behavior Tree'));
    expect(screen.getByTestId('behavior-tree-panel')).toHaveTextContent('active behavior tree');
    fireEvent.change(screen.getByLabelText('Behavior tree local state'), {
      target: { value: 'Edited tree state' },
    });
    fireEvent.click(screen.getByText('Start mocked tree'));
    expect(screen.getByText('Move arm')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Switch to TF Tree'));
    expect(screen.getByText('Move arm')).toBeInTheDocument();
    expect(screen.getByTestId('behavior-tree-panel')).toHaveTextContent('inactive behavior tree');
    expect(screen.getByTestId('tf-tree-panel')).toHaveTextContent('active tf tree');
    fireEvent.click(screen.getByLabelText('Open behavior tree'));
    expect(screen.getByLabelText('Behavior tree local state')).toHaveValue('Edited tree state');
    expect(screen.getByTestId('behavior-tree-panel')).toHaveTextContent('active behavior tree');
    fireEvent.click(screen.getByLabelText('Stop behavior tree'));
    fireEvent.click(screen.getByLabelText('Switch to Pad controls'));
    expect(screen.getByLabelText('Pad layout')).toHaveValue('custom-arm');
    fireEvent.click(screen.getByLabelText('Switch to Behavior Tree'));

    fireEvent.click(screen.getByLabelText('Swap mobile windows'));
    expect(screen.getByLabelText('Select top window')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Switch to Behavior Tree')).toHaveClass('active');
    expect(localStorage.getItem(mobileSplitViewKey)).toBe('true');

    fireEvent.click(screen.getByLabelText('Use one mobile panel'));
    expect(screen.getByLabelText('Bottom mobile window')).not.toBeVisible();
    expect(screen.getByTestId('behavior-tree-panel')).toHaveTextContent('active behavior tree');
    expect(localStorage.getItem(mobileSplitViewKey)).toBe('false');

    firstRender.unmount();
    renderMainControlView();
    expect(screen.queryByLabelText('Bottom mobile window')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Switch to Behavior Tree')).toHaveClass('active');
  });

  it('retains the standard behavior tree when a running desktop session becomes mobile', async () => {
    let mediaChangeListener: ((event: { matches: boolean }) => void) | undefined;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes('1024px'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((_event: string, listener: (event: { matches: boolean }) => void) => {
          mediaChangeListener = listener;
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    renderMainControlView();
    await screen.findByTestId('camera-view');
    fireEvent.click(screen.getByLabelText('Switch to Behavior Tree'));
    fireEvent.change(screen.getByLabelText('Behavior tree local state'), {
      target: { value: 'Desktop tree state' },
    });
    fireEvent.click(screen.getByText('Start mocked tree'));
    fireEvent.click(screen.getByLabelText('Switch to 3D View'));

    act(() => mediaChangeListener?.({ matches: false }));
    expect(screen.getByLabelText('Open behavior tree')).toBeInTheDocument();
    expect(screen.queryByLabelText('Split mobile view')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Open behavior tree'));
    expect(screen.getByLabelText('Behavior tree local state')).toHaveValue('Desktop tree state');

    fireEvent.click(screen.getByLabelText('Switch to 3D View'));
    fireEvent.click(screen.getByLabelText('Stop behavior tree'));
    expect(screen.queryByLabelText('Split mobile view')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Switch to Behavior Tree'));
    expect(screen.getByLabelText('Behavior tree local state')).toHaveValue('Desktop tree state');

    act(() => mediaChangeListener?.({ matches: true }));
    expect(screen.getByLabelText('Open grid workspace')).toBeInTheDocument();
  });

  it('falls back safely when persisted mobile panels are malformed', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(mobileWorkspacePanelsKey, '{malformed');
    localStorage.setItem(mobileSplitViewKey, 'true');

    renderMainControlView();

    expect(await screen.findByLabelText('Top mobile window')).toBeInTheDocument();
    expect(screen.getByLabelText('Bottom mobile window')).toBeInTheDocument();
    expect(screen.getByTestId('camera-view')).toBeVisible();
    expect(screen.getByTestId('custom-gamepad')).toBeVisible();
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to load mobile workspace panels:',
      expect.any(SyntaxError)
    );
    consoleError.mockRestore();
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
