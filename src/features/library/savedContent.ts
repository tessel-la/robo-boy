import { loadGamepadLibrary, getGamepadLayout, deleteCustomGamepad } from '../customGamepad/gamepadStorage';
import { listBehaviorTrees, loadBehaviorTree, deleteBehaviorTree } from '../behaviorTree/storage/treeStorage';
import { getLibraryTree } from './runtime';
import { validateLibraryPackage, type LibraryPackage } from './content';
import { getVisualizationStateForKey } from '../../utils/visualizationState';
import {
  visualizationStorageKey,
  normalizeSavedWorkspaceLayout,
  type SavedWorkspaceLayout,
  type ExportedWorkspacePanel,
} from '../workspace/documents';
import type { ContentDocument } from './packages';
export interface SavedContent {
  id: string;
  title: string;
  package: LibraryPackage;
  padId?: string;
  treeId?: string;
  scope?: string;
  workspace?: { key: string; id: string };
}
export function packageSavedWorkspace(layout: SavedWorkspaceLayout, scope?: string): LibraryPackage {
  const documents: ContentDocument[] = [];
  const pads = new Map<string, string>();
  const trees = new Map<string, string>();
  const panels = layout.panels.map(panel => {
    const result: ExportedWorkspacePanel = { ...panel, approvedRosTopics: undefined };
    if (panel.type === 'pad' && panel.layoutId) {
      const item = getGamepadLayout(panel.layoutId);
      if (!item) throw new Error(`Missing Pad ${panel.layoutId}.`);
      let id = pads.get(panel.layoutId);
      if (!id) {
        id = `pad/${pads.size}`;
        pads.set(panel.layoutId, id);
        documents.push({ id, kind: 'pad', formatVersion: 1, data: item.layout });
      }
      result.layoutId = id;
    }
    const tree =
      panel.initialTree ?? (panel.treeId ? (getLibraryTree(panel.treeId) ?? loadBehaviorTree(panel.treeId)) : null);
    if (panel.type === 'behaviorTree' && tree) {
      let id = trees.get(tree.id);
      if (!id) {
        id = `bt/${trees.size}`;
        trees.set(tree.id, id);
        documents.push({ id, kind: 'behaviorTree', formatVersion: 1, data: tree });
      }
      result.treeId = id;
      result.initialTree = undefined;
    }
    if (panel.type === '3d')
      result.visualization = getVisualizationStateForKey(visualizationStorageKey(panel.id, scope));
    return result;
  });
  documents.push({ id: 'workspace/main', kind: 'workspace', formatVersion: 1, data: { ...layout, panels } });
  return validateLibraryPackage({
    schemaVersion: 1,
    id: 'local.workspace',
    version: '1.0.0',
    title: layout.title,
    entryDocument: 'workspace/main',
    documents,
  });
}
export function readSavedContent(): { items: SavedContent[]; warnings: string[] } {
  const items: SavedContent[] = [];
  const warnings: string[] = [];
  const add = (title: string, operation: () => SavedContent) => {
    try {
      items.push(operation());
    } catch (error) {
      warnings.push(`${title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  for (const item of loadGamepadLibrary().filter(item => !item.isDefault))
    add(item.name, () => ({
      id: `saved-pad:${item.id}`,
      title: item.name,
      padId: item.id,
      package: validateLibraryPackage({
        schemaVersion: 1,
        id: 'local.pad',
        version: '1.0.0',
        title: item.name,
        entryDocument: 'pad/main',
        documents: [{ id: 'pad/main', kind: 'pad', formatVersion: 1, data: item.layout }],
      }),
    }));
  for (const item of listBehaviorTrees())
    add(item.tree.name, () => ({
      id: `saved-tree:${item.tree.id}`,
      title: item.tree.name,
      treeId: item.tree.id,
      package: validateLibraryPackage({
        schemaVersion: 1,
        id: 'local.tree',
        version: '1.0.0',
        title: item.tree.name,
        entryDocument: 'bt/main',
        documents: [{ id: 'bt/main', kind: 'behaviorTree', formatVersion: 1, data: item.tree }],
      }),
    }));
  const prefix = 'robo-boy-desktop-workspace-saved-layouts-v1';
  for (const key of Object.keys(localStorage).filter(
    key => key === prefix || key.startsWith(`${prefix}:connection:`)
  )) {
    const scope = key === prefix ? undefined : key.slice(`${prefix}:connection:`.length);
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? '[]');
      if (!Array.isArray(value)) throw new Error('Unrecognized saved layouts.');
      for (const layout of value)
        add(layout.title ?? 'Workspace', () => ({
          id: `saved-workspace:${key}:${layout.id}`,
          title: layout.title,
          scope,
          workspace: { key, id: layout.id },
          package: packageSavedWorkspace(layout, scope),
        }));
    } catch (error) {
      warnings.push(`Saved workspaces could not be read: ${String(error)}`);
    }
  }
  return { items, warnings };
}

/** Mutations use the authoring stores; imported templates are removed by collection metadata. */
export function removeSavedContent(item: SavedContent): void {
  if (item.workspace) {
    const { key, id } = item.workspace;
    if (!/^robo-boy-desktop-workspace-saved-layouts-v1(?::connection:.+)?$/.test(key))
      throw new Error('Unknown layout storage.');
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(raw) || raw.some(layout => !normalizeSavedWorkspaceLayout(layout, false)))
      throw new Error('Unrecognized saved layouts. Original data was preserved.');
    localStorage.setItem(key, JSON.stringify(raw.filter(layout => layout.id !== id)));
    window.dispatchEvent(new Event('robo-boy-workspaces-changed'));
    return;
  }
  if (item.padId) {
    // Saved and current layouts retain Pad IDs. Do not leave a dangling reference.
    for (const key of Object.keys(localStorage).filter(key =>
      /^robo-boy-(desktop-workspace-(saved-layouts|panels)|mobile-workspace-panels)-v1(?::connection:|$)/.test(key)
    )) {
      let value;
      try {
        value = JSON.parse(localStorage.getItem(key) ?? '[]');
      } catch {
        throw new Error('Could not check layouts using this Pad. Original data was preserved.');
      }
      if (!Array.isArray(value))
        throw new Error('Could not check layouts using this Pad. Original data was preserved.');
      const used = key.includes('saved-layouts')
        ? value.find(
            layout =>
              !Array.isArray(layout.panels) ||
              layout.panels.some((panel: { layoutId?: string }) => panel.layoutId === item.padId)
          )
        : value.some(panel => panel.layoutId === item.padId);
      if (used)
        throw new Error(
          `Used by ${typeof used === 'object' && used.title ? used.title : 'a layout'}. Remove the Pad from that layout first.`
        );
    }
    if (deleteCustomGamepad(item.padId)) return;
  } else if (item.treeId && deleteBehaviorTree(item.treeId)) return;
  throw new Error('Could not remove this item. Original data was preserved.');
}
