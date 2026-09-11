import type { WorkspaceSnapshot } from '../types';

export interface BuildWorkspaceSnapshotInput {
  connectionStatus: WorkspaceSnapshot['connectionStatus'];
  panels: WorkspaceSnapshot['openPanels'];
  viewMode?: string;
  workspaceMode?: WorkspaceSnapshot['workspaceMode'];
  selectedPadLayoutId: string | null;
  openBehaviorTreeId: string | null;
  currentLayout?: WorkspaceSnapshot['currentLayout'];
  savedLayouts?: WorkspaceSnapshot['savedLayouts'];
}

/** Pure, serializable snapshot builder. MainControlView owns the underlying state (open panels,
 * selection); this only shapes it into the bounded object the assistant is allowed to read
 * automatically (see docs/ai-assistant.md's capability matrix). No new persisted state, no
 * polling — freshness is just React re-render freshness. */
export const buildWorkspaceSnapshot = (input: BuildWorkspaceSnapshotInput): WorkspaceSnapshot => ({
  connectionStatus: input.connectionStatus,
  openPanels: input.panels.map(panel => ({ ...panel })),
  ...(input.viewMode ? { viewMode: input.viewMode } : {}),
  ...(input.workspaceMode ? { workspaceMode: input.workspaceMode } : {}),
  selectedPadLayoutId: input.selectedPadLayoutId,
  openBehaviorTreeId: input.openBehaviorTreeId,
  ...(input.currentLayout ? { currentLayout: input.currentLayout } : {}),
  savedLayouts: input.savedLayouts ?? [],
  fetchedAt: Date.now(),
});
