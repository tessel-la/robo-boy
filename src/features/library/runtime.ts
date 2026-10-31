import type { GamepadLibraryItem } from '../customGamepad/types';
import type { BehaviorTree } from '../behaviorTree/types';
import type { LibraryCollection } from './store';
import type { ContentDocument } from './packages';
const cloneContent = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
import { createUuid } from '../../utils/uuid';
import { normalizeWorkspaceLayout, type WorkspaceLayoutNode } from '../../components/workspaceLayout';
import type { SavedWorkspaceLayout, ExportedWorkspacePanel } from '../workspace/documents';
let collections: LibraryCollection[] = [];
export const libraryDocumentId = (collectionId: string, docId: string) => `library:${collectionId}:${docId}`;
export function setLibrarySnapshot(next: LibraryCollection[]) {
  collections = next;
  window.dispatchEvent(new Event('robo-boy-gamepads-changed'));
  window.dispatchEvent(new Event('robo-boy-behavior-trees-changed'));
  window.dispatchEvent(new Event('robo-boy-library-ready'));
}
export function getLibraryPads(): GamepadLibraryItem[] {
  return collections.flatMap(item =>
    item.package.documents
      .filter(doc => doc.kind === 'pad')
      .map(doc => {
        const layout = cloneContent(doc.data) as GamepadLibraryItem['layout'];
        const id = libraryDocumentId(item.id, doc.id);
        return {
          id,
          name: layout.name,
          description: `${item.title} · Library template`,
          isDefault: true,
          layout: { ...layout, id },
        };
      })
  );
}
export function getLibraryTrees(): BehaviorTree[] {
  return collections
    .filter(item => !item.archivedAt)
    .flatMap(item =>
      item.package.documents
        .filter(doc => doc.kind === 'behaviorTree')
        .map(doc => ({
          ...(cloneContent(doc.data) as BehaviorTree),
          id: libraryDocumentId(item.id, doc.id),
        }))
    );
}
export function getLibraryTree(id: string): BehaviorTree | null {
  for (const item of collections)
    for (const doc of item.package.documents)
      if (doc.kind === 'behaviorTree' && libraryDocumentId(item.id, doc.id) === id)
        return cloneContent(doc.data) as BehaviorTree;
  return null;
}
export interface LibraryOpenRequest {
  id: string;
  kind: 'pad' | 'behaviorTree' | 'workspace';
  padId?: string;
  tree?: BehaviorTree;
  workspace?: SavedWorkspaceLayout;
  visualizations?: Array<{ panelId: string; state: NonNullable<ExportedWorkspacePanel['visualization']> }>;
}
export function openLibraryDocument(item: LibraryCollection, document: ContentDocument): LibraryOpenRequest {
  const id = createUuid();
  if (document.kind === 'pad') return { id, kind: 'pad', padId: libraryDocumentId(item.id, document.id) };
  if (document.kind === 'behaviorTree')
    return { id, kind: 'behaviorTree', tree: cloneContent(document.data) as BehaviorTree };
  const original = cloneContent(document.data) as Omit<SavedWorkspaceLayout, 'panels'> & {
    panels: ExportedWorkspacePanel[];
  };
  const panelMap = new Map(original.panels.map(panel => [panel.id, `workspace-panel-${createUuid()}`]));
  const visualizations: NonNullable<LibraryOpenRequest['visualizations']> = [];
  const panels = original.panels.map(panel => {
    const newId = panelMap.get(panel.id)!;
    if (panel.visualization) visualizations.push({ panelId: newId, state: panel.visualization });
    const { visualization: _scene, ...portable } = panel;
    return {
      ...portable,
      id: newId,
      layoutId: panel.layoutId ? libraryDocumentId(item.id, panel.layoutId) : undefined,
      treeId: panel.treeId ? libraryDocumentId(item.id, panel.treeId) : undefined,
    };
  });
  const remap = (node: WorkspaceLayoutNode | null): WorkspaceLayoutNode | null =>
    !node
      ? null
      : node.type === 'tile'
        ? { ...node, id: panelMap.get(node.id)! }
        : { ...node, first: remap(node.first)!, second: remap(node.second)! };
  const tileOrder = original.tileOrder.map(value => panelMap.get(value)!);
  return {
    id,
    kind: 'workspace',
    workspace: {
      ...original,
      id: `workspace-layout-${createUuid()}`,
      panels,
      tileOrder,
      layout: normalizeWorkspaceLayout({ version: 2, root: remap(original.layout.root) }, tileOrder),
    },
    visualizations,
  };
}
