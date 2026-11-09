import { collection, record, text } from '../library/json';
import { normalizeVisualizationState, type VisualizationPanelState } from '../../utils/visualizationState';
import { normalizeSavedWorkspaceLayout, type ExportedWorkspacePanel, type SavedWorkspaceLayout } from './documents';
import { isBuiltInPanelId } from '../../panels/builtInPanels';
import { decodeTree } from '../behaviorTree/portableTree';
export function decodeImportedVisualization(value: unknown): VisualizationPanelState {
  const state = record(value, '3D settings');
  if (state.visualizations !== undefined)
    for (const item of collection(state.visualizations, '3D layers', 100)) {
      const layer = record(item, '3D layer');
      text(layer.id, 'Layer id');
      text(layer.type, 'Layer type');
      if (typeof layer.topic !== 'string') throw new Error('Invalid 3D topic.');
      if (layer.options !== undefined) record(layer.options, 'Layer options');
    }
  if (state.fixedFrame !== undefined && typeof state.fixedFrame !== 'string') throw new Error('Invalid fixed frame.');
  if (
    state.displayedTfFrames !== undefined &&
    (!Array.isArray(state.displayedTfFrames) ||
      state.displayedTfFrames.some((frame: unknown) => typeof frame !== 'string'))
  )
    throw new Error('Invalid TF frames.');
  for (const key of [
    'showAllTfFrames',
    'showTfAxes',
    'showTfFrameLabels',
    'showTfConnections',
    'showTfLabelBackground',
  ])
    if (state[key] !== undefined && typeof state[key] !== 'boolean') throw new Error(`Invalid 3D flag: ${key}.`);
  for (const key of ['tfAxesScale', 'tfAxesWidth', 'tfLabelScale', 'tfAxesOpacity', 'tfLabelOpacity'])
    if (state[key] !== undefined && (typeof state[key] !== 'number' || state[key] < 0))
      throw new Error(`Invalid 3D setting: ${key}.`);
  return normalizeVisualizationState(state);
}

export function decodeWorkspaceDocument(
  value: unknown
): Omit<SavedWorkspaceLayout, 'panels'> & { panels: ExportedWorkspacePanel[] } {
  const raw = record(value, 'Workspace');
  text(raw.id, 'Workspace id');
  text(raw.title, 'Workspace title');
  const panels = collection(raw.panels, 'Workspace panels', 100).map(value => record(value, 'Panel'));
  const ids = new Set<string>();
  for (const panel of panels) {
    text(panel.id, 'Panel id');
    text(panel.type, 'Panel type');
    text(panel.title, 'Panel title');
    if (ids.has(panel.id)) throw new Error('Panel ids must be unique.');
    ids.add(panel.id);
    for (const key of ['layoutId', 'treeId']) if (panel[key] !== undefined) text(panel[key], key);
    if (panel.cameraTopic !== undefined && typeof panel.cameraTopic !== 'string')
      throw new Error('Invalid camera topic.');
  }
  if (
    raw.tileOrder !== undefined &&
    (!Array.isArray(raw.tileOrder) || raw.tileOrder.some((id: unknown) => typeof id !== 'string'))
  )
    throw new Error('Invalid tile order.');
  if (raw.layout !== undefined) {
    const geometry = record(raw.layout, 'Geometry');
    if (geometry.version !== undefined && geometry.version !== 2)
      throw new Error('Unsupported workspace geometry version.');
    if (geometry.version === 2) {
      const seen = new Set<string>();
      const visit = (value: unknown, depth = 0): void => {
        if (depth > 32) throw new Error('Workspace geometry is too deeply nested.');
        if (value === null && depth === 0) return;
        const node = record(value, 'Workspace tile or split');
        if (node.type === 'tile') {
          if (!ids.has(node.id) || seen.has(node.id)) throw new Error('Invalid or duplicate tile reference.');
          seen.add(node.id);
        } else if (
          node.type === 'split' &&
          ['x', 'y'].includes(node.axis) &&
          typeof node.ratio === 'number' &&
          node.ratio > 0 &&
          node.ratio < 1
        ) {
          visit(node.first, depth + 1);
          visit(node.second, depth + 1);
        } else throw new Error('Invalid workspace geometry.');
      };
      visit(geometry.root);
    }
  }
  const result = normalizeSavedWorkspaceLayout(
    {
      ...raw,
      createdAt: raw.createdAt ?? new Date(0).toISOString(),
      updatedAt: raw.updatedAt ?? new Date(0).toISOString(),
    },
    false
  );
  if (!result || result.panels.length !== panels.length) throw new Error('Invalid workspace panels.');
  return {
    ...result,
    panels: result.panels.map((panel, index) => {
      const source = panels[index];
      if (isBuiltInPanelId(panel.type) && source.panelState !== undefined && !panel.panelState)
        throw new Error('Invalid built-in panel settings.');
      return {
        ...panel,
        initialTree: source.initialTree === undefined ? undefined : decodeTree(source.initialTree),
        panelState: isBuiltInPanelId(panel.type) ? panel.panelState : undefined,
        ...(source.visualization === undefined
          ? {}
          : { visualization: decodeImportedVisualization(source.visualization) }),
      };
    }),
  };
}
