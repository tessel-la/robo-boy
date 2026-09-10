import type { BehaviorTree } from '../behaviorTree/types';
import type { BehaviorTreeAgentCheckpoint } from '../behaviorTree/agent/types';
import type { CustomGamepadLayout } from '../customGamepad/types';
import type { RosOperation } from '../../utils/rosOperations';
import type { AssistantProviderId } from './providers/types';
import type { RosActionValidationIssue } from './tools/rosActionValidator';

export type { AssistantProviderId };

export interface AssistantSettings {
  provider: AssistantProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  systemContext: string;
  robotContext: string;
  ollamaUseBackendHost: boolean;
}

export interface AssistantAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'text' | 'image';
  /** Text for `text`; base64 without the data-URL prefix for `image`. */
  content: string;
}

/** In-memory conversation turn. `checkpoint` lets "edit from here"/"repeat" restore whichever
 * document (BT tree, etc.) was active when the turn was sent — mirrors the former BT-agent's
 * per-message checkpoint, generalized beyond a single BT bridge. */
export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: AssistantAttachment[];
  contextChipIds: string[];
  /** Human-readable snapshot of explicitly tagged resources for this turn. Kept on the in-memory
   * message so tags remain visible even if the composer pin is removed later. */
  contextTags?: Array<{ id: string; label: string; mention?: string; source: AssistantContextSourceKind }>;
  checkpoint: BehaviorTreeAgentCheckpoint | null;
  createdAt: number;
  /** Present on an assistant-role message that carries a structured proposal (Pad, BT, or ROS
   * action) so AssistantPanel can render the matching accept/run/save controls inline. */
  response?: AssistantResponse;
  /** Set once the user has acted on `response`, so the controls render as resolved instead of
   * offering the same action twice. */
  resolution?: 'applied' | 'saved' | 'rejected' | 'ran' | 'failed';
  /** `connectionGeneration` captured when a `rosAction` proposal was created — read by the guard
   * at confirm-time, not re-read live, so a reconnect between proposal and click is caught. */
  proposedAtGeneration?: number;
  /** What was actually sent with the turn that produced this message, rendered as a collapsed
   * "Context used" disclosure under the reply. This is how provenance stays visible without
   * cluttering the composer with pre-declared chips (see docs/ai-assistant.md). */
  contextUsed?: AssistantContextUsage[];
}

export interface AssistantContextUsage {
  label: string;
  source: AssistantContextSourceKind;
  /** Seconds between the data being fetched and the turn being sent. */
  ageSeconds: number;
  stale?: boolean;
}

/** The subset of a message actually persisted to localStorage — never attachments (large,
 * ephemeral) and never a checkpoint (tied to a specific in-memory document instance). */
export interface StoredAssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export type AssistantContextSourceKind = 'workspace' | 'ros' | 'tf' | 'rosout' | 'pad' | 'behaviorTree' | 'manual';

/** A single "what the assistant is looking at" chip shown in the composer. Every chip carries its
 * own provenance/freshness so context is never applied silently — see docs/ai-assistant.md. */
export interface AssistantContextChip {
  id: string;
  label: string;
  /** How the resource is written as an `@` mention in the prompt, when that differs from the
   * chip's type-prefixed label. Defaults to `label`. */
  mention?: string;
  source: AssistantContextSourceKind;
  automatic: boolean;
  fetchedAt: number;
  /** `useRos().connectionGeneration` at fetch time, when the chip's data came from a live ROS
   * call. A chip whose generation no longer matches the current connection is marked stale. */
  generation?: number;
  stale?: boolean;
  value: unknown;
}

export interface WorkspaceSnapshotPanel {
  id: string;
  type: string;
  title: string;
  selected?: boolean;
  /** Host-owned configuration only. External-panel iframe state is never read through this field. */
  configuration?: Record<string, unknown>;
}

export interface WorkspaceLayoutContext {
  id: string | null;
  title: string;
  panels: WorkspaceSnapshotPanel[];
  layout?: unknown;
}

/** Bounded, serializable "what's open right now" snapshot computed by MainControlView — the
 * assistant never reaches into workspace state directly (see docs/architecture.md's dependency
 * direction: feature modules don't import application-shell state). */
export interface WorkspaceSnapshot {
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  openPanels: WorkspaceSnapshotPanel[];
  viewMode?: string;
  workspaceMode?: 'desktop' | 'mobile-single' | 'mobile-split' | 'standard';
  selectedPadLayoutId: string | null;
  openBehaviorTreeId: string | null;
  currentLayout?: WorkspaceLayoutContext;
  savedLayouts: WorkspaceLayoutContext[];
  fetchedAt: number;
}

/**
 * Everything the assistant gathers by itself for a turn. This is never surfaced as removable
 * chips: auto-context is always on, so there is nothing for a user to accidentally switch off and
 * then be unable to restore. Only explicit `@`/`+` pins are user-managed.
 */
export interface AssistantAutoContext {
  workspace: WorkspaceSnapshot;
  ros?: {
    resources: unknown;
    fetchedAt: number;
    generation: number;
    stale: boolean;
  };
  openBehaviorTree?: { name: string; tree: unknown };
  selectedBehaviorTreeNodes?: unknown;
  selectedPad?: { name: string; layout: CustomGamepadLayout };
  padLibrary: Array<{ id: string; name: string; componentCount: number; isDefault: boolean }>;
  behaviorTreeLibrary: Array<{ id: string; name: string; nodeCount: number }>;
  interfaceSchemas?: {
    topics: Record<string, unknown>;
    services: Record<string, unknown>;
    actions: Record<string, unknown>;
  };
}

/** Registered by a mounted BehaviorTreePanel so the global assistant can preview/accept BT edits
 * through the panel's own, already-tested diff/canvas-overlay/checkpoint machinery instead of
 * reimplementing it. Formalizes the seven-callback contract BehaviorTreePanel already passed to
 * the old embedded BehaviorTreeAgentPanel. */
export interface BehaviorTreeAssistantBridge {
  panelId: string;
  label: string;
  getCurrentTree(): BehaviorTree | null;
  getSelectedTreeContext(): BehaviorTree | null;
  getPreviewTree(): BehaviorTree | null;
  captureCheckpoint(): BehaviorTreeAgentCheckpoint | null;
  applyPreview(tree: BehaviorTree | null): void;
  restoreCheckpoint(checkpoint: BehaviorTreeAgentCheckpoint): void;
  notify(notice: { type: 'success' | 'error'; title: string; message: string }): void;
}

export interface PadValidationIssue {
  componentId: string;
  componentLabel: string;
  severity: 'error' | 'warning';
  message: string;
}

// --- Assistant tool-call output (a plain, versioned JSON discriminated union — see
// docs/ai-assistant.md and plan §3.12 for why this is not provider-native function calling). ---

export interface AssistantExplanation {
  kind: 'explanation';
  message: string;
}

export interface AssistantClarification {
  kind: 'clarification';
  question: string;
  suggestions?: string[];
}

export interface AssistantBehaviorTreeProposal {
  kind: 'behaviorTree';
  tree: BehaviorTree;
}

export interface AssistantPadProposal {
  kind: 'padProposal';
  layout: CustomGamepadLayout;
  issues: PadValidationIssue[];
}

export interface AssistantRosActionProposal {
  kind: 'rosAction';
  operation: RosOperation;
  rationale: string;
  /** Existence/type-match issues against the last-known ROS discovery snapshot — populated by
   * GlobalAssistant right after parsing, before the message is ever shown. An empty array can
   * mean either "validated clean" or "no discovery snapshot was available to check against";
   * AssistantPanel treats both alike (nothing to warn about) since there is nothing more to say
   * without a robot connection to check against. */
  issues: RosActionValidationIssue[];
}

export type AssistantResponse =
  | AssistantExplanation
  | AssistantClarification
  | AssistantBehaviorTreeProposal
  | AssistantPadProposal
  | AssistantRosActionProposal;

export interface OpenAssistantOptions {
  /** Pin a specific, currently-mounted BehaviorTreePanel as this turn's BT context — used by the
   * panel's "Create tree with AI" button / Ctrl+I so it opens the one global conversation instead
   * of starting a second one. */
  pinBehaviorTreePanelId?: string;
}
