import type { WorkspaceSnapshot } from '../types';

export interface BuildWorkspaceSnapshotInput {
  connectionStatus: WorkspaceSnapshot['connectionStatus'];
  panels: Array<{ id: string; type: string; title: string }>;
  selectedPadLayoutId: string | null;
  openBehaviorTreeId: string | null;
}

/** Pure, serializable snapshot builder. MainControlView owns the underlying state (open panels,
 * selection); this only shapes it into the bounded object the assistant is allowed to read
 * automatically (see docs/ai-assistant.md's capability matrix). No new persisted state, no
 * polling — freshness is just React re-render freshness. */
export const buildWorkspaceSnapshot = (input: BuildWorkspaceSnapshotInput): WorkspaceSnapshot => ({
  connectionStatus: input.connectionStatus,
  openPanels: input.panels.map(panel => ({ id: panel.id, type: panel.type, title: panel.title })),
  selectedPadLayoutId: input.selectedPadLayoutId,
  openBehaviorTreeId: input.openBehaviorTreeId,
  fetchedAt: Date.now(),
});
