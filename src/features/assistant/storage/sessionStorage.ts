import { createUuid } from '../../../utils/uuid';
import type { StoredAssistantMessage } from '../types';
import { isJsonObject } from '../../../panels/types';
import { normalizePadLayout } from '../tools/padGeneration';
import { validateTreeStructure } from '../tools/treeValidation';

function safeMessage(message: StoredAssistantMessage): StoredAssistantMessage {
  const saved: StoredAssistantMessage = { role: message.role, content: message.content, createdAt: message.createdAt };
  const response: unknown = message.response;
  // Only authoring artifacts survive a restart. No native signatures, captures or raw events.
  if (message.role === 'assistant' && isJsonObject(response) && JSON.stringify(response).length <= 256 * 1024) {
    try {
      if (response.kind === 'padProposal')
        saved.response = {
          kind: 'padProposal',
          layout: normalizePadLayout(response.layout),
          issues: [],
          ...(typeof response.baseRevision === 'string' ? { baseRevision: response.baseRevision } : {}),
        };
      else if (response.kind === 'behaviorTree' && !validateTreeStructure(response.tree as never).length)
        saved.response = {
          kind: 'behaviorTree',
          tree: response.tree as unknown as import('../../behaviorTree/types').BehaviorTree,
        };
      if (saved.response && ['applied', 'saved', 'rejected', 'failed'].includes(message.resolution ?? ''))
        saved.resolution = message.resolution;
    } catch {
      /* Keep the conversation text, never revive an invalid proposal. */
    }
  }
  return saved;
}

export interface SavedAgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  messages: StoredAssistantMessage[];
}
export interface AgentSessions {
  version: 1;
  activeId: string;
  sessions: SavedAgentSession[];
}
const key = (scope: string) => `robo-boy-agent-sessions-v1:${encodeURIComponent(scope)}`;
export function newAgentSession(messages: StoredAssistantMessage[] = []): SavedAgentSession {
  const now = Date.now();
  return {
    id: createUuid(),
    title: messages.find(item => item.role === 'user')?.content.slice(0, 80) || 'New chat',
    createdAt: now,
    updatedAt: now,
    archived: false,
    messages,
  };
}
export function loadAgentSessions(scope: string, legacy: StoredAssistantMessage[]): AgentSessions {
  try {
    const raw = localStorage.getItem(key(scope));
    if (raw && raw.length <= 2 * 1024 * 1024) {
      const value = JSON.parse(raw);
      if (value.version === 1 && Array.isArray(value.sessions)) {
        const sessions = value.sessions
          .filter(
            (item: SavedAgentSession) =>
              item &&
              typeof item.id === 'string' &&
              typeof item.title === 'string' &&
              Number.isFinite(item.createdAt) &&
              Number.isFinite(item.updatedAt) &&
              typeof item.archived === 'boolean' &&
              Array.isArray(item.messages)
          )
          .slice(-20)
          .map((item: SavedAgentSession) => ({
            ...item,
            messages: item.messages
              .filter(
                message =>
                  message &&
                  ['user', 'assistant'].includes(message.role) &&
                  typeof message.content === 'string' &&
                  Number.isFinite(message.createdAt)
              )
              .slice(-100)
              .map(safeMessage),
          }));
        if (sessions.length)
          return {
            version: 1,
            activeId: sessions.some((item: SavedAgentSession) => item.id === value.activeId)
              ? value.activeId
              : sessions[0].id,
            sessions,
          };
      }
    }
  } catch {
    /* retain the old key; malformed new data is never overwritten by loading */
  }
  const session = newAgentSession(legacy);
  return { version: 1, activeId: session.id, sessions: [session] };
}
export function storeAgentSessions(scope: string, state: AgentSessions): void {
  const raw = JSON.stringify({
    ...state,
    sessions: state.sessions
      .slice(-20)
      .map(session => ({ ...session, messages: session.messages.slice(-100).map(safeMessage) })),
  });
  if (raw.length > 2 * 1024 * 1024)
    throw new Error('Session storage is full. Export or archive old chats before continuing.');
  localStorage.setItem(key(scope), raw);
}
