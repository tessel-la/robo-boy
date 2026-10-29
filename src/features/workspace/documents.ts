import { getConnectionStorageKey } from '../../runtime/connectionStorage';
import { BUILT_IN_PANELS, LEGACY_TIME_SERIES_ID } from '../../panels/builtInPanels';
import { isValidPanelId } from '../../panels/registry';
import { isJsonObject, isStoredPanelState, type RoboBoyRosTopic, type StoredPanelState } from '../../panels/types';
import { validatePanelState } from '../../panels/storage';
import { normalizeWorkspaceLayout, type WorkspaceLayoutState } from '../../components/workspaceLayout';
import type { VisualizationPanelState } from '../../utils/visualizationState';
import type { CustomGamepadLayout } from '../customGamepad/types';
const getWorkspaceTitle = (type: string) => BUILT_IN_PANELS.find(panel => panel.id === type)?.name || 'External panel';
export interface WorkspacePanel {
  id: string;
  type: string;
  title: string;
  cameraTopic?: string;
  layoutId?: string;
  panelState?: StoredPanelState;
  approvedRosTopics?: RoboBoyRosTopic[];
  /** Set when the Data Explorer configures this tile, so a tile that already shows the same panel
   * type remounts and reads its new configuration instead of keeping the old one. */
  openedAt?: number;
}

const normalizeApprovedRosTopics = (value: unknown): RoboBoyRosTopic[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const topics = new Map<string, string>();
  value.slice(0, 32).forEach(candidate => {
    if (!candidate || typeof candidate !== 'object') return;
    const { name, messageType } = candidate as Partial<RoboBoyRosTopic>;
    if (
      typeof name !== 'string' ||
      !name.startsWith('/') ||
      name.length > 512 ||
      /\s/.test(name) ||
      typeof messageType !== 'string' ||
      !messageType ||
      messageType.length > 512 ||
      /\s/.test(messageType)
    ) {
      return;
    }
    topics.set(name, messageType);
  });
  return topics.size ? [...topics.entries()].map(([name, messageType]) => ({ name, messageType })) : undefined;
};

export const withoutApprovedRosTopics = ({
  approvedRosTopics: _approvedRosTopics,
  ...panel
}: WorkspacePanel): WorkspacePanel => panel;

export const normalizeWorkspacePanel = (panel: unknown, allowApprovedRosTopics = true): WorkspacePanel | null => {
  if (!panel || typeof panel !== 'object') return null;
  const candidate = panel as Partial<WorkspacePanel>;
  if (typeof candidate.id !== 'string' || !isValidPanelId(candidate.type) || typeof candidate.title !== 'string') {
    return null;
  }

  const storedPanelState =
    isStoredPanelState(candidate.panelState, candidate.type) && validatePanelState(candidate.panelState.values)
      ? candidate.panelState
      : isJsonObject(candidate.panelState) && validatePanelState(candidate.panelState)
        ? { schemaVersion: 1 as const, panelId: candidate.type, values: candidate.panelState }
        : undefined;

  return {
    id: candidate.id,
    type: (candidate.type === LEGACY_TIME_SERIES_ID ? 'timeSeries' : candidate.type) as string,
    title: candidate.type === 'pad' ? getWorkspaceTitle('pad') : candidate.title,
    cameraTopic: candidate.cameraTopic,
    layoutId: candidate.layoutId,
    panelState:
      storedPanelState && candidate.type === LEGACY_TIME_SERIES_ID
        ? { ...storedPanelState, panelId: 'timeSeries' }
        : storedPanelState,
    approvedRosTopics: allowApprovedRosTopics ? normalizeApprovedRosTopics(candidate.approvedRosTopics) : undefined,
  };
};

export type SavedWorkspaceLayout = {
  id: string;
  title: string;
  panels: WorkspacePanel[];
  tileOrder: string[];
  layout: WorkspaceLayoutState;
  createdAt: string;
  updatedAt: string;
};

/** A 3D panel keeps its scene settings in visualization storage keyed by panel id, not on the
 * panel record; a portable bundle carries them next to the panel so a layout imported elsewhere
 * brings its frames, fixed frame and frame display along. */
export type ExportedWorkspacePanel = WorkspacePanel & { visualization?: VisualizationPanelState };
type ExportedWorkspaceLayout<T extends { panels: WorkspacePanel[] }> = Omit<T, 'panels'> & {
  panels: ExportedWorkspacePanel[];
};

export type WorkspaceBundleV2 = {
  version: 2;
  exportedAt: string;
  currentWorkspace: ExportedWorkspaceLayout<Omit<SavedWorkspaceLayout, 'id' | 'title' | 'createdAt' | 'updatedAt'>>;
  layouts: ExportedWorkspaceLayout<SavedWorkspaceLayout>[];
  gamepads: CustomGamepadLayout[];
};

export const visualizationStorageKey = (panelId: string, storageScope?: string) =>
  getConnectionStorageKey(`roboboy_3d_visualization_state_${panelId}`, storageScope);

export const normalizeSavedWorkspaceLayout = (
  layout: unknown,
  allowApprovedRosTopics = true
): SavedWorkspaceLayout | null => {
  if (!layout || typeof layout !== 'object') return null;
  const candidate = layout as Partial<SavedWorkspaceLayout>;
  if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string') return null;

  const panels = Array.isArray(candidate.panels)
    ? candidate.panels
        .map(panel => normalizeWorkspacePanel(panel, allowApprovedRosTopics))
        .filter((panel): panel is WorkspacePanel => panel !== null)
    : [];
  const tileOrder = normalizeWorkspaceTileOrder(
    Array.isArray(candidate.tileOrder) ? candidate.tileOrder.filter(item => typeof item === 'string') : [],
    panels.map(panel => panel.id)
  );

  return {
    id: candidate.id,
    title: candidate.title.trim() || 'Workspace layout',
    panels,
    tileOrder,
    layout: normalizeWorkspaceLayout(candidate.layout, tileOrder),
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
  };
};

export const normalizeWorkspaceTileOrder = (order: string[], panelIds: string[]) => {
  const validIds = panelIds;
  const orderedIds = order.filter((id, index) => validIds.includes(id) && order.indexOf(id) === index);
  const missingPanelIds = panelIds.filter(id => !orderedIds.includes(id));
  return [...orderedIds, ...missingPanelIds];
};
