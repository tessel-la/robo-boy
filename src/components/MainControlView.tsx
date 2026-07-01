import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ConnectionParams } from '../App'; // Import types
import { useRos } from '../hooks/useRos'; // Import the hook
import { useResizablePanels } from '../hooks/useResizablePanels'; // Import the resizable panels hook
import './MainControlView.css';
// Import placeholder components (we'll create these next)
import CameraView from './CameraView'; // Import the new CameraView
import VisualizationPanel from './VisualizationPanel'; // Import the new VisualizationPanel
import CustomGamepadWrapper from './gamepads/custom/CustomGamepadWrapper'; // Import the custom gamepad wrapper
import { generateUniqueId } from '../utils/helpers'; // Assuming a helper exists
import ControlPanelTabs from './ControlPanelTabs'; // Import the new tabs component
import AddPanelMenu from './AddPanelMenu'; // Import the AddPanelMenu component
import { GamepadType } from './gamepads/GamepadInterface';
import GamepadEditor from '../features/customGamepad/components/GamepadEditor';
import { CustomGamepadLayout } from '../features/customGamepad/types';
import {
  cloneGamepadTemplate,
  getGamepadLayout,
  importGamepadLayouts,
  loadGamepadLibrary,
} from '../features/customGamepad/gamepadStorage';
import { applySavedGamepadToPanels, GamepadSaveMode } from '../features/customGamepad/gamepadPanelState';
import BehaviorTreePanel, {
  BehaviorTreeExecutionControls,
  BehaviorTreeExecutionSnapshot,
} from '../features/behaviorTree/components/BehaviorTreePanel';
import TfTreePanel from '../features/tfTree/components/TfTreePanel';
import anime from 'animejs';

// --- Top Bar Icons ---
const IconMCVCamera = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
    <circle cx="12" cy="13" r="3.5"/>
    <circle cx="18.5" cy="10.5" r="1" fill="currentColor" stroke="none"/>
  </svg>
);
const IconMCV3d = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
    <path d="M2 7v10l10 5V12"/>
    <path d="M22 7v10l-10 5"/>
  </svg>
);
const IconMCVBT = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="4.5" rx="1.2"/>
    <line x1="12" y1="6.5" x2="12" y2="10"/>
    <line x1="4" y1="10" x2="20" y2="10"/>
    <line x1="4" y1="10" x2="4" y2="14"/>
    <line x1="20" y1="10" x2="20" y2="14"/>
    <rect x="1" y="14" width="6" height="4.5" rx="1.2"/>
    <rect x="17" y="14" width="6" height="4.5" rx="1.2"/>
  </svg>
);
const IconMCVTF = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="18" r="1.6" fill="currentColor" stroke="none"/>
    <path d="M6 18h14M16.5 14.5 20 18l-3.5 3.5"/>
    <path d="M6 18V4M2.5 7.5 6 4l3.5 3.5"/>
    <path d="m7.2 16.8 7.6-7.6M10.8 9.2h4v4" opacity=".72"/>
  </svg>
);
const IconMCVLink = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M16.9 16.9l1.4 1.4M5.6 18.4l1.4-1.4M16.9 7.1l1.4-1.4"/>
  </svg>
);
const IconMCVUnlink = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" strokeDasharray="4 2"/>
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>
  </svg>
);
const IconMCVDisconnect = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12"/>
  </svg>
);
const IconMCVStop = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <rect x="7" y="7" width="10" height="10" rx="2"/>
  </svg>
);
const IconMCVAdd = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14"/>
  </svg>
);
const IconMCVEdit = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>
  </svg>
);
const IconMCVTrash = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>
  </svg>
);
const IconMCVGrip = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="9" cy="9" r="1.4"/>
    <circle cx="15" cy="9" r="1.4"/>
    <circle cx="9" cy="15" r="1.4"/>
    <circle cx="15" cy="15" r="1.4"/>
  </svg>
);
const IconMCVTile = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="8" height="8" rx="1.5"/>
    <rect x="13" y="3" width="8" height="8" rx="1.5"/>
    <rect x="3" y="13" width="8" height="8" rx="1.5"/>
    <rect x="13" y="13" width="8" height="8" rx="1.5"/>
  </svg>
);
const IconMCVSplit = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="8" rx="1.5"/>
    <rect x="4" y="14" width="16" height="6" rx="1.5"/>
  </svg>
);
const IconMCVSwap = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 7h11l-3-3M18 7l-3 3"/>
    <path d="M17 17H6l3 3M6 17l3-3"/>
  </svg>
);
const IconMCVReplacePanel = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2.5"/>
    <path d="M8 9h7.5l-2-2"/>
    <path d="m15.5 9-2 2"/>
    <path d="M16 15H8.5l2 2"/>
    <path d="m8.5 15 2-2"/>
  </svg>
);
const IconMCVSaveLayout = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 4h11l3 3v13H5z"/>
    <path d="M8 4v6h8V4"/>
    <path d="M8 16h8"/>
  </svg>
);
const IconMCVDownload = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12"/>
    <path d="m7 10 5 5 5-5"/>
    <path d="M5 21h14"/>
  </svg>
);
const IconMCVUpload = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21V9"/>
    <path d="m7 14 5-5 5 5"/>
    <path d="M5 3h14"/>
  </svg>
);
// --- End Top Bar Icons ---

// Use Icon components
const icons = {
  camera: <IconMCVCamera />,
  view3d: <IconMCV3d />,
  bt: <IconMCVBT />,
  tf: <IconMCVTF />,
  connected: <IconMCVLink />,
  disconnected: <IconMCVUnlink />,
  disconnect: <IconMCVDisconnect />,
  stop: <IconMCVStop />,
  add: <IconMCVAdd />,
  edit: <IconMCVEdit />,
  trash: <IconMCVTrash />,
  grip: <IconMCVGrip />,
  tile: <IconMCVTile />,
  split: <IconMCVSplit />,
  swap: <IconMCVSwap />,
  replacePanel: <IconMCVReplacePanel />,
  saveLayout: <IconMCVSaveLayout />,
  download: <IconMCVDownload />,
  upload: <IconMCVUpload />,
};

// Define Panel Types
export type PanelType = GamepadType; // Now using the enum
export interface ActivePanel {
  id: string;
  type: PanelType;
  name: string; // Display name for the tab
  layoutId?: string; // For custom gamepads
}

interface MainControlViewProps {
  connectionParams: ConnectionParams;
  onDisconnect: () => void;
}

type ViewMode = 'camera' | '3d' | 'tfTree' | 'behaviorTree';
type WorkspacePanelType = 'camera' | '3d' | 'pad' | 'tfTree' | 'behaviorTree';
type GamepadEditorSession = {
  mode: GamepadSaveMode;
  initialLayout: CustomGamepadLayout | null;
};

interface WorkspacePanel {
  id: string;
  type: WorkspacePanelType;
  title: string;
  cameraTopic?: string;
  layoutId?: string;
}

type WorkspaceTile =
  | { kind: 'view'; id: 'base-view' }
  | { kind: 'pads'; id: 'base-pads' }
  | { kind: 'panel'; id: string; panel: WorkspacePanel };

const WORKSPACE_PANELS_KEY = 'robo-boy-desktop-workspace-panels-v1';
const WORKSPACE_LAYOUT_KEY = 'robo-boy-desktop-workspace-layout-v1';
const WORKSPACE_TILE_ORDER_KEY = 'robo-boy-desktop-workspace-tile-order-v1';
const WORKSPACE_CUSTOM_TEMPLATES_KEY = 'robo-boy-desktop-workspace-custom-templates-v1';
const WORKSPACE_SAVED_LAYOUTS_KEY = 'robo-boy-desktop-workspace-saved-layouts-v1';
const WORKSPACE_ACTIVE_LAYOUT_KEY = 'robo-boy-desktop-workspace-active-layout-v1';
const WORKSPACE_OPEN_KEY = 'robo-boy-desktop-workspace-open-v1';
const MOBILE_WORKSPACE_PANELS_KEY = 'robo-boy-mobile-workspace-panels-v1';
const MOBILE_SPLIT_VIEW_KEY = 'robo-boy-mobile-split-view-v1';
const DESKTOP_WORKSPACE_QUERY = '(min-width: 1024px)';
const WORKSPACE_DRAG_FORMAT = 'application/x-robo-boy-workspace-panel';
const WORKSPACE_TILE_DRAG_FORMAT = 'application/x-robo-boy-workspace-tile';
const MIN_WORKSPACE_TILE_RATIO = 0.24;

type WorkspaceDraft = {
  type: WorkspacePanelType;
};

type WorkspaceSnapTarget = {
  templateId: string;
  zoneIndex: number;
};

type WorkspaceDropPlacement =
  | { mode: 'column'; targetTileId: string; edge: 'before' | 'after' }
  | { mode: 'row'; targetTileId: string; edge: 'before' | 'after' }
  | { mode: 'end' };

type WorkspaceInteraction =
  | {
    mode: 'row';
    index: number;
    startClientX: number;
    startClientY: number;
    containerSize: number;
    startRatios: number[];
  }
  | {
    mode: 'column';
    rowIndex: number;
    index: number;
    startClientX: number;
    startClientY: number;
    containerSize: number;
    startRatios: number[];
  };

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};

const getWorkspaceTitle = (type: WorkspacePanelType) => {
  if (type === 'camera') return 'Camera';
  if (type === '3d') return '3D view';
  if (type === 'tfTree') return 'TF tree';
  if (type === 'behaviorTree') return 'Behavior tree';
  return 'Pad controls';
};

const createWorkspacePanel = (
  draft: WorkspaceDraft,
  options: {
    cameraTopic?: string;
    layoutId?: string;
  }
): WorkspacePanel => {
  return {
    id: generateUniqueId('workspace-panel'),
    title: getWorkspaceTitle(draft.type),
    type: draft.type,
    cameraTopic: draft.type === 'camera' ? options.cameraTopic : undefined,
    layoutId: draft.type === 'pad' ? options.layoutId : undefined,
  };
};

const normalizeWorkspacePanel = (panel: unknown): WorkspacePanel | null => {
  if (!panel || typeof panel !== 'object') return null;
  const candidate = panel as Partial<WorkspacePanel>;
  if (
    typeof candidate.id !== 'string' ||
    !['camera', '3d', 'pad', 'tfTree', 'behaviorTree'].includes(candidate.type || '') ||
    typeof candidate.title !== 'string'
  ) {
    return null;
  }

  return {
    id: candidate.id,
    type: candidate.type as WorkspacePanelType,
    title: candidate.type === 'pad' ? getWorkspaceTitle('pad') : candidate.title,
    cameraTopic: candidate.cameraTopic,
    layoutId: candidate.layoutId,
  };
};

const createDefaultMobileWorkspacePanels = (): WorkspacePanel[] => [
  {
    id: 'mobile-window-primary',
    type: 'camera',
    title: getWorkspaceTitle('camera'),
  },
  {
    id: 'mobile-window-secondary',
    type: 'pad',
    title: getWorkspaceTitle('pad'),
  },
];

const loadMobileWorkspacePanels = (): WorkspacePanel[] => {
  const defaults = createDefaultMobileWorkspacePanels();

  try {
    const stored = localStorage.getItem(MOBILE_WORKSPACE_PANELS_KEY);
    if (!stored) return defaults;

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return defaults;

    return defaults.map((fallback, index) => {
      const panel = normalizeWorkspacePanel(parsed[index]);
      return panel ? { ...panel, id: fallback.id, title: getWorkspaceTitle(panel.type) } : fallback;
    });
  } catch (error) {
    console.error('Failed to load mobile workspace panels:', error);
    return defaults;
  }
};

const loadMobileSplitViewPreference = (): boolean => {
  try {
    return localStorage.getItem(MOBILE_SPLIT_VIEW_KEY) === 'true';
  } catch (error) {
    console.error('Failed to load mobile split view preference:', error);
    return false;
  }
};

const isWorkspacePanel = (panel: unknown): panel is WorkspacePanel => {
  return normalizeWorkspacePanel(panel) !== null;
};

const loadWorkspacePanels = (): WorkspacePanel[] => {
  try {
    const stored = localStorage.getItem(WORKSPACE_PANELS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.map(panel => normalizeWorkspacePanel(panel)).filter(isWorkspacePanel)
      : [];
  } catch (error) {
    console.error('Failed to load desktop workspace panels:', error);
    return [];
  }
};

const loadUnifiedWorkspacePanels = (): WorkspacePanel[] => {
  const desktopPanels = loadWorkspacePanels();
  if (desktopPanels.length > 0) return desktopPanels;

  try {
    const stored = localStorage.getItem(MOBILE_WORKSPACE_PANELS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(panel => normalizeWorkspacePanel(panel))
      .filter(isWorkspacePanel)
      .map(panel => ({ ...panel, id: generateUniqueId('workspace-panel') }));
  } catch (error) {
    console.error('Failed to migrate mobile workspace panels:', error);
    return [];
  }
};

type WorkspaceLayoutState = {
  rowRatios: number[];
  columnRatiosByRow: Record<number, number[]>;
  rowSizes?: number[];
};

type SavedWorkspaceLayout = {
  id: string;
  title: string;
  panels: WorkspacePanel[];
  tileOrder: string[];
  layout: WorkspaceLayoutState;
  createdAt: string;
  updatedAt: string;
};

type WorkspaceBundleV2 = {
  version: 2;
  exportedAt: string;
  currentWorkspace: Omit<SavedWorkspaceLayout, 'id' | 'title' | 'createdAt' | 'updatedAt'>;
  layouts: SavedWorkspaceLayout[];
  gamepads: CustomGamepadLayout[];
};

type WorkspaceSnapTemplate = {
  id: string;
  title: string;
  rowSizes: number[];
  rowRatios?: number[];
  columnRatiosByRow?: Record<number, number[]>;
  isCustom?: boolean;
};

const normalizeRatios = (ratios: unknown, length: number): number[] => {
  if (length <= 0) return [];
  if (!Array.isArray(ratios) || ratios.length !== length) {
    return Array.from({ length }, () => 1);
  }

  const numericRatios = ratios.map(value => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
  ));
  const minRatio = MIN_WORKSPACE_TILE_RATIO;
  const clampedRatios = numericRatios.map(value => Math.max(minRatio, value));
  const total = clampedRatios.reduce((sum, value) => sum + value, 0);
  return total > 0 ? clampedRatios.map(value => value / total) : Array.from({ length }, () => 1);
};

const loadWorkspaceLayout = (): WorkspaceLayoutState => {
  try {
    const stored = localStorage.getItem(WORKSPACE_LAYOUT_KEY);
    if (!stored) return { rowRatios: [], columnRatiosByRow: {} };

    const parsed = JSON.parse(stored) as Partial<WorkspaceLayoutState>;
    return {
      rowRatios: Array.isArray(parsed.rowRatios) ? parsed.rowRatios : [],
      columnRatiosByRow: parsed.columnRatiosByRow && typeof parsed.columnRatiosByRow === 'object'
        ? parsed.columnRatiosByRow
        : {},
      rowSizes: Array.isArray(parsed.rowSizes)
        ? parsed.rowSizes.filter(value => Number.isInteger(value) && value > 0)
        : undefined,
    };
  } catch (error) {
    console.error('Failed to load desktop workspace layout:', error);
    return { rowRatios: [], columnRatiosByRow: {} };
  }
};

const normalizeWorkspaceLayoutState = (layout: unknown): WorkspaceLayoutState => {
  if (!layout || typeof layout !== 'object') {
    return { rowRatios: [], columnRatiosByRow: {} };
  }

  const candidate = layout as Partial<WorkspaceLayoutState>;
  return {
    rowRatios: Array.isArray(candidate.rowRatios)
      ? candidate.rowRatios.filter(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
      : [],
    columnRatiosByRow: candidate.columnRatiosByRow && typeof candidate.columnRatiosByRow === 'object'
      ? Object.entries(candidate.columnRatiosByRow).reduce<Record<number, number[]>>((ratiosByRow, [key, value]) => {
        if (Array.isArray(value)) {
          const numericRatios = value.filter(item => typeof item === 'number' && Number.isFinite(item) && item > 0);
          if (numericRatios.length > 0) ratiosByRow[Number(key)] = numericRatios;
        }
        return ratiosByRow;
      }, {})
      : {},
    rowSizes: Array.isArray(candidate.rowSizes)
      ? candidate.rowSizes.filter(value => Number.isInteger(value) && value > 0)
      : undefined,
  };
};

const normalizeSavedWorkspaceLayout = (layout: unknown): SavedWorkspaceLayout | null => {
  if (!layout || typeof layout !== 'object') return null;
  const candidate = layout as Partial<SavedWorkspaceLayout>;
  if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string') return null;

  const panels = Array.isArray(candidate.panels)
    ? candidate.panels.map(panel => normalizeWorkspacePanel(panel)).filter(isWorkspacePanel)
    : [];
  const tileOrder = normalizeWorkspaceTileOrder(
    Array.isArray(candidate.tileOrder)
      ? candidate.tileOrder.filter(item => typeof item === 'string')
      : BASE_WORKSPACE_TILE_IDS,
    panels.map(panel => panel.id)
  );

  return {
    id: candidate.id,
    title: candidate.title.trim() || 'Workspace layout',
    panels,
    tileOrder,
    layout: normalizeWorkspaceLayoutState(candidate.layout),
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
  };
};

const loadSavedWorkspaceLayouts = (): SavedWorkspaceLayout[] => {
  try {
    const stored = localStorage.getItem(WORKSPACE_SAVED_LAYOUTS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.map(layout => normalizeSavedWorkspaceLayout(layout)).filter((layout): layout is SavedWorkspaceLayout => layout !== null)
      : [];
  } catch (error) {
    console.error('Failed to load saved desktop workspace layouts:', error);
    return [];
  }
};

const loadActiveWorkspaceLayoutId = (): string | null => {
  try {
    const stored = localStorage.getItem(WORKSPACE_ACTIVE_LAYOUT_KEY);
    return stored || null;
  } catch (error) {
    console.error('Failed to load active desktop workspace layout:', error);
    return null;
  }
};

const loadWorkspaceOpenPreference = (): boolean => {
  try {
    return localStorage.getItem(WORKSPACE_OPEN_KEY) === 'true';
  } catch (error) {
    console.error('Failed to load desktop workspace open preference:', error);
    return false;
  }
};

const normalizeWorkspaceSnapTemplate = (template: unknown): WorkspaceSnapTemplate | null => {
  if (!template || typeof template !== 'object') return null;
  const candidate = template as Partial<WorkspaceSnapTemplate>;
  if (
    typeof candidate.id !== 'string' ||
    !candidate.id.startsWith('custom-') ||
    typeof candidate.title !== 'string' ||
    !Array.isArray(candidate.rowSizes) ||
    candidate.rowSizes.length === 0 ||
    !candidate.rowSizes.every(value => Number.isInteger(value) && value > 0)
  ) {
    return null;
  }

  const columnRatiosByRow = candidate.columnRatiosByRow && typeof candidate.columnRatiosByRow === 'object'
    ? Object.entries(candidate.columnRatiosByRow).reduce<Record<number, number[]>>((ratios, [key, value]) => {
      if (Array.isArray(value)) {
        const numericRatios = value.filter(item => typeof item === 'number' && Number.isFinite(item) && item > 0);
        if (numericRatios.length > 0) ratios[Number(key)] = numericRatios;
      }
      return ratios;
    }, {})
    : undefined;

  return {
    id: candidate.id,
    title: candidate.title.trim() || 'Custom layout',
    rowSizes: candidate.rowSizes,
    rowRatios: Array.isArray(candidate.rowRatios)
      ? candidate.rowRatios.filter(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
      : undefined,
    columnRatiosByRow,
    isCustom: true,
  };
};

const loadWorkspaceCustomTemplates = (): WorkspaceSnapTemplate[] => {
  try {
    const stored = localStorage.getItem(WORKSPACE_CUSTOM_TEMPLATES_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.map(template => normalizeWorkspaceSnapTemplate(template)).filter((template): template is WorkspaceSnapTemplate => template !== null)
      : [];
  } catch (error) {
    console.error('Failed to load workspace custom templates:', error);
    return [];
  }
};

const BASE_WORKSPACE_TILE_IDS: string[] = [];

const loadWorkspaceTileOrder = (): string[] => {
  try {
    const stored = localStorage.getItem(WORKSPACE_TILE_ORDER_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter(item => typeof item === 'string' && item !== 'base-view' && item !== 'base-pads')
      : [];
  } catch (error) {
    console.error('Failed to load desktop workspace tile order:', error);
    return [];
  }
};

const normalizeWorkspaceTileOrder = (order: string[], panelIds: string[]) => {
  const validIds = panelIds;
  const orderedIds = order.filter((id, index) => (
    validIds.includes(id) && order.indexOf(id) === index
  ));
  const missingPanelIds = panelIds.filter(id => !orderedIds.includes(id));
  return [...orderedIds, ...missingPanelIds];
};

const getWorkspaceColumnCount = (panelCount: number) => {
  if (panelCount <= 1) return 1;
  if (panelCount === 2) return 2;
  return Math.ceil(Math.sqrt(panelCount));
};

const buildWorkspaceRows = <T,>(items: T[], rowSizes?: number[]) => {
  if (
    rowSizes &&
    rowSizes.length > 0 &&
    rowSizes.every(size => Number.isInteger(size) && size > 0) &&
    rowSizes.reduce((total, size) => total + size, 0) === items.length
  ) {
    const rows: T[][] = [];
    let cursor = 0;
    rowSizes.forEach(size => {
      rows.push(items.slice(cursor, cursor + size));
      cursor += size;
    });
    return rows;
  }

  const columnCount = getWorkspaceColumnCount(items.length);
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += columnCount) {
    rows.push(items.slice(index, index + columnCount));
  }
  return rows;
};

const WORKSPACE_SNAP_TEMPLATES: WorkspaceSnapTemplate[] = [
  {
    id: 'split',
    title: 'Split',
    rowSizes: [2],
    columnRatiosByRow: { 0: [1, 1] },
  },
  {
    id: 'focus-left',
    title: 'Focus left',
    rowSizes: [2],
    columnRatiosByRow: { 0: [1.7, 1] },
  },
  {
    id: 'focus-right',
    title: 'Focus right',
    rowSizes: [2],
    columnRatiosByRow: { 0: [1, 1.7] },
  },
  {
    id: 'thirds',
    title: 'Thirds',
    rowSizes: [3],
    columnRatiosByRow: { 0: [1, 1, 1] },
  },
  {
    id: 'quad',
    title: 'Quad',
    rowSizes: [2, 2],
    rowRatios: [1, 1],
    columnRatiosByRow: { 0: [1, 1], 1: [1, 1] },
  },
  {
    id: 'stack-top',
    title: 'Top focus',
    rowSizes: [1, 2],
    rowRatios: [1.35, 1],
    columnRatiosByRow: { 0: [1], 1: [1, 1] },
  },
];

const getWorkspaceSnapTemplates = (tileCount: number, templates: WorkspaceSnapTemplate[]) => {
  return templates.filter(template => (
    template.rowSizes.reduce((total, size) => total + size, 0) <= tileCount
  ));
};

const getWorkspaceLayoutSignature = (
  panels: WorkspacePanel[],
  tileOrder: string[],
  layout: WorkspaceLayoutState
) => {
  const normalizedTileOrder = normalizeWorkspaceTileOrder(tileOrder, panels.map(panel => panel.id));
  const normalizedLayout = normalizeWorkspaceLayoutState(layout);
  const rowSizes = buildWorkspaceRows(normalizedTileOrder, normalizedLayout.rowSizes).map(row => row.length);
  const columnRatiosByRow = rowSizes.reduce<Record<number, number[]>>((ratiosByRow, rowSize, rowIndex) => {
    ratiosByRow[rowIndex] = normalizeRatios(normalizedLayout.columnRatiosByRow[rowIndex], rowSize);
    return ratiosByRow;
  }, {});

  return JSON.stringify({
    panels,
    tileOrder: normalizedTileOrder,
    layout: {
      rowSizes,
      rowRatios: normalizeRatios(normalizedLayout.rowRatios, rowSizes.length),
      columnRatiosByRow,
    },
  });
};

const createWorkspaceLayoutFromTemplate = (
  template: WorkspaceSnapTemplate,
  tileCount: number
): WorkspaceLayoutState => {
  const rowSizes = [...template.rowSizes];
  const templateCapacity = rowSizes.reduce((total, size) => total + size, 0);
  if (tileCount > templateCapacity && rowSizes.length > 0) {
    rowSizes[rowSizes.length - 1] += tileCount - templateCapacity;
  }

  const columnRatiosByRow = rowSizes.reduce<Record<number, number[]>>((ratiosByRow, rowSize, index) => {
    const templateRatios = template.columnRatiosByRow?.[index];
    ratiosByRow[index] = templateRatios
      ? [
        ...templateRatios.slice(0, rowSize),
        ...Array.from({ length: Math.max(0, rowSize - templateRatios.length) }, () => 1),
      ]
      : Array.from({ length: rowSize }, () => 1);
    return ratiosByRow;
  }, {});

  return {
    rowSizes,
    rowRatios: template.rowRatios?.length === rowSizes.length
      ? template.rowRatios
      : Array.from({ length: rowSizes.length }, () => 1),
    columnRatiosByRow,
  };
};

const createWorkspaceLayoutFromRows = (rows: string[][]): WorkspaceLayoutState => ({
  rowSizes: rows.map(row => row.length),
  rowRatios: Array.from({ length: rows.length }, () => 1),
  columnRatiosByRow: rows.reduce<Record<number, number[]>>((ratiosByRow, row, rowIndex) => {
    ratiosByRow[rowIndex] = Array.from({ length: row.length }, () => 1);
    return ratiosByRow;
  }, {}),
});

const applyWorkspaceDropPlacement = (
  currentOrder: string[],
  rowSizes: number[] | undefined,
  tileId: string,
  placement: WorkspaceDropPlacement,
  movedTileId?: string
) => {
  const sourceRows = buildWorkspaceRows(currentOrder, rowSizes).map(row => [...row]);
  const rows = sourceRows
    .map(row => row.filter(id => id !== movedTileId && id !== tileId))
    .filter(row => row.length > 0);

  if (placement.mode === 'end' || rows.length === 0) {
    rows.push([tileId]);
  } else {
    const targetRowIndex = rows.findIndex(row => row.includes(placement.targetTileId));
    if (targetRowIndex === -1) {
      rows.push([tileId]);
    } else if (placement.mode === 'row') {
      rows.splice(
        placement.edge === 'before' ? targetRowIndex : targetRowIndex + 1,
        0,
        [tileId]
      );
    } else {
      const targetColumnIndex = rows[targetRowIndex].indexOf(placement.targetTileId);
      rows[targetRowIndex].splice(
        placement.edge === 'before' ? targetColumnIndex : targetColumnIndex + 1,
        0,
        tileId
      );
    }
  }

  return {
    order: rows.flat(),
    layout: createWorkspaceLayoutFromRows(rows),
  };
};

const MainControlView: React.FC<MainControlViewProps> = ({ connectionParams, onDisconnect }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('camera');
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(loadWorkspaceOpenPreference);
  const [isMobileSplitView, setIsMobileSplitView] = useState(loadMobileSplitViewPreference);
  const [activeMobileWindowIndex, setActiveMobileWindowIndex] = useState(0);
  const [workspacePanels, setWorkspacePanels] = useState<WorkspacePanel[]>(loadUnifiedWorkspacePanels);
  const [mobileWorkspacePanels, setMobileWorkspacePanels] = useState<WorkspacePanel[]>(loadMobileWorkspacePanels);
  const [mountedMobilePanelTypes, setMountedMobilePanelTypes] = useState<Record<string, WorkspacePanelType[]>>(() => (
    mobileWorkspacePanels.reduce<Record<string, WorkspacePanelType[]>>((mountedTypes, panel) => {
      mountedTypes[panel.id] = [panel.type];
      return mountedTypes;
    }, {})
  ));
  const [mobileSecondaryEverMounted, setMobileSecondaryEverMounted] = useState(isMobileSplitView);
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayoutState>(loadWorkspaceLayout);
  const [workspaceTileOrder, setWorkspaceTileOrder] = useState<string[]>(loadWorkspaceTileOrder);
  const [customWorkspaceSnapTemplates, setCustomWorkspaceSnapTemplates] = useState<WorkspaceSnapTemplate[]>(loadWorkspaceCustomTemplates);
  const [savedWorkspaceLayouts, setSavedWorkspaceLayouts] = useState<SavedWorkspaceLayout[]>(loadSavedWorkspaceLayouts);
  const [activeWorkspaceLayoutId, setActiveWorkspaceLayoutId] = useState<string | null>(loadActiveWorkspaceLayoutId);
  const [isWorkspaceAddMenuOpen, setIsWorkspaceAddMenuOpen] = useState(false);
  const [workspaceReplacementPanelId, setWorkspaceReplacementPanelId] = useState<string | null>(null);
  const [workspaceReplaceMenuStyle, setWorkspaceReplaceMenuStyle] = useState<React.CSSProperties | null>(null);
  const [isWorkspaceTemplateMenuOpen, setIsWorkspaceTemplateMenuOpen] = useState(false);
  const [workspaceLayoutName, setWorkspaceLayoutName] = useState('');
  const [isWorkspaceDragActive, setIsWorkspaceDragActive] = useState(false);
  const [workspaceDragKind, setWorkspaceDragKind] = useState<'new' | 'move' | null>(null);
  const [workspaceSnapTarget, setWorkspaceSnapTarget] = useState<WorkspaceSnapTarget | null>(null);
  const [isWorkspaceResizing, setIsWorkspaceResizing] = useState(false);
  const [workspaceDropPlacement, setWorkspaceDropPlacement] = useState<WorkspaceDropPlacement | null>(null);
  const [lastAddedWorkspacePanelId, setLastAddedWorkspacePanelId] = useState<string | null>(null);
  const [isLargeScreen, setIsLargeScreen] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia(DESKTOP_WORKSPACE_QUERY).matches;
  });
  // Once BT panel mounts, keep it alive (preserves nodes/executor state)
  const [btEverMounted, setBtEverMounted] = useState(false);
  const [tfEverMounted, setTfEverMounted] = useState(false);
  const [btExecution, setBtExecution] = useState<BehaviorTreeExecutionSnapshot>({
    isExecuting: false,
    treeName: '',
  });
  const [isStandardBtExecuting, setIsStandardBtExecuting] = useState(false);
  const [retainStandardMobileLayout, setRetainStandardMobileLayout] = useState(false);
  const btExecutionControls = useRef<BehaviorTreeExecutionControls | null>(null);
  const { ros, isConnected, connect, disconnect } = useRos(); // Use the hook
  const [availableCameraTopics, setAvailableCameraTopics] = useState<string[]>([]);
  const [selectedCameraTopic, setSelectedCameraTopic] = useState<string>('');

  // --- New State for Modular Control Panels ---
  const [activePanels, setActivePanels] = useState<ActivePanel[]>([]);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [isAddPanelMenuOpen, setIsAddPanelMenuOpen] = useState(false);
  const [editorSession, setEditorSession] = useState<GamepadEditorSession | null>(null);
  const [workspacePadEditorTargetId, setWorkspacePadEditorTargetId] = useState<string | null>(null);
  // State to trigger refresh of custom gamepads in AddPanelMenu
  const [customGamepadRefreshKey, setCustomGamepadRefreshKey] = useState(0);
  const gamepadLibrary = useMemo(
    () => loadGamepadLibrary(),
    [customGamepadRefreshKey]
  );
  // Ref for the Add Panel button (+) 
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // --- End New State ---

  // Ref to prevent multiple connection attempts (kept for potential future use)
  const _isConnecting = useRef(false);

  const viewPanelRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const workspaceInteractionRef = useRef<WorkspaceInteraction | null>(null);
  const templateImportInputRef = useRef<HTMLInputElement>(null);
  const workspaceTemplateControlRef = useRef<HTMLDivElement>(null);
  const workspaceAddControlRef = useRef<HTMLDivElement>(null);
  const workspaceReplaceMenuRef = useRef<HTMLDivElement>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const isDesktopWorkspace = isLargeScreen;
  const useStandardMobileExecutionLayout = !isLargeScreen && (
    isStandardBtExecuting || retainStandardMobileLayout
  );
  const activeMobilePanel = mobileWorkspacePanels[isMobileSplitView ? activeMobileWindowIndex : 0];
  const normalizedWorkspaceTileOrder = useMemo(
    () => normalizeWorkspaceTileOrder(workspaceTileOrder, workspacePanels.map(panel => panel.id)),
    [workspacePanels, workspaceTileOrder]
  );
  const workspaceTiles = useMemo<WorkspaceTile[]>(() => {
    const panelById = new Map(workspacePanels.map(panel => [panel.id, panel]));
    return normalizedWorkspaceTileOrder.flatMap<WorkspaceTile>(id => {
      const panel = panelById.get(id);
      return panel ? [{ kind: 'panel' as const, id, panel }] : [];
    });
  }, [normalizedWorkspaceTileOrder, workspacePanels]);
  const workspaceRows = useMemo(
    () => buildWorkspaceRows(workspaceTiles, workspaceLayout.rowSizes),
    [workspaceLayout.rowSizes, workspaceTiles]
  );
  const workspaceRowRatios = useMemo(
    () => normalizeRatios(workspaceLayout.rowRatios, workspaceRows.length),
    [workspaceLayout.rowRatios, workspaceRows.length]
  );
  const workspaceColumnRatiosByRow = useMemo(() => (
    workspaceRows.map((row, rowIndex) => normalizeRatios(
      workspaceLayout.columnRatiosByRow[rowIndex],
      row.length
    ))
  ), [workspaceLayout.columnRatiosByRow, workspaceRows]);
  const capturedWorkspaceLayout = useMemo<WorkspaceLayoutState>(() => {
    const rowSizes = workspaceRows.map(row => row.length);
    const columnRatiosByRow = rowSizes.reduce<Record<number, number[]>>((ratiosByRow, rowSize, rowIndex) => {
      ratiosByRow[rowIndex] = workspaceColumnRatiosByRow[rowIndex]?.length === rowSize
        ? workspaceColumnRatiosByRow[rowIndex]
        : Array.from({ length: rowSize }, () => 1);
      return ratiosByRow;
    }, {});

    return {
      rowSizes,
      rowRatios: workspaceRowRatios.length === rowSizes.length
        ? workspaceRowRatios
        : Array.from({ length: rowSizes.length }, () => 1),
      columnRatiosByRow,
    };
  }, [workspaceColumnRatiosByRow, workspaceRowRatios, workspaceRows]);
  const activeWorkspaceLayout = useMemo(
    () => savedWorkspaceLayouts.find(layout => layout.id === activeWorkspaceLayoutId) || null,
    [activeWorkspaceLayoutId, savedWorkspaceLayouts]
  );
  const currentWorkspaceLayoutSignature = useMemo(
    () => getWorkspaceLayoutSignature(workspacePanels, normalizedWorkspaceTileOrder, capturedWorkspaceLayout),
    [capturedWorkspaceLayout, normalizedWorkspaceTileOrder, workspacePanels]
  );
  const activeWorkspaceLayoutSignature = useMemo(
    () => activeWorkspaceLayout
      ? getWorkspaceLayoutSignature(activeWorkspaceLayout.panels, activeWorkspaceLayout.tileOrder, activeWorkspaceLayout.layout)
      : null,
    [activeWorkspaceLayout]
  );
  const isActiveWorkspaceLayoutDirty = Boolean(
    activeWorkspaceLayout && activeWorkspaceLayoutSignature !== currentWorkspaceLayoutSignature
  );
  const getWorkspaceTileIndex = (rowIndex: number, columnIndex: number) => {
    return workspaceRows
      .slice(0, rowIndex)
      .reduce((total, row) => total + row.length, columnIndex);
  };
  const workspaceSnapTileCount = workspaceTiles.length + (workspaceDragKind === 'new' ? 1 : 0);
  const allWorkspaceSnapTemplates = useMemo(
    () => [...WORKSPACE_SNAP_TEMPLATES, ...customWorkspaceSnapTemplates],
    [customWorkspaceSnapTemplates]
  );
  const workspaceSnapTemplates = useMemo(
    () => getWorkspaceSnapTemplates(workspaceSnapTileCount, allWorkspaceSnapTemplates),
    [allWorkspaceSnapTemplates, workspaceSnapTileCount]
  );

  // Resizable panels hook
  const { topHeight, bottomHeight, handleMouseDown, handleTouchStart, containerRef, isDragging } = useResizablePanels({
    initialTopHeight: 60,
    minTopHeight: 20,
    minBottomHeight: 20,
    storageKey: 'robo-boy-panel-split',
  });

  useEffect(() => {
    localStorage.setItem(WORKSPACE_PANELS_KEY, JSON.stringify(workspacePanels));
  }, [workspacePanels]);

  useEffect(() => {
    localStorage.setItem(MOBILE_WORKSPACE_PANELS_KEY, JSON.stringify(mobileWorkspacePanels.slice(0, 2)));
  }, [mobileWorkspacePanels]);

  useEffect(() => {
    localStorage.setItem(MOBILE_SPLIT_VIEW_KEY, String(isMobileSplitView));
  }, [isMobileSplitView]);

  useEffect(() => {
    if (isLargeScreen) {
      setRetainStandardMobileLayout(false);
    } else if (isStandardBtExecuting) {
      setRetainStandardMobileLayout(true);
    }
  }, [isLargeScreen, isStandardBtExecuting]);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(workspaceLayout));
  }, [workspaceLayout]);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_OPEN_KEY, String(isWorkspaceOpen));
  }, [isWorkspaceOpen]);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_CUSTOM_TEMPLATES_KEY, JSON.stringify(customWorkspaceSnapTemplates));
  }, [customWorkspaceSnapTemplates]);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_SAVED_LAYOUTS_KEY, JSON.stringify(savedWorkspaceLayouts));
  }, [savedWorkspaceLayouts]);

  useEffect(() => {
    if (activeWorkspaceLayoutId) {
      localStorage.setItem(WORKSPACE_ACTIVE_LAYOUT_KEY, activeWorkspaceLayoutId);
    } else {
      localStorage.removeItem(WORKSPACE_ACTIVE_LAYOUT_KEY);
    }
  }, [activeWorkspaceLayoutId]);

  useEffect(() => {
    if (activeWorkspaceLayoutId && !savedWorkspaceLayouts.some(layout => layout.id === activeWorkspaceLayoutId)) {
      setActiveWorkspaceLayoutId(null);
    }
  }, [activeWorkspaceLayoutId, savedWorkspaceLayouts]);

  useEffect(() => {
    const normalizedOrder = normalizeWorkspaceTileOrder(
      workspaceTileOrder,
      workspacePanels.map(panel => panel.id)
    );
    if (normalizedOrder.join('|') !== workspaceTileOrder.join('|')) {
      setWorkspaceTileOrder(normalizedOrder);
      return;
    }
    localStorage.setItem(WORKSPACE_TILE_ORDER_KEY, JSON.stringify(normalizedOrder));
  }, [workspacePanels, workspaceTileOrder]);

  useEffect(() => {
    if (!window.matchMedia) return;

    const mediaQuery = window.matchMedia(DESKTOP_WORKSPACE_QUERY);
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setIsLargeScreen(event.matches);
    };

    setIsLargeScreen(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  useEffect(() => {
    if (!isWorkspaceTemplateMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        workspaceTemplateControlRef.current &&
        !workspaceTemplateControlRef.current.contains(target)
      ) {
        setIsWorkspaceTemplateMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isWorkspaceTemplateMenuOpen]);

  useEffect(() => {
    if (!isWorkspaceAddMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      const clickedToolbarMenu = target instanceof Node && Boolean(workspaceAddControlRef.current?.contains(target));
      const clickedReplaceMenu = target instanceof Node && Boolean(workspaceReplaceMenuRef.current?.contains(target));
      if (target instanceof Node && !clickedToolbarMenu && !clickedReplaceMenu) {
        setIsWorkspaceAddMenuOpen(false);
        setWorkspaceReplaceMenuStyle(null);
        if (workspaceReplacementPanelId) setWorkspaceReplacementPanelId(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isWorkspaceAddMenuOpen, workspaceReplacementPanelId]);

  useEffect(() => {
    if (!workspaceReplacementPanelId) return;

    const closeReplacementMenu = () => {
      setIsWorkspaceAddMenuOpen(false);
      setWorkspaceReplacementPanelId(null);
      setWorkspaceReplaceMenuStyle(null);
    };

    window.addEventListener('resize', closeReplacementMenu);
    window.addEventListener('scroll', closeReplacementMenu, true);
    return () => {
      window.removeEventListener('resize', closeReplacementMenu);
      window.removeEventListener('scroll', closeReplacementMenu, true);
    };
  }, [workspaceReplacementPanelId]);

  // Fetch topics when connected
  useEffect(() => {
    if (isConnected && ros) {
      console.log('Fetching ROS topics...');
      ros.getTopics(
        (response) => {
          console.log('Available topics:', response.topics);
          console.log('Corresponding types:', response.types);
          // Filter topics likely to be camera feeds based on type or name pattern
          // Note: Comparing types is more reliable but requires type info from getTopics.
          // ROS2 might require separate calls to get type info if not included in getTopics response.
          const imageTypes = ['sensor_msgs/Image', 'sensor_msgs/CompressedImage'];
          const potentialTopics = response.topics.filter((topic, index) => {
            const type = response.types[index];
            if (imageTypes.includes(type)) {
              return true;
            }
            // Fallback: Check for common naming patterns if type information is missing/incomplete
            return topic.includes('image_raw') || topic.includes('image_color') || topic.includes('image_compressed');
          });

          console.log('Found potential camera topics:', potentialTopics);
          setAvailableCameraTopics(potentialTopics);

          // Set default selection if available
          if (potentialTopics.length > 0 && !selectedCameraTopic) {
            // Try to find a common default or just take the first one
            const defaultTopic = potentialTopics.find(t => t.includes('/image_raw')) || potentialTopics[0];
            setSelectedCameraTopic(defaultTopic);
            console.log(`Default camera topic set to: ${defaultTopic}`);
          } else if (potentialTopics.length === 0) {
            console.warn('No potential camera topics found.');
            setSelectedCameraTopic(''); // Reset if no topics found
          }
        },
        (error) => {
          console.error('Failed to fetch ROS topics:', error);
          setAvailableCameraTopics([]);
          setSelectedCameraTopic('');
        }
      );
    } else {
      // Reset topics when disconnected
      setAvailableCameraTopics([]);
      setSelectedCameraTopic('');
    }
  }, [isConnected, ros]); // Re-run when connection status or ros instance changes

  // Connect on mount and disconnect on unmount or when connectionParams change
  useEffect(() => {
    if (connectionParams) {
      connect(connectionParams);
    }

    // Cleanup function for when the component unmounts or params change
    return () => {
      disconnect();
    };
    // Only re-run effect if connect/disconnect functions or connectionParams change
  }, [connect, disconnect, connectionParams]);

  // Lazy-mount BT panel on first visit; trigger 3D resize on switch
  useEffect(() => {
    if (viewMode === 'behaviorTree') setBtEverMounted(true);
    if (viewMode === 'tfTree') setTfEverMounted(true);
    if (viewMode === '3d') {
      // ResizeObserver needs a tick after display change to read correct dimensions
      const id = setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
      return () => clearTimeout(id);
    }
  }, [viewMode]);

  useEffect(() => {
    if (isLargeScreen) return;
    const hasVisible3dPanel = mobileWorkspacePanels[0]?.type === '3d' || (
      isMobileSplitView && mobileWorkspacePanels[1]?.type === '3d'
    );
    if (!hasVisible3dPanel) return;

    const id = setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    return () => clearTimeout(id);
  }, [isLargeScreen, isMobileSplitView, mobileWorkspacePanels]);

  const handleInternalDisconnect = () => {
    btExecutionControls.current?.stop();
    disconnect(); // Disconnect ROS
    onDisconnect(); // Call App's disconnect handler to go back to EntrySection
  };

  // --- Handlers for Modular Panels ---
  const handleSelectPanel = (id: string) => {
    setSelectedPanelId(id);
    setIsAddPanelMenuOpen(false); // Close menu when selecting existing panel
  };

  const handleAddPanelToggle = () => {
    setIsAddPanelMenuOpen(prev => !prev);
  };

  const handleAddCustomPanel = (layoutId: string) => {
    const gamepadItem = getGamepadLayout(layoutId);
    const existingPanel = activePanels.find(panel => panel.layoutId === layoutId);
    if (existingPanel) {
      setSelectedPanelId(existingPanel.id);
      setIsAddPanelMenuOpen(false);
      return;
    }

    const newPanel: ActivePanel = {
      id: generateUniqueId('panel'),
      type: GamepadType.Custom,
      name: gamepadItem?.name || 'Custom Gamepad',
      layoutId
    };
    setActivePanels(prev => [...prev, newPanel]);
    setSelectedPanelId(newPanel.id); // Select the newly added panel
    setIsAddPanelMenuOpen(false); // Close the menu
  };

  const handleRemovePanel = (idToRemove: string) => {
    setActivePanels(prev => {
      const newPanels = prev.filter(panel => panel.id !== idToRemove);
      // If the removed panel was selected, select the first remaining panel or null
      if (selectedPanelId === idToRemove) {
        setSelectedPanelId(newPanels.length > 0 ? newPanels[0].id : null);
      }
      return newPanels;
    });
    setIsAddPanelMenuOpen(false); // Close menu if open
  };

  const handleCloseMenu = () => {
    setIsAddPanelMenuOpen(false);
  };

  const handleOpenCustomEditor = (layoutId?: string) => {
    setEditorSession({
      mode: layoutId ? 'edit' : 'create',
      initialLayout: layoutId ? getGamepadLayout(layoutId)?.layout || null : null,
    });
    setIsAddPanelMenuOpen(false);
  };

  const handleOpenTemplate = (layoutId: string) => {
    const template = cloneGamepadTemplate(layoutId);
    if (!template) return;
    setEditorSession({ mode: 'template', initialLayout: template });
    setIsAddPanelMenuOpen(false);
  };

  const handleCloseCustomEditor = () => {
    setEditorSession(null);
    setWorkspacePadEditorTargetId(null);
  };

  const handleSaveCustomGamepad = (layout: CustomGamepadLayout) => {
    const mode = editorSession?.mode || 'create';
    setActivePanels(prev => {
      const result = applySavedGamepadToPanels({
        panels: prev,
        selectedPanelId,
        layout,
        mode,
        createPanel: savedLayout => ({
          id: generateUniqueId('panel'),
          type: GamepadType.Custom,
          name: savedLayout.name,
          layoutId: savedLayout.id,
        }),
      });
      setSelectedPanelId(result.selectedPanelId);
      return result.panels;
    });
    if (workspacePadEditorTargetId) {
      setWorkspacePanels(prev => prev.map(panel =>
        panel.id === workspacePadEditorTargetId ? { ...panel, layoutId: layout.id } : panel
      ));
      setMobileWorkspacePanels(prev => prev.map(panel =>
        panel.id === workspacePadEditorTargetId ? { ...panel, layoutId: layout.id } : panel
      ));
    }
    setIsAddPanelMenuOpen(false);
    setWorkspacePadEditorTargetId(null);
    // Trigger refresh of custom gamepad list in AddPanelMenu
    setCustomGamepadRefreshKey(prev => prev + 1);
  };

  const handleCustomGamepadDeleted = (layoutId: string) => {
    setActivePanels(prev => {
      const remainingPanels = prev.filter(panel => panel.layoutId !== layoutId);
      if (!remainingPanels.some(panel => panel.id === selectedPanelId)) {
        setSelectedPanelId(remainingPanels[0]?.id || null);
      }
      return remainingPanels;
    });
    // Trigger refresh of custom gamepad list in AddPanelMenu
    setCustomGamepadRefreshKey(prev => prev + 1);
  };
  // --- End Panel Handlers ---

  const resetWorkspaceLayout = () => {
    setWorkspaceLayout({ rowRatios: [], columnRatiosByRow: {} });
  };

  const handleAddWorkspacePanel = (
    type: WorkspacePanelType,
    insertIndex?: number,
    snapTemplate?: WorkspaceSnapTemplate
  ) => {
    setIsWorkspaceOpen(true);
    if (workspaceReplacementPanelId) {
      setWorkspacePanels(prev => prev.map(panel => panel.id === workspaceReplacementPanelId
        ? {
          ...panel,
          type,
          title: getWorkspaceTitle(type),
          cameraTopic: type === 'camera' ? (selectedCameraTopic || availableCameraTopics[0]) : undefined,
          layoutId: type === 'pad' ? gamepadLibrary[0]?.id : undefined,
        }
        : panel));
      setWorkspaceReplacementPanelId(null);
      setWorkspaceReplaceMenuStyle(null);
      setIsWorkspaceAddMenuOpen(false);
      setIsWorkspaceTemplateMenuOpen(false);
      return;
    }
    setWorkspacePanels(prev => {
      const selectedPadPanel = selectedPanelId
        ? activePanels.find(panel => panel.id === selectedPanelId)
        : null;
      const newPanel = createWorkspacePanel(
        { type },
        {
          cameraTopic: selectedCameraTopic || availableCameraTopics[0],
          layoutId: selectedPadPanel?.layoutId || gamepadLibrary[0]?.id,
        }
      );
      const nextPanels = [...prev];
      nextPanels.push(newPanel);
      setWorkspaceTileOrder(prevOrder => {
        const nextOrder = normalizeWorkspaceTileOrder(prevOrder, prev.map(panel => panel.id));
        nextOrder.splice(
          typeof insertIndex === 'number' ? clamp(insertIndex, 0, nextOrder.length) : nextOrder.length,
          0,
          newPanel.id
        );
        if (snapTemplate) {
          setWorkspaceLayout(createWorkspaceLayoutFromTemplate(snapTemplate, nextOrder.length));
        }
        return nextOrder;
      });
      setLastAddedWorkspacePanelId(newPanel.id);
      return nextPanels;
    });
    if (!snapTemplate) {
      resetWorkspaceLayout();
    }
    setIsWorkspaceAddMenuOpen(false);
    setIsWorkspaceTemplateMenuOpen(false);
    setWorkspaceReplaceMenuStyle(null);
  };

  const handleReturnToSplitView = () => {
    setIsWorkspaceOpen(false);
    setIsWorkspaceAddMenuOpen(false);
    setIsWorkspaceTemplateMenuOpen(false);
    setIsWorkspaceDragActive(false);
    setWorkspaceDragKind(null);
    setWorkspaceSnapTarget(null);
    setIsWorkspaceResizing(false);
    setWorkspaceDropPlacement(null);
  };

  const handleWorkspaceDragStart = (
    event: React.DragEvent<HTMLButtonElement>,
    type: WorkspacePanelType
  ) => {
    const payload: WorkspaceDraft = { type };
    event.dataTransfer.setData(WORKSPACE_DRAG_FORMAT, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'copy';
    setIsWorkspaceOpen(true);
    setIsWorkspaceDragActive(true);
    setWorkspaceDragKind('new');
  };

  const handleWorkspaceTileDragStart = (
    event: React.DragEvent<HTMLElement>,
    tileId: string
  ) => {
    event.dataTransfer.setData(WORKSPACE_TILE_DRAG_FORMAT, tileId);
    event.dataTransfer.effectAllowed = 'move';
    setIsWorkspaceDragActive(true);
    setWorkspaceDragKind('move');
  };

  const handleWorkspaceDragEnd = () => {
    setIsWorkspaceDragActive(false);
    setWorkspaceDragKind(null);
    setWorkspaceSnapTarget(null);
    setWorkspaceDropPlacement(null);
  };

  const handleWorkspaceDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (
      event.dataTransfer.types.includes(WORKSPACE_DRAG_FORMAT) ||
      event.dataTransfer.types.includes(WORKSPACE_TILE_DRAG_FORMAT)
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = event.dataTransfer.types.includes(WORKSPACE_TILE_DRAG_FORMAT) ? 'move' : 'copy';
      setWorkspaceSnapTarget(null);
      setWorkspaceDropPlacement(getWorkspaceDropPlacement(event.clientX, event.clientY));
    }
  };

  const handleWorkspaceDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setWorkspaceDropPlacement(null);
    setWorkspaceSnapTarget(null);
  };

  const getWorkspaceSnapTemplate = (templateId: string) => {
    return allWorkspaceSnapTemplates.find(template => template.id === templateId) || null;
  };

  const handleWorkspaceSnapDragOver = (
    event: React.DragEvent<HTMLButtonElement>,
    target: WorkspaceSnapTarget
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = workspaceDragKind === 'move' ? 'move' : 'copy';
    setWorkspaceSnapTarget(target);
    setWorkspaceDropPlacement(null);
  };

  const getWorkspaceDropPlacement = (clientX: number, clientY: number): WorkspaceDropPlacement => {
    if (!workspaceRef.current) return { mode: 'end' };

    const cards = Array.from(workspaceRef.current.querySelectorAll<HTMLElement>('.workspace-card'));
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const targetTileId = card.dataset.workspaceCardId;
      if (!targetTileId) continue;

      const isWithinCard = (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
      if (!isWithinCard) continue;

      const verticalRatio = (clientY - rect.top) / rect.height;
      if (verticalRatio < 0.28) {
        return { mode: 'row', targetTileId, edge: 'before' };
      }
      if (verticalRatio > 0.72) {
        return { mode: 'row', targetTileId, edge: 'after' };
      }

      return {
        mode: 'column',
        targetTileId,
        edge: clientX < rect.left + rect.width / 2 ? 'before' : 'after',
      };
    }

    return { mode: 'end' };
  };

  const handleWorkspaceDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const movedTileId = event.dataTransfer.getData(WORKSPACE_TILE_DRAG_FORMAT);
    if (movedTileId) {
      event.preventDefault();
      setIsWorkspaceDragActive(false);
      setWorkspaceDragKind(null);
      const snapTarget = workspaceSnapTarget;
      setWorkspaceSnapTarget(null);
      const dropPlacement = workspaceDropPlacement || getWorkspaceDropPlacement(event.clientX, event.clientY);
      setWorkspaceDropPlacement(null);
      const snapTemplate = snapTarget ? getWorkspaceSnapTemplate(snapTarget.templateId) : null;
      const snapZoneIndex = snapTarget?.zoneIndex;
      setWorkspaceTileOrder(prevOrder => {
        const currentOrder = normalizeWorkspaceTileOrder(prevOrder, workspacePanels.map(panel => panel.id));
        const fromIndex = currentOrder.indexOf(movedTileId);
        if (fromIndex === -1) return currentOrder;

        if (snapTemplate) {
          const nextOrder = [...currentOrder];
          const [movedId] = nextOrder.splice(fromIndex, 1);
          const targetIndex = snapZoneIndex ?? nextOrder.length;
          const adjustedDropIndex = targetIndex > fromIndex ? targetIndex - 1 : targetIndex;
          nextOrder.splice(clamp(adjustedDropIndex, 0, nextOrder.length), 0, movedId);
          setWorkspaceLayout(createWorkspaceLayoutFromTemplate(snapTemplate, nextOrder.length));
          return nextOrder;
        }

        if (
          dropPlacement.mode !== 'end' &&
          dropPlacement.targetTileId === movedTileId
        ) {
          return currentOrder;
        }

        const result = applyWorkspaceDropPlacement(
          currentOrder,
          capturedWorkspaceLayout.rowSizes,
          movedTileId,
          dropPlacement,
          movedTileId
        );
        setWorkspaceLayout(result.layout);
        return result.order;
      });
      return;
    }

    const payload = event.dataTransfer.getData(WORKSPACE_DRAG_FORMAT);
    if (!payload) return;

    event.preventDefault();
    setIsWorkspaceDragActive(false);
    setWorkspaceDragKind(null);
    const snapTarget = workspaceSnapTarget;
    setWorkspaceSnapTarget(null);
    const dropPlacement = workspaceDropPlacement || getWorkspaceDropPlacement(event.clientX, event.clientY);
    setWorkspaceDropPlacement(null);
    try {
      const draft = JSON.parse(payload) as WorkspaceDraft;
      if (!['camera', '3d', 'pad', 'tfTree', 'behaviorTree'].includes(draft.type)) return;

      const snapTemplate = snapTarget ? getWorkspaceSnapTemplate(snapTarget.templateId) : null;
      const tileIndex = snapTarget ? snapTarget.zoneIndex : undefined;
      const selectedPadPanel = selectedPanelId
        ? activePanels.find(panel => panel.id === selectedPanelId)
        : null;
      const newPanel = createWorkspacePanel(
        { type: draft.type },
        {
          cameraTopic: selectedCameraTopic || availableCameraTopics[0],
          layoutId: selectedPadPanel?.layoutId || gamepadLibrary[0]?.id,
        }
      );

      setWorkspacePanels(prev => [...prev, newPanel]);
      setWorkspaceTileOrder(prevOrder => {
        const currentOrder = normalizeWorkspaceTileOrder(prevOrder, workspacePanels.map(panel => panel.id));
        if (snapTemplate && typeof tileIndex === 'number') {
          const nextOrder = [...currentOrder];
          nextOrder.splice(clamp(tileIndex, 0, nextOrder.length), 0, newPanel.id);
          setWorkspaceLayout(createWorkspaceLayoutFromTemplate(snapTemplate, nextOrder.length));
          return nextOrder;
        }

        const result = applyWorkspaceDropPlacement(
          currentOrder,
          capturedWorkspaceLayout.rowSizes,
          newPanel.id,
          dropPlacement
        );
        setWorkspaceLayout(result.layout);
        return result.order;
      });
      setLastAddedWorkspacePanelId(newPanel.id);
      setIsWorkspaceAddMenuOpen(false);
      setIsWorkspaceTemplateMenuOpen(false);
    } catch (error) {
      console.error('Failed to add dropped workspace panel:', error);
    }
  };

  const updateAdjacentRatios = (
    ratios: number[],
    index: number,
    deltaPixels: number,
    containerSize: number
  ) => {
    if (index < 0 || index >= ratios.length - 1 || containerSize <= 0) return ratios;

    const nextRatios = [...ratios];
    const combinedRatio = nextRatios[index] + nextRatios[index + 1];
    const minRatio = Math.min(MIN_WORKSPACE_TILE_RATIO, combinedRatio / 2);
    const deltaRatio = deltaPixels / containerSize;
    const leftRatio = clamp(nextRatios[index] + deltaRatio, minRatio, combinedRatio - minRatio);
    nextRatios[index] = leftRatio;
    nextRatios[index + 1] = combinedRatio - leftRatio;
    return nextRatios;
  };

  const handleWorkspaceRowResizeStart = (
    event: React.PointerEvent<HTMLDivElement>,
    index: number
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsWorkspaceResizing(true);
    workspaceInteractionRef.current = {
      mode: 'row',
      index,
      startClientX: event.clientX,
      startClientY: event.clientY,
      containerSize: workspaceRef.current?.clientHeight || 1,
      startRatios: workspaceRowRatios,
    };
  };

  const handleWorkspaceColumnResizeStart = (
    event: React.PointerEvent<HTMLDivElement>,
    rowIndex: number,
    index: number
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsWorkspaceResizing(true);
    const rowElement = event.currentTarget.closest<HTMLElement>('.workspace-tile-row');
    workspaceInteractionRef.current = {
      mode: 'column',
      rowIndex,
      index,
      startClientX: event.clientX,
      startClientY: event.clientY,
      containerSize: rowElement?.clientWidth || 1,
      startRatios: workspaceColumnRatiosByRow[rowIndex] || [],
    };
  };

  const updateWorkspaceInteraction = useCallback((clientX: number, clientY: number) => {
    const interaction = workspaceInteractionRef.current;
    if (!interaction) return;

    const deltaX = clientX - interaction.startClientX;
    const deltaY = clientY - interaction.startClientY;

    if (interaction.mode === 'row') {
      setWorkspaceLayout(prev => ({
        ...prev,
        rowRatios: updateAdjacentRatios(
          interaction.startRatios,
          interaction.index,
          deltaY,
          interaction.containerSize
        ),
      }));
      return;
    }

    setWorkspaceLayout(prev => ({
      ...prev,
      columnRatiosByRow: {
        ...prev.columnRatiosByRow,
        [interaction.rowIndex]: updateAdjacentRatios(
          interaction.startRatios,
          interaction.index,
          deltaX,
          interaction.containerSize
        ),
      },
    }));
  }, []);

  const handleWorkspacePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    updateWorkspaceInteraction(event.clientX, event.clientY);
  };

  const handleWorkspacePointerEnd = () => {
    workspaceInteractionRef.current = null;
    setIsWorkspaceResizing(false);
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      updateWorkspaceInteraction(event.clientX, event.clientY);
    };
    const handleMouseMove = (event: MouseEvent) => {
      updateWorkspaceInteraction(event.clientX, event.clientY);
    };
    const handlePointerEnd = () => {
      workspaceInteractionRef.current = null;
      setIsWorkspaceResizing(false);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerEnd);
    document.addEventListener('pointercancel', handlePointerEnd);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handlePointerEnd);

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerEnd);
      document.removeEventListener('pointercancel', handlePointerEnd);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handlePointerEnd);
    };
  }, [updateWorkspaceInteraction]);

  const handleRemoveWorkspacePanel = (panelId: string) => {
    setWorkspacePanels(prev => prev.filter(panel => panel.id !== panelId));
    setWorkspaceTileOrder(prev => prev.filter(id => id !== panelId));
    resetWorkspaceLayout();
  };

  const handleRemoveWorkspaceTile = (tile: WorkspaceTile) => {
    if (tile.kind === 'panel') {
      handleRemoveWorkspacePanel(tile.panel.id);
      return;
    }

    setWorkspaceTileOrder(prev => prev.filter(id => id !== tile.id));
    resetWorkspaceLayout();
  };

  const handleWorkspaceCameraTopicChange = (panelId: string, cameraTopic: string) => {
    setWorkspacePanels(prev => prev.map(panel =>
      panel.id === panelId ? { ...panel, cameraTopic } : panel
    ));
    setMobileWorkspacePanels(prev => prev.map(panel =>
      panel.id === panelId ? { ...panel, cameraTopic } : panel
    ));
  };

  const handleWorkspacePadLayoutChange = (panelId: string, layoutId: string) => {
    setWorkspacePanels(prev => prev.map(panel =>
      panel.id === panelId ? { ...panel, layoutId } : panel
    ));
    setMobileWorkspacePanels(prev => prev.map(panel =>
      panel.id === panelId ? { ...panel, layoutId } : panel
    ));
  };

  const handleOpenWorkspacePadEditor = (panelId: string, layoutId?: string) => {
    setWorkspacePadEditorTargetId(panelId);
    if (!layoutId) {
      handleOpenCustomEditor();
      return;
    }

    const gamepad = gamepadLibrary.find(item => item.id === layoutId || item.layout.id === layoutId);
    if (gamepad?.isDefault) {
      handleOpenTemplate(gamepad.id);
      return;
    }

    handleOpenCustomEditor(layoutId);
  };

  const createSavedWorkspaceSnapshot = (
    title: string,
    existingLayout?: SavedWorkspaceLayout
  ): SavedWorkspaceLayout => {
    const now = new Date().toISOString();
    const panels = workspacePanels.map(panel => ({ ...panel }));
    const tileOrder = normalizeWorkspaceTileOrder(
      normalizedWorkspaceTileOrder,
      panels.map(panel => panel.id)
    );

    return {
      id: existingLayout?.id || `workspace-layout-${Date.now()}`,
      title,
      panels,
      tileOrder,
      layout: capturedWorkspaceLayout,
      createdAt: existingLayout?.createdAt || now,
      updatedAt: now,
    };
  };

  const getNextWorkspaceLayoutTitle = () => `Workspace ${savedWorkspaceLayouts.length + 1}`;

  const handleSaveWorkspaceLayout = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (workspaceTiles.length === 0) return;

    const existingLayout = activeWorkspaceLayout || undefined;
    const title = workspaceLayoutName.trim() || existingLayout?.title || getNextWorkspaceLayoutTitle();
    const savedLayout = createSavedWorkspaceSnapshot(title, existingLayout);

    setSavedWorkspaceLayouts(prev => {
      if (!existingLayout) return [...prev, savedLayout];
      return prev.map(layout => layout.id === existingLayout.id ? savedLayout : layout);
    });
    setActiveWorkspaceLayoutId(savedLayout.id);
    setWorkspaceLayoutName('');
  };

  const handleSaveWorkspaceLayoutAsNew = () => {
    if (workspaceTiles.length === 0) return;

    const title = workspaceLayoutName.trim() || getNextWorkspaceLayoutTitle();
    const savedLayout = createSavedWorkspaceSnapshot(title);
    setSavedWorkspaceLayouts(prev => [...prev, savedLayout]);
    setActiveWorkspaceLayoutId(savedLayout.id);
    setWorkspaceLayoutName('');
  };

  const handleDeleteSavedWorkspaceLayout = (layoutId: string) => {
    setSavedWorkspaceLayouts(prev => prev.filter(layout => layout.id !== layoutId));
    if (activeWorkspaceLayoutId === layoutId) {
      setActiveWorkspaceLayoutId(null);
    }
  };

  const handleLoadSavedWorkspaceLayout = (layout: SavedWorkspaceLayout) => {
    const normalizedTileOrder = normalizeWorkspaceTileOrder(
      layout.tileOrder,
      layout.panels.map(panel => panel.id)
    );
    setWorkspacePanels(layout.panels.map(panel => ({ ...panel })));
    setWorkspaceTileOrder(normalizedTileOrder);
    setWorkspaceLayout(layout.layout);
    setActiveWorkspaceLayoutId(layout.id);
    setWorkspaceLayoutName('');
    setIsWorkspaceOpen(true);
    setIsWorkspaceTemplateMenuOpen(false);
    setIsWorkspaceAddMenuOpen(false);
  };

  const handleExportWorkspaceLayouts = () => {
    if (savedWorkspaceLayouts.length === 0 && workspacePanels.length === 0) return;

    const referencedLayoutIds = new Set(
      [workspacePanels, ...savedWorkspaceLayouts.map(layout => layout.panels)]
        .flat()
        .filter(panel => panel.type === 'pad' && panel.layoutId)
        .map(panel => panel.layoutId as string)
    );
    const gamepads = gamepadLibrary
      .filter(item => !item.isDefault && (
        referencedLayoutIds.has(item.id) || referencedLayoutIds.has(item.layout.id)
      ))
      .map(item => item.layout);
    const bundle: WorkspaceBundleV2 = {
      version: 2,
      exportedAt: new Date().toISOString(),
      currentWorkspace: {
        panels: workspacePanels,
        tileOrder: normalizedWorkspaceTileOrder,
        layout: capturedWorkspaceLayout,
      },
      layouts: savedWorkspaceLayouts,
      gamepads,
    };

    const blob = new Blob([
      JSON.stringify(bundle, null, 2),
    ], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'robo-boy-workspace-layouts.json';
    link.click();
    URL.revokeObjectURL(objectUrl);
  };

  const handleImportWorkspaceLayouts = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        const gamepadResult = Array.isArray(parsed?.gamepads)
          ? importGamepadLayouts(JSON.stringify({ layouts: parsed.gamepads }))
          : { idMap: {} as Record<string, string> };
        const remapPanels = (panels: WorkspacePanel[]) => panels.map(panel => ({
          ...panel,
          layoutId: panel.layoutId ? (gamepadResult.idMap[panel.layoutId] || panel.layoutId) : undefined,
        }));
        const candidates = Array.isArray(parsed) ? parsed : parsed?.layouts;
        if (!Array.isArray(candidates)) return;

        const importedLayouts = candidates
          .map(layout => normalizeSavedWorkspaceLayout(layout))
          .filter((layout): layout is SavedWorkspaceLayout => layout !== null)
          .map(layout => ({
            ...layout,
            panels: remapPanels(layout.panels),
            id: `workspace-layout-${Date.now()}-${layout.id}`,
            title: layout.title,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }));

        if (parsed?.version === 2 && parsed.currentWorkspace) {
          const current = normalizeSavedWorkspaceLayout({
            ...parsed.currentWorkspace,
            id: `workspace-layout-${Date.now()}-current`,
            title: 'Imported workspace',
          });
          if (current) importedLayouts.unshift({ ...current, panels: remapPanels(current.panels) });
        }
        if (importedLayouts.length === 0) return;
        setSavedWorkspaceLayouts(prev => [...prev, ...importedLayouts]);
        setCustomGamepadRefreshKey(prev => prev + 1);
      } catch (error) {
        console.error('Failed to import workspace layouts:', error);
      }
    };
    reader.readAsText(file);
  };

  const handleAutoTileWorkspacePanels = () => {
    setIsWorkspaceOpen(true);
    setIsWorkspaceDragActive(false);
    setWorkspaceDropPlacement(null);
    if (isDesktopWorkspace) {
      resetWorkspaceLayout();
    }
    setIsWorkspaceAddMenuOpen(false);
    setIsWorkspaceTemplateMenuOpen(false);
  };

  const handleLayoutControlClick = () => {
    if (isDesktopWorkspace) {
      handleAutoTileWorkspacePanels();
      return;
    }

    handleToggleMobileSplitView();
  };

  const handleOpenWorkspaceReplacementMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    panelId: string
  ) => {
    event.stopPropagation();

    const buttonRect = event.currentTarget.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 12;
    const gap = 8;
    const menuWidth = Math.min(300, viewportWidth - margin * 2);
    const spaceBelow = viewportHeight - buttonRect.bottom - margin - gap;
    const spaceAbove = buttonRect.top - margin - gap;
    const openUpward = spaceBelow < 260 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(180, Math.min(380, openUpward ? spaceAbove : spaceBelow));
    const left = clamp(buttonRect.right - menuWidth, margin, viewportWidth - menuWidth - margin);
    const top = openUpward ? buttonRect.top - gap : buttonRect.bottom + gap;

    setWorkspaceReplacementPanelId(panelId);
    setWorkspaceReplaceMenuStyle({
      position: 'fixed',
      top,
      left,
      width: menuWidth,
      maxHeight,
      transform: openUpward ? 'translateY(-100%)' : undefined,
      transformOrigin: openUpward ? 'right bottom' : 'right top',
    });
    setIsWorkspaceAddMenuOpen(true);
    setIsWorkspaceTemplateMenuOpen(false);
  };

  const handleChangeMobileWorkspacePanel = (panelId: string, type: WorkspacePanelType) => {
    setMountedMobilePanelTypes(prev => {
      const mountedTypes = prev[panelId] || [];
      return mountedTypes.includes(type)
        ? prev
        : { ...prev, [panelId]: [...mountedTypes, type] };
    });
    setMobileWorkspacePanels(prev => prev.slice(0, 2).map(panel => (
      panel.id === panelId
        ? {
          ...panel,
          type,
          title: getWorkspaceTitle(type),
          cameraTopic: type === 'camera'
            ? (panel.cameraTopic || selectedCameraTopic || availableCameraTopics[0])
            : panel.cameraTopic,
          layoutId: type === 'pad' ? (panel.layoutId || gamepadLibrary[0]?.id) : panel.layoutId,
        }
        : panel
    )));
  };

  const handleSwapMobileWorkspacePanels = () => {
    setMobileWorkspacePanels(prev => prev.length === 2 ? [prev[1], prev[0]] : prev);
    setActiveMobileWindowIndex(prev => prev === 0 ? 1 : 0);
  };

  const handleToggleMobileSplitView = () => {
    setIsMobileSplitView(prev => {
      if (prev) setActiveMobileWindowIndex(0);
      else setMobileSecondaryEverMounted(true);
      return !prev;
    });
  };

  const handleMobilePanelTypeChange = (type: WorkspacePanelType) => {
    const panel = mobileWorkspacePanels[isMobileSplitView ? activeMobileWindowIndex : 0];
    if (panel) handleChangeMobileWorkspacePanel(panel.id, type);
  };

  // Memoize the selected panel component to prevent unnecessary re-renders
  const SelectedPanelComponent = useMemo(() => {
    if (!selectedPanelId) return null;
    const panel = activePanels.find(p => p.id === selectedPanelId);
    if (!panel || !ros) return null; // Need ROS connection for panels

    return panel.layoutId ? (
      <CustomGamepadWrapper ros={ros} layoutId={panel.layoutId} key={panel.id} />
    ) : null;
  }, [selectedPanelId, activePanels, ros]);

  // View state management with animation
  const handleViewToggle = (mode: ViewMode) => {
    if (!isLargeScreen && !useStandardMobileExecutionLayout) {
      handleMobilePanelTypeChange(mode === '3d' ? '3d' : mode);
      return;
    }

    if (isTransitioning || viewMode === mode) return;

    const currentView = viewPanelRef.current;
    if (!currentView) {
      setViewMode(mode);
      setIsTransitioning(false);
      return;
    }

    setIsTransitioning(true);

    const newViewMode = mode;

    // Create timeline for the animation
    const timeline = anime.timeline({
      easing: 'easeOutQuad', // Changed from elastic to smooth easing without bounce
      complete: () => {
        setTimeout(() => {
          setIsTransitioning(false);
        }, 200);
      }
    });

    // Create a clone of the current view for the transition
    const currentViewClone = currentView.cloneNode(true) as HTMLElement;
    currentViewClone.style.position = 'absolute';
    currentViewClone.style.top = '0';
    currentViewClone.style.left = '0';
    currentViewClone.style.width = '100%';
    currentViewClone.style.height = '100%';
    currentView.parentElement?.appendChild(currentViewClone);

    // Determine animation direction based on view order
    const viewOrder: ViewMode[] = ['camera', '3d', 'tfTree', 'behaviorTree'];
    const currentIndex = viewOrder.indexOf(viewMode);
    const newIndex = viewOrder.indexOf(newViewMode);
    const direction = newIndex > currentIndex ? 1 : -1;

    // Position the new view off-screen
    currentView.style.transform = `translateX(${direction * 150}%)`;

    // Update view mode immediately to show the new content
    setViewMode(newViewMode);

    // Animate both views simultaneously
    timeline.add({
      targets: [currentViewClone, currentView],
      translateX: (_el: HTMLElement, i: number) => {
        // First element (clone) moves out, second element (new view) moves in
        return i === 0 ? `${-direction * 150}%` : '0%';
      },
      duration: 800,
      easing: 'easeOutQuad',
      complete: () => {
        // Clean up the clone after animation
        currentViewClone.remove();
      }
    });
  };

  const handleReturnToBehaviorTree = () => {
    if (!isLargeScreen && !useStandardMobileExecutionLayout) {
      handleMobilePanelTypeChange('behaviorTree');
      return;
    }

    if (viewMode === 'behaviorTree') return;
    setBtEverMounted(true);
    setViewMode('behaviorTree');
    setIsTransitioning(false);
  };

  const handleStopBehaviorTree = () => {
    btExecutionControls.current?.stop();
  };

  const handleStandardBtExecutionChange = (snapshot: BehaviorTreeExecutionSnapshot) => {
    setBtExecution(snapshot);
    setIsStandardBtExecuting(snapshot.isExecuting);
  };

  const renderPadControls = (showPadAddButton: boolean, style?: React.CSSProperties) => (
    <div className="control-panel-container" style={style}>
      <ControlPanelTabs
        panels={activePanels}
        selectedPanelId={selectedPanelId}
        onSelectPanel={handleSelectPanel}
        onAddPanelToggle={handleAddPanelToggle}
        onRemovePanel={handleRemovePanel}
        addButtonRef={showPadAddButton ? addButtonRef : undefined}
        showAddButton={showPadAddButton}
      />
      <div className="control-panel card">
        {isConnected && ros ? (
          SelectedPanelComponent ?? (
            <div className="pad-empty-state">
              <div className="pad-empty-state-content">
                <span className="pad-empty-state-kicker">Custom controls</span>
                <h2>Start by creating your pad</h2>
                <p>Build one from scratch or begin with a ready-made template.</p>
                <button type="button" onClick={() => handleOpenCustomEditor()}>
                  Create your pad
                </button>
              </div>
            </div>
          )
        ) : (
          <div>Connecting to ROS...</div>
        )}
      </div>
    </div>
  );

  const renderViewContent = () => (
    <div className="view-panel card" ref={viewPanelRef}>
      {viewMode === 'camera' ? (
        isConnected && ros && selectedCameraTopic ? (
          <CameraView
            ros={ros}
            cameraTopic={selectedCameraTopic}
            availableTopics={availableCameraTopics}
            onTopicChange={setSelectedCameraTopic}
          />
        ) : (
          <div className="placeholder">
            {isConnected ? (availableCameraTopics.length > 0 ? 'Select a camera topic' : 'No camera topics found') : 'Connecting to ROS...'}
          </div>
        )
      ) : viewMode === '3d' ? (
        isConnected && ros ? (
          <VisualizationPanel ros={ros} key="visualization-panel" />
        ) : (
          <div className="placeholder">Connecting to ROS...</div>
        )
      ) : null}
      {tfEverMounted && (
        <div className="view-slot" style={viewMode !== 'tfTree' ? { display: 'none' } : undefined}>
          {isConnected && ros ? (
            <TfTreePanel ros={ros} isActive={viewMode === 'tfTree'} />
          ) : (
            <div className="placeholder">Connect to ROS to view TF</div>
          )}
        </div>
      )}
      {viewMode === 'tfTree' && !tfEverMounted && (
        <div className="placeholder">Loading...</div>
      )}
      {btEverMounted && (
        <div className="view-slot" style={viewMode !== 'behaviorTree' ? { display: 'none' } : undefined}>
          {isConnected && ros ? (
            <BehaviorTreePanel
              ros={ros}
              isConnected={isConnected}
              isActive={viewMode === 'behaviorTree'}
              onExecutionChange={handleStandardBtExecutionChange}
              onExecutionControlsChange={(controls) => {
                btExecutionControls.current = controls;
              }}
            />
          ) : (
            <div className="placeholder">Connect to ROS to use Behavior Trees</div>
          )}
        </div>
      )}
      {viewMode === 'behaviorTree' && !btEverMounted && (
        <div className="placeholder">Loading...</div>
      )}
    </div>
  );

  const renderWorkspacePadControls = (panel: WorkspacePanel) => {
    const selectedLayoutId = panel.layoutId || gamepadLibrary[0]?.id || '';
    const selectedGamepad = gamepadLibrary.find(item => (
      item.id === selectedLayoutId || item.layout.id === selectedLayoutId
    ));

    return (
      <div className="workspace-pad-component">
        <div className="workspace-pad-selector">
          <label htmlFor={`workspace-pad-select-${panel.id}`}>Pad layout</label>
          {gamepadLibrary.length > 0 ? (
            <select
              id={`workspace-pad-select-${panel.id}`}
              value={selectedLayoutId}
              onChange={(event) => handleWorkspacePadLayoutChange(panel.id, event.target.value)}
            >
              {gamepadLibrary.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="workspace-pad-selector-empty">No pads</span>
          )}
          <button
            type="button"
            className="workspace-pad-action-button workspace-pad-edit-button"
            onClick={() => handleOpenWorkspacePadEditor(panel.id, selectedLayoutId)}
            disabled={!selectedGamepad}
            title={selectedGamepad?.isDefault ? 'Customize selected pad' : 'Edit selected pad'}
            aria-label={selectedGamepad
              ? `${selectedGamepad.isDefault ? 'Customize' : 'Edit'} ${selectedGamepad.name}`
              : 'Edit selected pad'}
          >
            {icons.edit}
          </button>
          <button
            type="button"
            className="workspace-pad-action-button workspace-pad-create-button"
            onClick={() => handleOpenWorkspacePadEditor(panel.id)}
            title="Create new pad"
            aria-label="Create new pad"
          >
            {icons.add}
          </button>
        </div>
        <div className="workspace-pad-body">
          {isConnected && ros && selectedLayoutId ? (
            <CustomGamepadWrapper ros={ros} layoutId={selectedLayoutId} />
          ) : (
            <div className="pad-empty-state">
              <div className="pad-empty-state-content">
                <span className="pad-empty-state-kicker">Custom controls</span>
                <h2>No pads available</h2>
                <p>Create a pad from this component.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderWorkspacePanelContent = (panel: WorkspacePanel, isPanelActive = isDesktopWorkspace) => {
    if (!isConnected || !ros) {
      return <div className="placeholder">Connecting to ROS...</div>;
    }

    if (panel.type === 'camera') {
      const cameraTopic = panel.cameraTopic || selectedCameraTopic || availableCameraTopics[0] || '';
      return cameraTopic ? (
        <CameraView
          ros={ros}
          cameraTopic={cameraTopic}
          availableTopics={availableCameraTopics}
          onTopicChange={(newTopic) => handleWorkspaceCameraTopicChange(panel.id, newTopic)}
          selectId={`camera-topic-select-${panel.id}`}
        />
      ) : (
        <div className="placeholder">
          {availableCameraTopics.length > 0 ? 'Select a camera topic' : 'No camera topics found'}
        </div>
      );
    }

    if (panel.type === '3d') {
      return (
        <VisualizationPanel
          ros={ros}
          storageKey={`roboboy_3d_visualization_state_${panel.id}`}
        />
      );
    }

    if (panel.type === 'behaviorTree') {
      return (
        <BehaviorTreePanel
          ros={ros}
          isConnected={isConnected}
          isActive={isPanelActive}
          onExecutionChange={setBtExecution}
          onExecutionControlsChange={(controls) => {
            btExecutionControls.current = controls;
          }}
        />
      );
    }

    if (panel.type === 'tfTree') {
      return <TfTreePanel ros={ros} isActive={isPanelActive} />;
    }

    if (panel.type === 'pad') {
      return renderWorkspacePadControls(panel);
    }

    return <div className="placeholder">Choose a component</div>;
  };

  const renderMobileWorkspaceWindow = (panel: WorkspacePanel, index: number) => {
    const mountedTypes = mountedMobilePanelTypes[panel.id] || [panel.type];
    const panelTypes = mountedTypes.includes(panel.type) ? mountedTypes : [...mountedTypes, panel.type];
    const isVisible = index === 0 || isMobileSplitView;

    return (
      <section
        key={panel.id}
        className={`workspace-card mobile-workspace-window workspace-card-${panel.type} ${activeMobileWindowIndex === index ? 'is-active' : ''}`}
        aria-label={`${index === 0 ? 'Top' : 'Bottom'} mobile window`}
        aria-hidden={!isVisible}
        style={{
          display: isVisible ? undefined : 'none',
          height: isMobileSplitView ? `calc(${index === 0 ? topHeight : bottomHeight}% - 8px)` : '100%',
        }}
      >
        {isMobileSplitView && (
          <header className="workspace-card-header mobile-workspace-window-header">
            <button
              type="button"
              className="mobile-workspace-window-selector"
              onClick={() => setActiveMobileWindowIndex(index)}
              aria-pressed={activeMobileWindowIndex === index}
              aria-label={`Select ${index === 0 ? 'top' : 'bottom'} window`}
            >
              <span className={`workspace-card-dot workspace-card-dot-${panel.type}`} aria-hidden="true" />
              <span>{panel.title}</span>
              {activeMobileWindowIndex === index && <span className="mobile-workspace-active-label">Active</span>}
            </button>
            {index === 0 && (
              <button
                type="button"
                className="mobile-workspace-swap-button"
                onClick={handleSwapMobileWorkspacePanels}
                title="Swap mobile windows"
                aria-label="Swap mobile windows"
              >
                {icons.swap}
              </button>
            )}
          </header>
        )}
        <div className="workspace-card-content">
          {panelTypes.map(type => {
            const isPanelActive = panel.type === type && isVisible;
            const typedPanel = { ...panel, type, title: getWorkspaceTitle(type) };
            return (
              <div
                key={type}
                className={`mobile-workspace-panel-slot ${isPanelActive ? 'is-active' : 'is-hidden'}`}
                aria-hidden={!isPanelActive}
                style={{ display: isPanelActive ? undefined : 'none' }}
              >
                {renderWorkspacePanelContent(typedPanel, isPanelActive)}
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const renderMobileWorkspace = () => (
    <div className={`mobile-workspace ${isMobileSplitView ? 'is-split' : 'is-single'}`} aria-label="Mobile panels" ref={containerRef}>
      {renderMobileWorkspaceWindow(mobileWorkspacePanels[0], 0)}
      {isMobileSplitView && (
        <div
          className={`resize-handle ${isDragging ? 'dragging' : ''}`}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize mobile windows"
        >
          <div className="resize-handle-bar" />
        </div>
      )}
      {mobileSecondaryEverMounted && renderMobileWorkspaceWindow(mobileWorkspacePanels[1], 1)}
    </div>
  );

  const renderWorkspaceAddMenu = (placement: 'toolbar' | 'replacement' = 'toolbar') => {
    if (!isWorkspaceAddMenuOpen) return null;
    if (placement === 'toolbar' && workspaceReplacementPanelId) return null;
    if (placement === 'replacement' && !workspaceReplacementPanelId) return null;
    const isReplacementMenu = placement === 'replacement';

    return (
      <div
        className={`workspace-add-menu ${isReplacementMenu ? 'workspace-add-menu-floating' : ''}`}
        ref={isReplacementMenu ? workspaceReplaceMenuRef : undefined}
        role="menu"
        style={isReplacementMenu ? workspaceReplaceMenuStyle || undefined : undefined}
      >
        <div className="workspace-add-menu-section">
          <span className="workspace-add-menu-title">
            {workspaceReplacementPanelId ? 'Replace panel' : 'Components'}
          </span>
          <button
            type="button"
            draggable={!isReplacementMenu}
            onDragStart={(event) => handleWorkspaceDragStart(event, 'camera')}
            onDragEnd={handleWorkspaceDragEnd}
            onClick={() => handleAddWorkspacePanel('camera')}
          >
            {icons.camera}
            <span>Camera</span>
          </button>
          <button
            type="button"
            draggable={!isReplacementMenu}
            onDragStart={(event) => handleWorkspaceDragStart(event, '3d')}
            onDragEnd={handleWorkspaceDragEnd}
            onClick={() => handleAddWorkspacePanel('3d')}
          >
            {icons.view3d}
            <span>3D panel</span>
          </button>
          <button
            type="button"
            draggable={!isReplacementMenu}
            onDragStart={(event) => handleWorkspaceDragStart(event, 'behaviorTree')}
            onDragEnd={handleWorkspaceDragEnd}
            onClick={() => handleAddWorkspacePanel('behaviorTree')}
          >
            {icons.bt}
            <span>Behavior tree</span>
          </button>
          <button
            type="button"
            draggable={!isReplacementMenu}
            onDragStart={(event) => handleWorkspaceDragStart(event, 'tfTree')}
            onDragEnd={handleWorkspaceDragEnd}
            onClick={() => handleAddWorkspacePanel('tfTree')}
          >
            {icons.tf}
            <span>TF tree</span>
          </button>
          <button
            type="button"
            draggable={!isReplacementMenu}
            onDragStart={(event) => handleWorkspaceDragStart(event, 'pad')}
            onDragEnd={handleWorkspaceDragEnd}
            onClick={() => handleAddWorkspacePanel('pad')}
          >
            {icons.grip}
            <span>Pad controls</span>
          </button>
        </div>
      </div>
    );
  };

  const renderWorkspaceTemplateMenu = () => {
    if (!isWorkspaceTemplateMenuOpen) return null;

    return (
      <div className="workspace-template-menu">
        <form className="workspace-template-form" onSubmit={handleSaveWorkspaceLayout}>
          <label htmlFor="workspace-layout-name">Layout name</label>
          <div className="workspace-template-form-row">
            <input
              id="workspace-layout-name"
              value={workspaceLayoutName}
              onChange={(event) => setWorkspaceLayoutName(event.target.value)}
              placeholder={activeWorkspaceLayout?.title || getNextWorkspaceLayoutTitle()}
              maxLength={28}
            />
            <button
              type="submit"
              disabled={workspaceTiles.length === 0}
              title={activeWorkspaceLayout ? 'Update current layout' : 'Save current layout'}
              aria-label={activeWorkspaceLayout ? 'Update current layout' : 'Save current layout'}
            >
              {icons.saveLayout}
            </button>
            {activeWorkspaceLayout && (
              <button
                type="button"
                onClick={handleSaveWorkspaceLayoutAsNew}
                disabled={workspaceTiles.length === 0}
                title="Save as new layout"
                aria-label="Save as new layout"
              >
                {icons.add}
              </button>
            )}
          </div>
        </form>
        <div className="workspace-template-transfer-row">
          <button
            type="button"
            onClick={() => templateImportInputRef.current?.click()}
            title="Import layouts"
            aria-label="Import layouts"
          >
            {icons.upload}
            <span>Import</span>
          </button>
          <button
            type="button"
            onClick={handleExportWorkspaceLayouts}
            disabled={savedWorkspaceLayouts.length === 0 && workspacePanels.length === 0}
            title="Export layouts"
            aria-label="Export layouts"
          >
            {icons.download}
            <span>Export</span>
          </button>
          <input
            ref={templateImportInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportWorkspaceLayouts}
          />
        </div>
        {savedWorkspaceLayouts.length > 0 ? (
          <div className="workspace-template-list">
            {savedWorkspaceLayouts.map(layout => (
              <div
                className={`workspace-template-item ${layout.id === activeWorkspaceLayoutId ? 'active' : ''}`}
                key={layout.id}
              >
                <button
                  type="button"
                  className="workspace-template-load-row"
                  onClick={() => handleLoadSavedWorkspaceLayout(layout)}
                  title={`Load ${layout.title}`}
                  aria-label={`Load ${layout.title}`}
                >
                  <span className="workspace-template-title" title={layout.title}>{layout.title}</span>
                  {layout.id === activeWorkspaceLayoutId && (
                    <span className="workspace-template-current">
                      {isActiveWorkspaceLayoutDirty ? 'Edited' : 'Current'}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="workspace-template-delete-button"
                  onClick={() => handleDeleteSavedWorkspaceLayout(layout.id)}
                  title={`Delete ${layout.title}`}
                  aria-label={`Delete ${layout.title}`}
                >
                  {icons.trash}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="workspace-template-empty">No saved layouts yet</div>
        )}
      </div>
    );
  };

  const renderWorkspaceSnapAssistant = () => {
    if (!isWorkspaceDragActive || workspaceSnapTemplates.length === 0) return null;

    return (
      <div className="workspace-snap-assistant" aria-label="Snap layouts">
        {workspaceSnapTemplates.map(template => {
          let zoneIndex = 0;

          return (
            <div className="workspace-snap-template" key={template.id}>
              <span className="workspace-snap-template-title">{template.title}</span>
              <div className="workspace-snap-template-grid">
                {template.rowSizes.map((rowSize, rowIndex) => (
                  <div
                    className="workspace-snap-template-row"
                    key={`${template.id}-row-${rowIndex}`}
                    style={{ flex: template.rowRatios?.[rowIndex] || 1 }}
                  >
                    {Array.from({ length: rowSize }).map(() => {
                      const currentZoneIndex = zoneIndex;
                      zoneIndex += 1;
                      const isActiveSnapZone = workspaceSnapTarget?.templateId === template.id &&
                        workspaceSnapTarget.zoneIndex === currentZoneIndex;

                      return (
                        <button
                          type="button"
                          className={`workspace-snap-zone ${isActiveSnapZone ? 'active' : ''}`}
                          key={`${template.id}-zone-${currentZoneIndex}`}
                          onDragEnter={(event) => handleWorkspaceSnapDragOver(event, {
                            templateId: template.id,
                            zoneIndex: currentZoneIndex,
                          })}
                          onDragOver={(event) => handleWorkspaceSnapDragOver(event, {
                            templateId: template.id,
                            zoneIndex: currentZoneIndex,
                          })}
                          title={`Snap to ${template.title}`}
                          aria-label={`Snap to ${template.title} zone ${currentZoneIndex + 1}`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderStandardSplitLayout = (className = 'standard-stack-layout') => (
    <div className={className} ref={containerRef}>
      <div className="view-panel-container" style={{ height: viewMode === 'tfTree' ? '100%' : `calc(${topHeight}% - 8px)` }}>
        {renderViewContent()}
      </div>

      {viewMode !== 'tfTree' && (
        <>
          <div
            className={`resize-handle ${isDragging ? 'dragging' : ''}`}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
          >
            <div className="resize-handle-bar" />
          </div>

          {renderPadControls(true, { height: `calc(${bottomHeight}% - 8px)` })}
        </>
      )}
    </div>
  );

  return (
    <div className="main-control-view">
      {/* Unified Top Bar */}
      <div className={`top-bar ${btExecution.isExecuting ? 'bt-running' : ''} ${isDesktopWorkspace ? 'workspace-active' : ''}`}>
        {!isDesktopWorkspace && (
          <div className="view-toggle">
            <button
              onClick={() => handleViewToggle('camera')}
              className={(isLargeScreen || useStandardMobileExecutionLayout ? viewMode === 'camera' : activeMobilePanel?.type === 'camera') ? 'active' : ''}
              title="Camera View"
              aria-label="Switch to Camera View"
            >
              {icons.camera}
            </button>
            <button
              onClick={() => handleViewToggle('3d')}
              className={(isLargeScreen || useStandardMobileExecutionLayout ? viewMode === '3d' : activeMobilePanel?.type === '3d') ? 'active' : ''}
              title="3D View"
              aria-label="Switch to 3D View"
            >
              {icons.view3d}
            </button>
            <button
              onClick={() => handleViewToggle('tfTree')}
              className={(isLargeScreen || useStandardMobileExecutionLayout ? viewMode === 'tfTree' : activeMobilePanel?.type === 'tfTree') ? 'active' : ''}
              title="TF Tree"
              aria-label="Switch to TF Tree"
            >
              {icons.tf}
            </button>
            {btExecution.isExecuting ? (
              <div
                className={`bt-execution-island ${(isLargeScreen || useStandardMobileExecutionLayout ? viewMode === 'behaviorTree' : activeMobilePanel?.type === 'behaviorTree') ? 'active' : ''}`}
                role="status"
                aria-live="polite"
              >
                <button
                  className="bt-execution-return"
                  onClick={handleReturnToBehaviorTree}
                  title="Open behavior tree"
                  aria-label="Open behavior tree"
                >
                  {icons.bt}
                  <span className="bt-execution-pulse" aria-hidden="true" />
                  <span className="bt-execution-copy">
                    <span className="bt-execution-tree" title={btExecution.treeName || 'Behavior tree'}>
                      {btExecution.treeName || 'Behavior tree'}
                    </span>
                    <span className="bt-execution-node" title={btExecution.activeNodeLabel || 'Running'}>
                      {btExecution.activeNodeLabel || 'Running'}
                    </span>
                  </span>
                </button>
                <button
                  className="bt-execution-stop"
                  onClick={handleStopBehaviorTree}
                  title="Stop behavior tree"
                  aria-label="Stop behavior tree"
                >
                  {icons.stop}
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleViewToggle('behaviorTree')}
                className={(isLargeScreen || useStandardMobileExecutionLayout ? viewMode === 'behaviorTree' : activeMobilePanel?.type === 'behaviorTree') ? 'active' : ''}
                title="Behavior Tree"
                aria-label="Switch to Behavior Tree"
              >
                {icons.bt}
              </button>
            )}
            {!isLargeScreen && !useStandardMobileExecutionLayout && (
              <button
                onClick={() => handleMobilePanelTypeChange('pad')}
                className={activeMobilePanel?.type === 'pad' ? 'active' : ''}
                title="Pad controls"
                aria-label="Switch to Pad controls"
              >
                {icons.grip}
              </button>
            )}
          </div>
        )}
        <div className="layout-controls">
          <button
            type="button"
            className={`workspace-tile-button ${isDesktopWorkspace || isMobileSplitView ? 'active' : ''}`}
            onClick={handleLayoutControlClick}
            title={isDesktopWorkspace
              ? 'Auto-arrange workspace panels'
              : isMobileSplitView ? 'Use one mobile panel' : 'Split mobile view'}
            aria-label={isDesktopWorkspace
              ? 'Auto-arrange workspace panels'
              : isMobileSplitView ? 'Use one mobile panel' : 'Split mobile view'}
          >
            {isDesktopWorkspace ? icons.tile : icons.split}
          </button>
          {isDesktopWorkspace && (
            <>
                  <span
                    className={`workspace-active-layout-name ${isActiveWorkspaceLayoutDirty ? 'dirty' : ''}`}
                    title={activeWorkspaceLayout
                      ? `${activeWorkspaceLayout.title}${isActiveWorkspaceLayoutDirty ? ' (edited)' : ''}`
                      : 'Unsaved workspace layout'}
                  >
                    {activeWorkspaceLayout
                      ? `${activeWorkspaceLayout.title}${isActiveWorkspaceLayoutDirty ? '*' : ''}`
                      : 'Unsaved layout'}
                  </span>
                  <div className="workspace-template-control" ref={workspaceTemplateControlRef}>
                    <button
                      type="button"
                      className="workspace-template-button"
                      onClick={() => {
                        setIsWorkspaceTemplateMenuOpen(prev => !prev);
                        setIsWorkspaceAddMenuOpen(false);
                      }}
                      title="Manage workspace layouts"
                      aria-label="Manage workspace layouts"
                    >
                      {icons.saveLayout}
                    </button>
                    {renderWorkspaceTemplateMenu()}
                  </div>
            </>
          )}
          {isDesktopWorkspace && (
            <div className="workspace-add-control" ref={workspaceAddControlRef}>
              <button
                type="button"
                    className="workspace-add-button"
                    onClick={() => {
                      setWorkspaceReplacementPanelId(null);
                      setWorkspaceReplaceMenuStyle(null);
                      setIsWorkspaceAddMenuOpen(prev => !prev);
                      setIsWorkspaceTemplateMenuOpen(false);
                    }}
                title="Add workspace panel"
                aria-label="Add workspace panel"
              >
                {icons.add}
              </button>
              {renderWorkspaceAddMenu('toolbar')}
            </div>
          )}
        </div>
        <div className="status-controls">
          <div
            className={`connection-status-icon ${isConnected ? 'connected' : 'disconnected'}`}
            title={isConnected ? 'Status: Connected' : 'Status: Disconnected'}
            aria-label={isConnected ? 'Status: Connected' : 'Status: Disconnected'}
            role="status"
          >
            {isConnected ? icons.connected : icons.disconnected}
          </div>
          <button
            onClick={handleInternalDisconnect}
            className="disconnect-button-icon"
            title="Disconnect"
            aria-label="Disconnect"
          >
            {icons.disconnect}
          </button>
        </div>
      </div>

      {/* Main Content Area - ensure it starts below the top bar */}
      <div className={`main-content-area ${isDesktopWorkspace ? 'workspace-mode' : 'stack-mode'}`}>
        {isDesktopWorkspace ? (
          <div
            className={`desktop-workspace ${isWorkspaceDragActive ? 'is-drop-active' : ''} ${isWorkspaceResizing ? 'is-resizing' : ''}`}
            aria-label="Desktop workspace"
            ref={workspaceRef}
            onDragOver={handleWorkspaceDragOver}
            onDragLeave={handleWorkspaceDragLeave}
            onDrop={handleWorkspaceDrop}
            onPointerMove={handleWorkspacePointerMove}
            onPointerUp={handleWorkspacePointerEnd}
            onPointerCancel={handleWorkspacePointerEnd}
          >
            {renderWorkspaceSnapAssistant()}
            <div className="workspace-grid">
              {workspaceRows.map((row, rowIndex) => (
                <React.Fragment key={`workspace-row-${rowIndex}`}>
                  {workspaceDropPlacement?.mode === 'row' &&
                    workspaceDropPlacement.edge === 'before' &&
                    row.some(tile => tile.id === workspaceDropPlacement.targetTileId) && (
                      <div className="workspace-drop-indicator workspace-drop-indicator-row" aria-hidden="true" />
                    )}
                  <div
                    className="workspace-tile-row"
                    style={{ flex: workspaceRowRatios[rowIndex] || 1 }}
                  >
                    {row.map((tile, columnIndex) => {
                      const tileIndex = getWorkspaceTileIndex(rowIndex, columnIndex);
                      const showColumnDropBefore = workspaceDropPlacement?.mode === 'column' &&
                        workspaceDropPlacement.edge === 'before' &&
                        workspaceDropPlacement.targetTileId === tile.id;
                      const showColumnDropAfter = workspaceDropPlacement?.mode === 'column' &&
                        workspaceDropPlacement.edge === 'after' &&
                        workspaceDropPlacement.targetTileId === tile.id;
                      return (
                        <React.Fragment key={tile.id}>
                          {showColumnDropBefore && (
                            <div className="workspace-drop-indicator" aria-hidden="true" />
                          )}
                          {tile.kind === 'view' ? (
                            <section
                              className="workspace-card workspace-card-view"
                              aria-label="View component"
                              data-workspace-card-id={tile.id}
                              data-workspace-row-index={rowIndex}
                              data-workspace-column-index={columnIndex}
                              style={{ flex: workspaceColumnRatiosByRow[rowIndex]?.[columnIndex] || 1 }}
                            >
                              <header
                                className="workspace-card-header"
                                draggable
                                onDragStart={(event) => handleWorkspaceTileDragStart(event, tile.id)}
                                onDragEnd={handleWorkspaceDragEnd}
                              >
                                <div className="workspace-card-title">
                                  <span className="workspace-card-dot workspace-card-dot-view" aria-hidden="true" />
                                  <span>View</span>
                                </div>
                                <div className="workspace-card-actions">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleRemoveWorkspaceTile(tile);
                                    }}
                                    title="Remove view tile"
                                    aria-label="Remove view tile"
                                  >
                                    {icons.trash}
                                  </button>
                                </div>
                              </header>
                              <div className="workspace-card-content workspace-card-content-view">
                                {renderViewContent()}
                              </div>
                            </section>
                          ) : tile.kind === 'pads' ? (
                            <section
                              className="workspace-card workspace-card-pads"
                              aria-label="Pad controls component"
                              data-workspace-card-id={tile.id}
                              data-workspace-row-index={rowIndex}
                              data-workspace-column-index={columnIndex}
                              style={{ flex: workspaceColumnRatiosByRow[rowIndex]?.[columnIndex] || 1 }}
                            >
                              <header
                                className="workspace-card-header"
                                draggable
                                onDragStart={(event) => handleWorkspaceTileDragStart(event, tile.id)}
                                onDragEnd={handleWorkspaceDragEnd}
                              >
                                <div className="workspace-card-title">
                                  <span className="workspace-card-dot workspace-card-dot-pad" aria-hidden="true" />
                                  <span>Pad controls</span>
                                </div>
                                <div className="workspace-card-actions">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleRemoveWorkspaceTile(tile);
                                    }}
                                    title="Remove pad controls tile"
                                    aria-label="Remove pad controls tile"
                                  >
                                    {icons.trash}
                                  </button>
                                </div>
                              </header>
                              <div className="workspace-card-content">
                                {renderPadControls(true)}
                              </div>
                            </section>
                          ) : (
                            <section
                              className={`workspace-card workspace-card-${tile.panel.type} ${lastAddedWorkspacePanelId === tile.panel.id ? 'is-settling' : ''}`}
                              aria-label={tile.panel.title}
                              data-workspace-card-id={tile.panel.id}
                              data-workspace-row-index={rowIndex}
                              data-workspace-column-index={columnIndex}
                              style={{ flex: workspaceColumnRatiosByRow[rowIndex]?.[columnIndex] || 1 }}
                              onAnimationEnd={() => {
                                setLastAddedWorkspacePanelId(prev => prev === tile.panel.id ? null : prev);
                              }}
                            >
                              <header
                                className={`workspace-card-header ${workspaceReplacementPanelId === tile.panel.id ? 'is-selected' : ''}`}
                                draggable
                                onClick={() => setWorkspaceReplacementPanelId(tile.panel.id)}
                                onDragStart={(event) => handleWorkspaceTileDragStart(event, tile.id)}
                                onDragEnd={handleWorkspaceDragEnd}
                              >
                                <div className="workspace-card-title">
                                  <span className={`workspace-card-dot workspace-card-dot-${tile.panel.type}`} aria-hidden="true" />
                                  <span>{tile.panel.title}</span>
                                </div>
                                <div className="workspace-card-actions">
                                  <button
                                    type="button"
                                    className={`workspace-replace-button ${workspaceReplacementPanelId === tile.panel.id && isWorkspaceAddMenuOpen ? 'is-open' : ''}`}
                                    onClick={(event) => handleOpenWorkspaceReplacementMenu(event, tile.panel.id)}
                                    title="Replace panel"
                                    aria-label={`Replace ${tile.panel.title}`}
                                  >
                                    {icons.replacePanel}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleRemoveWorkspaceTile(tile);
                                    }}
                                    title="Remove panel"
                                    aria-label={`Remove ${tile.panel.title}`}
                                  >
                                    {icons.trash}
                                  </button>
                                </div>
                              </header>
                              <div className="workspace-card-content">
                                {renderWorkspacePanelContent(tile.panel)}
                              </div>
                            </section>
                          )}
                          {showColumnDropAfter && (
                            <div className="workspace-drop-indicator" aria-hidden="true" />
                          )}
                          {columnIndex < row.length - 1 && (
                            <div
                              className="workspace-column-resize-handle"
                              onPointerDown={(event) => handleWorkspaceColumnResizeStart(event, rowIndex, columnIndex)}
                              role="separator"
                              aria-orientation="vertical"
                              aria-label="Resize workspace columns"
                            >
                              <div className="workspace-resize-handle-bar" />
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {rowIndex === workspaceRows.length - 1 && workspaceDropPlacement?.mode === 'end' && (
                      <div className="workspace-drop-indicator workspace-drop-indicator-end" aria-hidden="true" />
                    )}
                  </div>
                  {workspaceDropPlacement?.mode === 'row' &&
                    workspaceDropPlacement.edge === 'after' &&
                    row.some(tile => tile.id === workspaceDropPlacement.targetTileId) && (
                      <div className="workspace-drop-indicator workspace-drop-indicator-row" aria-hidden="true" />
                    )}
                  {rowIndex < workspaceRows.length - 1 && (
                    <div
                      className="workspace-row-resize-handle"
                      onPointerDown={(event) => handleWorkspaceRowResizeStart(event, rowIndex)}
                      role="separator"
                      aria-orientation="horizontal"
                      aria-label="Resize workspace rows"
                    >
                      <div className="workspace-resize-handle-bar" />
                    </div>
                  )}
                </React.Fragment>
              ))}
              {workspaceTiles.length === 0 && (
                <div className="workspace-empty-drop-zone">
                  <button
                    type="button"
                    className="workspace-empty-add-button"
                    onClick={() => {
                      setWorkspaceReplacementPanelId(null);
                      setIsWorkspaceAddMenuOpen(true);
                    }}
                    aria-label="Add workspace panel"
                  >
                    {icons.add}
                    <span>Add panel</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : useStandardMobileExecutionLayout ? (
          renderStandardSplitLayout()
        ) : (
          renderMobileWorkspace()
        )}
        {renderWorkspaceAddMenu('replacement')}
      </div>

      {/* Render AddPanelMenu using Portal outside main flow */}
      <AddPanelMenu
        isOpen={isAddPanelMenuOpen}
        onSelectLayout={handleAddCustomPanel}
        onClose={handleCloseMenu}
        onOpenCustomEditor={handleOpenCustomEditor}
        onOpenTemplate={handleOpenTemplate}
        addButtonRef={addButtonRef}
        refreshKey={customGamepadRefreshKey}
        onCustomGamepadDeleted={handleCustomGamepadDeleted}
        onGamepadLibraryChanged={() => setCustomGamepadRefreshKey(prev => prev + 1)}
      />

      {/* Render GamepadEditor modal */}
      {editorSession && ros && (
        <GamepadEditor
          isOpen
          onClose={handleCloseCustomEditor}
          onSave={handleSaveCustomGamepad}
          initialLayout={editorSession.initialLayout}
          ros={ros}
        />
      )}
    </div>
  );
};

export default MainControlView;
