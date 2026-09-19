import type { AssistantCapability } from '../capabilities';
import type { WorkspaceSnapshot } from '../types';

/**
 * One change to the workspace the assistant may ask the app shell to make. Nothing here touches
 * the robot: panels, layouts and the Pad a panel shows are all local UI state that the user can
 * undo by hand, so the shell applies them straight away instead of asking for a second click.
 */
export type WorkspaceEditOperation =
  | { op: 'addPanel'; panelType: string; title?: string; cameraTopic?: string; padId?: string }
  | { op: 'removePanel'; panelId: string }
  | { op: 'setCameraTopic'; panelId: string; cameraTopic: string }
  | { op: 'setPanelPad'; panelId: string; padId: string }
  | { op: 'applyLayout'; layoutId: string }
  | { op: 'saveLayout'; title: string };

export interface WorkspaceEditResult {
  operation: WorkspaceEditOperation;
  ok: boolean;
  /** What happened, in the user's terms: "Added a Behavior tree panel" / "No panel with id …". */
  message: string;
}

export const WORKSPACE_CAPABILITY: AssistantCapability = {
  id: 'workspace-edit',
  summary: 'You can change the workspace yourself: add or remove panels, switch a camera panel\'s topic or a Pad panel\'s Pad, apply a saved layout, or save the current one.',
  detail: [
    'Do it with the workspace tool below instead of telling the user which menu to use. The change is applied at once and you report what changed.',
    'Panel types you can add are listed in the workspace context ("panelCatalog"); use the exact id.',
  ],
  invocations: ['add a behavior tree panel', 'remove the camera panel', 'load my inspection layout', 'save this layout as Teleop'],
  responseKind: 'workspaceEdit',
};

export const WORKSPACE_PROMPT_FRAGMENT = `## Workspace tool
When the user asks to change what is on screen — open/add/show a panel, close/remove one, change which camera topic or Pad a panel shows, load a saved layout, or save the current one — return
{"kind":"workspaceEdit","summary":"one sentence","operations":[...]}
with one or more of these operations, in order:
- {"op":"addPanel","panelType":"<id from panelCatalog>","title":"optional","cameraTopic":"/optional for camera panels","padId":"optional saved Pad id for pad panels"}
- {"op":"removePanel","panelId":"<id from openPanels>"}
- {"op":"setCameraTopic","panelId":"<camera panel id>","cameraTopic":"/image topic from the ROS graph"}
- {"op":"setPanelPad","panelId":"<pad panel id>","padId":"<saved Pad id>"}
- {"op":"applyLayout","layoutId":"<id from savedLayouts>"}
- {"op":"saveLayout","title":"name"}
Use only panel ids, panel types, Pad ids, layout ids and topics that appear in the supplied context. On a phone the workspace has at most two windows, so adding a panel replaces the active window.`;

const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Validates the model's raw operations into the typed union; anything malformed is dropped with
 * a reason so the user sees what the model got wrong instead of a silent no-op. */
export const parseWorkspaceEditOperations = (raw: unknown): { operations: WorkspaceEditOperation[]; rejected: string[] } => {
  const operations: WorkspaceEditOperation[] = [];
  const rejected: string[] = [];
  if (!Array.isArray(raw)) return { operations, rejected: ['The model returned no operations.'] };

  raw.slice(0, 20).forEach((entry, index) => {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const panelId = asString(item.panelId);
    switch (item.op) {
      case 'addPanel': {
        const panelType = asString(item.panelType);
        if (!panelType) return rejected.push(`Operation ${index + 1}: addPanel needs a panelType.`);
        operations.push({
          op: 'addPanel',
          panelType,
          ...(asString(item.title) ? { title: asString(item.title) } : {}),
          ...(asString(item.cameraTopic) ? { cameraTopic: asString(item.cameraTopic) } : {}),
          ...(asString(item.padId) ? { padId: asString(item.padId) } : {}),
        });
        return;
      }
      case 'removePanel':
        if (!panelId) return rejected.push(`Operation ${index + 1}: removePanel needs a panelId.`);
        return operations.push({ op: 'removePanel', panelId });
      case 'setCameraTopic': {
        const cameraTopic = asString(item.cameraTopic);
        if (!panelId || !cameraTopic) return rejected.push(`Operation ${index + 1}: setCameraTopic needs a panelId and a cameraTopic.`);
        return operations.push({ op: 'setCameraTopic', panelId, cameraTopic });
      }
      case 'setPanelPad': {
        const padId = asString(item.padId);
        if (!panelId || !padId) return rejected.push(`Operation ${index + 1}: setPanelPad needs a panelId and a padId.`);
        return operations.push({ op: 'setPanelPad', panelId, padId });
      }
      case 'applyLayout': {
        const layoutId = asString(item.layoutId);
        if (!layoutId) return rejected.push(`Operation ${index + 1}: applyLayout needs a layoutId.`);
        return operations.push({ op: 'applyLayout', layoutId });
      }
      case 'saveLayout': {
        const title = asString(item.title);
        if (!title) return rejected.push(`Operation ${index + 1}: saveLayout needs a title.`);
        return operations.push({ op: 'saveLayout', title });
      }
      default:
        rejected.push(`Operation ${index + 1}: unknown op "${String(item.op)}".`);
    }
  });
  return { operations, rejected };
};

/** Resolves a model-supplied panel type against the catalog, forgiving the display name
 * ("Behavior tree") and case, so a near miss still lands on the right panel. */
export const resolvePanelType = (requested: string, catalog: WorkspaceSnapshot['panelCatalog']): string | null => {
  const wanted = requested.trim().toLowerCase().replace(/[\s_-]+/g, '');
  const match = catalog.find(entry => entry.id.toLowerCase() === wanted || entry.name.toLowerCase().replace(/[\s_-]+/g, '') === wanted);
  return match?.id ?? null;
};

export const describeWorkspaceEditResults = (results: WorkspaceEditResult[]): string => {
  if (results.length === 0) return 'Nothing to change.';
  return results.map(result => `${result.ok ? '✓' : '✗'} ${result.message}`).join('\n');
};
