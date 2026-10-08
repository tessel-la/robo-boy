import {
  HOST_TOOL_DEFINITIONS,
  READ_ONLY_TOOL_DEFINITIONS,
  documentRevision,
  type HostTools,
  type HostToolResult,
} from './nativeTools';
import { parseContextReads } from './contextTool';
import { parseAssistantResponse } from '../responseParser';
import type { AssistantResponse } from '../types';
import type { BehaviorTreeResourceSchemas } from '../../behaviorTree/agent/types';
import type { CustomGamepadLayout, GamepadComponentConfig } from '../../customGamepad/types';
import { Validator } from '@cfworker/json-schema';
import type { AgentEvent } from '../runtime/session';
import { isJsonObject } from '../../../panels/types';
import { loadAgentHooks } from '../runtime/hooks';
import { AgentLimit } from '../runtime/session';

/** Effects are serialized, even when a provider emits parallel calls. This protects ROS api
 * node-handle locks, React state commits and document edits across every transport. */
export function createHostTools(host: {
  signal: AbortSignal;
  checkCurrent(): void;
  schemas(): BehaviorTreeResourceSchemas;
  validate(response: AssistantResponse): string[];
  execute(response: AssistantResponse): Promise<unknown>;
  present(response: AssistantResponse): void;
  document(kind: 'pad' | 'behaviorTree', id: string): unknown;
  progress(message: string): void;
  readOnly?: boolean;
  delegate?(task: string): Promise<unknown>;
  boundary?(): void;
  beforeTool?(): void;
  event?(type: AgentEvent['type'], label: string, status: AgentEvent['status'], detail?: string, id?: string): void;
  agentTool?(name: string, input: Record<string, unknown>): Promise<unknown>;
  saveDocument?(kind: 'pad' | 'behaviorTree', document: unknown, baseRevision?: string): Promise<unknown>;
  undoDocument?(checkpointId: string): Promise<unknown>;
  allowedTools?: readonly string[];
}): HostTools {
  let queue = Promise.resolve();
  const hooks = typeof localStorage === 'undefined' ? [] : loadAgentHooks().filter(hook => hook.enabled);
  let calls = 0;
  let failedSignature = '',
    failures = 0;
  const recoveryBoundary = () => {
    if (failures >= 3)
      throw new AgentLimit(
        'The same tool request failed three times. Completed changes are preserved. Correct the request or continue with new evidence.'
      );
  };
  const completed = new Map<string, HostToolResult>();
  const signatures = new Map<string, string>();
  let delegated = 0;
  const definitions = (host.readOnly ? READ_ONLY_TOOL_DEFINITIONS : HOST_TOOL_DEFINITIONS).filter(
    tool => !host.allowedTools || host.allowedTools.includes(tool.name)
  );
  const check = () => {
    host.signal.throwIfAborted();
    host.checkCurrent();
  };
  const execute = async (toolName: string, input: unknown, callId: string): Promise<HostToolResult> => {
    check();
    host.beforeTool?.();
    if (++calls > (host.readOnly ? 30 : 150)) throw new Error('This turn reached its tool allowance.');
    const definition = definitions.find(tool => tool.name === toolName);
    if (!definition) throw new Error('Unknown host tool or unavailable in this read-only subagent.');
    const block = hooks.find(hook => hook.tool === toolName && hook.when === 'before' && hook.action === 'block');
    if (block) throw new Error(`Blocked by operator policy: ${block.message}`);
    if (!isJsonObject(input)) throw new Error('Tool input must be a finite, bounded JSON object.');
    if (JSON.stringify(input).length > 256 * 1024) throw new Error('Tool input is too large.');
    const validation = new Validator(definition.inputSchema).validate(input);
    if (!validation.valid)
      throw new Error(
        `Invalid ${toolName} arguments: ${validation.errors
          .map(error => error.error)
          .slice(0, 4)
          .join(' ')}`
      );
    let data = input as Record<string, unknown>;
    const signature = JSON.stringify({ toolName, input });
    if (signatures.has(callId) && signatures.get(callId) !== signature)
      throw new Error('A tool call id was reused with different arguments.');
    signatures.set(callId, signature);
    host.progress(`Running ${toolName}…`);
    host.event?.('tool', toolName, 'running', undefined, callId);
    if (completed.has(callId)) return completed.get(callId)!;
    if (toolName === 'delegate_read') {
      if (!host.delegate || ++delegated > 2)
        throw new Error('Use at most two focused read-only investigations per task.');
      const result = { ok: true, value: await host.delegate(String(data.task)) };
      check();
      completed.set(callId, result);
      return result;
    }
    if (toolName === 'save_document') {
      if (!host.saveDocument) throw new Error('This host cannot save authoring documents.');
      const result = {
        ok: true,
        value: await host.saveDocument(
          data.kind as 'pad' | 'behaviorTree',
          data.document,
          data.baseRevision as string | undefined
        ),
      };
      completed.set(callId, result);
      return result;
    }
    if (toolName === 'undo_document') {
      if (!host.undoDocument) throw new Error('This host cannot restore document checkpoints.');
      const result = { ok: true, value: await host.undoDocument(String(data.checkpointId)) };
      completed.set(callId, result);
      return result;
    }
    if (toolName === 'patch_tree') {
      if (!host.saveDocument) throw new Error('This host cannot save tree documents.');
      const tree = host.document('behaviorTree', String(data.id)) as
        | { nodes: Array<{ id: string }>; edges: Array<{ id: string; source: string; target: string }> }
        | undefined;
      if (!tree || (await documentRevision(tree)) !== data.baseRevision)
        throw new Error('The tree changed. Read its latest revision.');
      const nodes = new Map(tree.nodes.map(node => [node.id, node]));
      const edges = new Map(tree.edges.map(edge => [edge.id, edge]));
      for (const id of data.removeNodeIds as string[]) {
        if (!nodes.delete(id)) throw new Error('Unknown node id.');
      }
      for (const id of data.removeEdgeIds as string[]) {
        if (!edges.delete(id)) throw new Error('Unknown edge id.');
      }
      for (const node of data.upsertNodes as Array<{ id: string }>) {
        if (!node.id) throw new Error('Every node needs its id.');
        nodes.set(node.id, node);
      }
      for (const edge of data.upsertEdges as Array<{ id: string; source: string; target: string }>) {
        if (!edge.id) throw new Error('Every edge needs its id.');
        edges.set(edge.id, edge);
      }
      const value = await host.saveDocument(
        'behaviorTree',
        { ...tree, nodes: [...nodes.values()], edges: [...edges.values()] },
        String(data.baseRevision)
      );
      const result = { ok: true, value };
      completed.set(callId, result);
      return result;
    }
    if (
      [
        'spawn_agent',
        'wait_agent',
        'cancel_agent',
        'message_agent',
        'inspect_agent',
        'update_plan',
        'ask_user',
        'read_skill',
        'read_integrations',
        'read_integration',
        'call_integration',
        'start_monitor',
        'read_monitors',
        'stop_monitor',
      ].includes(toolName)
    ) {
      if (!host.agentTool) throw new Error('This host does not support agent coordination.');
      return { ok: true, value: await host.agentTool(toolName, data) };
    }
    const read =
      toolName.startsWith('read_') && !['read_document', 'read_skill'].includes(toolName)
        ? parseContextReads([{ ...data, kind: toolName.slice(5) }])[0]
        : null;
    if (read) {
      const result = await host.execute({ kind: 'contextRequest', reads: [read], summary: '' });
      check();
      const entries = result as Array<{ ok: boolean; error?: string; image?: HostToolResult['image'] }>;
      if (Array.isArray(entries) && entries[0]?.ok === false) return { ok: false, error: entries[0].error };
      return {
        ok: true,
        value: Array.isArray(entries) ? entries.map(entry => ({ ...entry, image: undefined })) : result,
        image: entries?.[0]?.image,
      };
    }
    if (toolName === 'read_document') {
      if (!['pad', 'behaviorTree'].includes(String(data.kind)) || typeof data.id !== 'string')
        throw new Error('Read a Pad or behavior tree by catalog id.');
      const document = host.document(data.kind as 'pad' | 'behaviorTree', data.id);
      if (!document) throw new Error('No document with this id exists. Read the workspace catalog first.');
      return { ok: true, value: { document, revision: await documentRevision(document) } };
    }
    if (toolName === 'patch_pad') {
      if (
        typeof data.id !== 'string' ||
        typeof data.baseRevision !== 'string' ||
        !Array.isArray(data.upsertComponents) ||
        !Array.isArray(data.removeComponentIds) ||
        data.upsertComponents.length > 64 ||
        data.removeComponentIds.length > 64
      )
        throw new Error('Invalid targeted Pad edit.');
      const current = host.document('pad', data.id) as CustomGamepadLayout | undefined;
      if (!current || (await documentRevision(current)) !== data.baseRevision)
        throw new Error('The Pad changed. Read the document again before editing.');
      const components = new Map(current.components.map(component => [component.id, component]));
      for (const id of data.removeComponentIds) {
        if (typeof id !== 'string' || !components.has(id)) throw new Error('Cannot remove an unknown component.');
        components.delete(id);
      }
      for (const component of data.upsertComponents) {
        if (!component || typeof component.id !== 'string')
          throw new Error('Every replacement component needs its id.');
        components.set(component.id, component as GamepadComponentConfig);
      }
      data = { layout: { ...current, components: [...components.values()] }, baseRevision: data.baseRevision };
    }
    if (toolName === 'propose_pad' || toolName === 'patch_pad') {
      const id = (data.layout as { id?: unknown })?.id;
      const current = typeof id === 'string' ? host.document('pad', id) : undefined;
      if (current && (typeof data.baseRevision !== 'string' || (await documentRevision(current)) !== data.baseRevision))
        throw new Error(
          'This Pad changed or its revision was not supplied. Retrieve the current document and rebase your edit. Nothing was applied.'
        );
      if (!current && data.baseRevision !== undefined) throw new Error('The original Pad no longer exists.');
    }
    const kinds: Record<string, string> = {
      edit_workspace: 'workspaceEdit',
      propose_pad: 'padProposal',
      patch_pad: 'padProposal',
      propose_tree: 'tree',
      propose_operation: 'rosAction',
    };
    const payload =
      toolName === 'propose_tree'
        ? { ...(data.tree as Record<string, unknown>), kind: 'tree' }
        : { ...data, kind: kinds[toolName] };
    const candidate = parseAssistantResponse(JSON.stringify(payload), host.schemas());
    const issues = host.validate(candidate);
    if (issues.length) throw new Error(`Nothing applied: ${issues.join(' ')}`);
    if (toolName === 'patch_pad' && candidate.kind === 'padProposal' && host.saveDocument) {
      const result = { ok: true, value: await host.saveDocument('pad', candidate.layout, candidate.baseRevision) };
      completed.set(callId, result);
      return result;
    }
    const mutationKey = callId;
    if (completed.has(mutationKey)) return completed.get(mutationKey)!;
    const value = await host.execute(candidate);
    check();
    if (candidate.kind !== 'workspaceEdit') host.present(candidate);
    const result: HostToolResult = {
      ok:
        candidate.kind !== 'workspaceEdit' ||
        (!candidate.rejected.length && !candidate.results?.some(result => !result.ok)),
      value: value ?? { status: 'awaiting_operator_review', robotExecuted: false },
    };
    completed.set(mutationKey, result);
    return result;
  };
  return {
    definitions,
    ...(host.readOnly ? { scope: 'read-only' as const } : {}),
    drain: async () => {
      await queue;
    },
    checkpoint: recoveryBoundary,
    execute: (toolName, input, callId) => {
      const operation = queue.then(async () => {
        try {
          const result = await execute(toolName, input, callId);
          check();
          const notes = hooks
            .filter(
              hook =>
                hook.tool === toolName &&
                hook.action === 'note' &&
                ['before', result.ok ? 'success' : 'error'].includes(hook.when)
            )
            .map(hook => hook.message);
          if (notes.length) {
            result.notes = notes;
            host.event?.('state', 'Tool policy reminder', 'done', notes.join('\n'));
          }
          if (JSON.stringify({ ...result, image: undefined }).length > 128 * 1024)
            throw new Error('Tool result exceeds 128 KiB. Read a specific document/resource instead.');
          host.progress(`Finished ${toolName}.`);
          host.event?.('tool', toolName, result.ok ? 'done' : 'failed', result.error, callId);
          host.boundary?.();
          if (result.ok) {
            failures = 0;
            failedSignature = '';
          } else {
            const signature = JSON.stringify({ toolName, input, error: result.error });
            failures = signature === failedSignature ? failures + 1 : 1;
            failedSignature = signature;
          }
          return result;
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : String(cause);
          host.event?.('tool', toolName, host.signal.aborted ? 'cancelled' : 'failed', error, callId);
          check();
          host.progress(`Failed ${toolName}: ${error}`);
          host.boundary?.();
          const signature = JSON.stringify({ toolName, input, error });
          failures = signature === failedSignature ? failures + 1 : 1;
          failedSignature = signature;
          return {
            ok: false,
            error,
            ...(hooks.some(hook => hook.tool === toolName && hook.when === 'error' && hook.action === 'note')
              ? {
                  notes: hooks
                    .filter(hook => hook.tool === toolName && hook.when === 'error' && hook.action === 'note')
                    .map(hook => hook.message),
                }
              : {}),
          };
        }
      });
      queue = operation.then(
        () => {},
        () => {}
      );
      return operation;
    },
  };
}
