import { decodeImportedVisualization, decodeWorkspaceDocument } from './portableDocument';
import { collection, importError, parseContentJson, readContentFile, record, text } from '../library/json';
import { readContentPackage } from '../library/packages';
import { copyPads, decodePad } from '../customGamepad/portablePad';
import { GAMEPAD_STORAGE_EVENT, getGamepadLayout, prepareImportedPadStorage } from '../customGamepad/gamepadStorage';
import { createUuid } from '../../utils/uuid';
import { getConnectionStorageKey, readConnectionStorage } from '../../runtime/connectionStorage';
import { isBuiltInPanelId } from '../../panels/builtInPanels';
import { normalizeWorkspaceLayout, type WorkspaceLayoutNode } from '../../components/workspaceLayout';
import { normalizeVisualizationState, type VisualizationPanelState } from '../../utils/visualizationState';
import {
  normalizeSavedWorkspaceLayout,
  visualizationStorageKey,
  type SavedWorkspaceLayout,
  type ExportedWorkspacePanel,
} from './documents';
import type { CustomGamepadLayout } from '../customGamepad/types';

export const SAVED_WORKSPACE_LAYOUTS_KEY = 'robo-boy-desktop-workspace-saved-layouts-v1';
interface WorkspaceImport {
  layouts: SavedWorkspaceLayout[];
  pads: CustomGamepadLayout[];
  visualizations: Array<{ panelId: string; state: VisualizationPanelState }>;
  warnings: string[];
}
/** Prepare complete independent copies without writing any feature storage. */
export function planWorkspaceImport(source: string): WorkspaceImport {
  const value = parseContentJson(source);
  const pack = readContentPackage(value);
  let candidates: unknown[];
  let pads: CustomGamepadLayout[];
  const aliases = new Map<string, string>();
  if (pack) {
    if (
      pack.documents.find(doc => doc.id === pack.entryDocument)?.kind !== 'workspace' ||
      pack.documents.some(doc => !['pad', 'workspace'].includes(doc.kind))
    )
      throw new Error(
        'Workspace packages currently support workspace and Pad documents. Behavior Trees must be imported separately.'
      );
    pads = pack.documents
      .filter(doc => doc.kind === 'pad')
      .map(doc => {
        const pad = decodePad(doc.data);
        aliases.set(doc.id, pad.id);
        return pad;
      });
    candidates = pack.documents.filter(doc => doc.kind === 'workspace').map(doc => doc.data);
  } else if (Array.isArray(value)) {
    candidates = value;
    pads = [];
  } else {
    const bundle = record(value, 'Workspace bundle');
    if (bundle.version !== undefined && ![1, 2].includes(bundle.version))
      throw new Error('Unsupported workspace file version.');
    candidates = [...collection(bundle.layouts, 'Workspace layouts', 100)];
    pads = bundle.gamepads === undefined ? [] : collection(bundle.gamepads, 'Pads', 100).map(decodePad);
    if (bundle.version === 2 && bundle.currentWorkspace)
      candidates.unshift({
        ...record(bundle.currentWorkspace, 'Current workspace'),
        id: 'current',
        title: 'Imported workspace',
      });
  }
  collection(candidates, 'Workspace layouts', 100);
  if (!candidates.length) throw new Error('No workspace layouts to import.');
  if (new Set(pads.map(pad => pad.id)).size !== pads.length) throw new Error('Pad ids must be unique.');
  const warnings = new Set<string>();
  // Old bundles omitted built-in Pads. Freeze a device-local definition as an independent copy.
  if (!pack)
    for (const candidate of candidates) {
      const raw = record(candidate, 'Workspace layout');
      for (const value of collection(raw.panels, 'Workspace panels', 100)) {
        const panel = record(value, 'Workspace panel');
        if (panel.type !== 'pad' || !panel.layoutId || pads.some(pad => pad.id === panel.layoutId)) continue;
        const installed = getGamepadLayout(panel.layoutId);
        if (!installed) throw new Error(`Missing Pad: ${panel.layoutId}. Include its JSON in the workspace bundle.`);
        if (!pads.some(pad => pad.id === installed.layout.id)) pads.push(decodePad(installed.layout));
        aliases.set(panel.layoutId, installed.layout.id);
        warnings.add('A Pad omitted by this legacy file will be copied from the version installed on this device.');
      }
    }
  const copies = copyPads(pads);
  const padReferences = pack
    ? Object.fromEntries([...aliases].map(([alias, id]) => [alias, copies.idMap[id]]))
    : { ...copies.idMap, ...Object.fromEntries([...aliases].map(([alias, id]) => [alias, copies.idMap[id]])) };
  const visualizations: WorkspaceImport['visualizations'] = [];
  const layouts = candidates.map(candidate => {
    const raw = record(candidate, 'Workspace layout');
    const normalized = decodeWorkspaceDocument(raw);
    const rawPanels = normalized.panels;
    const panelMap = new Map(rawPanels.map(panel => [panel.id, `workspace-panel-${createUuid()}`]));
    const panels = normalized.panels.map((panel, index) => {
      const id = panelMap.get(panel.id)!;
      if (rawPanels[index].visualization !== undefined && panel.type === '3d')
        visualizations.push({ panelId: id, state: decodeImportedVisualization(rawPanels[index].visualization) });
      if (!isBuiltInPanelId(panel.type)) {
        warnings.add(
          'External panel settings and ROS approvals are excluded. Required panels must already be installed and enabled.'
        );
        panel = { ...panel, panelState: undefined };
      }
      const layoutId =
        panel.layoutId && Object.prototype.hasOwnProperty.call(padReferences, panel.layoutId)
          ? padReferences[panel.layoutId]
          : undefined;
      if (panel.type === 'pad' && panel.layoutId && !layoutId)
        throw new Error(`Missing packaged Pad: ${panel.layoutId}.`);
      return { ...panel, id, layoutId: layoutId ?? panel.layoutId };
    });
    const remap = (node: WorkspaceLayoutNode | null): WorkspaceLayoutNode | null =>
      node === null
        ? null
        : node.type === 'tile'
          ? { ...node, id: panelMap.get(node.id)! }
          : { ...node, first: remap(node.first)!, second: remap(node.second)! };
    const tileOrder = normalized.tileOrder.map(id => panelMap.get(id)!);
    return {
      ...normalized,
      id: `workspace-layout-${createUuid()}`,
      panels,
      tileOrder,
      layout: normalizeWorkspaceLayout({ version: 2, root: remap(normalized.layout.root) }, tileOrder),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
  return { layouts, pads: copies.pads, visualizations, warnings: [...warnings] };
}
/** Existing stores remain authoritative. Write fresh resources first, expose layouts last.
 * Roll back completed writes on failure; never overwrite a value changed by another writer.
 * This is a synchronous guarded batch, not an IndexedDB crash-atomic transaction. */
export function commitWorkspaceImport(plan: WorkspaceImport, storageScope?: string): SavedWorkspaceLayout[] {
  const savedRaw = readConnectionStorage(SAVED_WORKSPACE_LAYOUTS_KEY, storageScope);
  const saved: unknown = savedRaw ? parseContentJson(savedRaw) : [];
  if (!Array.isArray(saved) || saved.some(item => !normalizeSavedWorkspaceLayout(item, false)))
    throw new Error('Unrecognized saved workspace data. Recover/export it before importing.');
  const key = getConnectionStorageKey(SAVED_WORKSPACE_LAYOUTS_KEY, storageScope);
  const result = [...(saved as SavedWorkspaceLayout[]), ...plan.layouts];
  const writes = [
    ...(plan.pads.length ? [prepareImportedPadStorage(plan.pads)] : []),
    ...plan.visualizations.map(item => ({
      key: visualizationStorageKey(item.panelId, storageScope),
      before: null as string | null,
      after: JSON.stringify(item.state),
    })),
    { key, before: localStorage.getItem(key), after: JSON.stringify(result) },
  ];
  const completed: typeof writes = [];
  try {
    for (const write of writes) {
      if (localStorage.getItem(write.key) !== write.before)
        throw new Error('Saved content changed during import. Please try again.');
      localStorage.setItem(write.key, write.after);
      completed.push(write);
    }
  } catch (error) {
    for (const write of completed.reverse())
      if (localStorage.getItem(write.key) === write.after) {
        if (write.before === null) localStorage.removeItem(write.key);
        else localStorage.setItem(write.key, write.before);
      }
    throw error;
  }
  if (plan.pads.length) window.dispatchEvent(new CustomEvent(GAMEPAD_STORAGE_EVENT));
  return result;
}
export async function importWorkspaceFile(
  file: File,
  storageScope: string | undefined,
  signal: AbortSignal
): Promise<SavedWorkspaceLayout[] | null> {
  const { reviewImport, showImportError } = await import('../library/ImportReview');
  try {
    const plan = planWorkspaceImport(await readContentFile(file, signal));
    const accepted = await reviewImport(
      {
        title: 'Import workspace layouts',
        items: [
          ...plan.layouts.map(layout => `${layout.title} · ${layout.panels.length} panels`),
          ...plan.pads.map(pad => `${pad.name} · Pad`),
        ],
        details: [
          'Save these layouts. Your current workspace stays open.',
          ...plan.warnings,
        ],
        action: 'Import',
      },
      signal
    );
    return accepted && !signal.aborted ? commitWorkspaceImport(plan, storageScope) : null;
  } catch (error) {
    if (!signal.aborted) await showImportError(importError(error), signal);
    return null;
  }
}
