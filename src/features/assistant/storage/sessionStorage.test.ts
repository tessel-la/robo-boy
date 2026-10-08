import { beforeEach, describe, expect, it } from 'vitest';
import { loadAgentSessions, newAgentSession, storeAgentSessions } from './sessionStorage';
import type { StoredAssistantMessage } from '../types';
const proposal: StoredAssistantMessage = {
  role: 'assistant',
  content: 'Prepared Home',
  createdAt: 1,
  response: {
    kind: 'padProposal',
    issues: [],
    layout: {
      id: 'home',
      name: 'Home',
      gridSize: { width: 4, height: 2 },
      cellSize: 80,
      rosConfig: { defaultTopic: '', defaultMessageType: '' },
      metadata: { created: '2026-01-01', modified: '2026-01-01', version: '1.0.0' },
      components: [{ id: 'home-button', type: 'button', position: { x: 0, y: 0, width: 1, height: 1 } }],
    },
  },
};
beforeEach(() => localStorage.clear());
describe('robot-scoped recoverable chats', () => {
  it('migrates legacy text into one chat, then isolates robot scopes', () => {
    const legacy = [{ role: 'user' as const, content: 'Robot A', createdAt: 1 }];
    const first = loadAgentSessions('robot-A', legacy);
    storeAgentSessions('robot-A', first);
    expect(loadAgentSessions('robot-A', []).sessions[0].messages).toEqual(legacy);
    expect(loadAgentSessions('robot-B', []).sessions[0].messages).toEqual([]);
  });
  it('recovers validated authoring artifacts but excludes captures, thinking, signatures and raw events', () => {
    const session = newAgentSession([
      { ...proposal, thinking: 'private', attachments: ['image'], events: ['raw log'] } as StoredAssistantMessage,
    ]);
    storeAgentSessions('A', { version: 1, activeId: session.id, sessions: [session] });
    const loaded = loadAgentSessions('A', []);
    expect(loaded.sessions[0].messages[0].response).toMatchObject({ kind: 'padProposal', layout: { id: 'home' } });
    const raw = localStorage.getItem('robo-boy-agent-sessions-v1:A')!;
    expect(raw).not.toMatch(/private|attachments|raw log|thinking|events/);
  });
  it('keeps text but never revives malformed or execution proposals', () => {
    const session = newAgentSession([
      { ...proposal, response: { kind: 'padProposal', layout: { components: [] } } as never },
      {
        ...proposal,
        response: {
          kind: 'rosAction',
          rationale: 'Review-only fixture',
          operation: { kind: 'service', name: '/control', messageType: 'T', payload: {} },
          issues: [],
        },
      },
    ]);
    storeAgentSessions('A', { version: 1, activeId: session.id, sessions: [session] });
    expect(loadAgentSessions('A', []).sessions[0].messages.every(message => !message.response)).toBe(true);
  });
  it('bounds session/message counts and preserves malformed stored data on read', () => {
    const sessions = Array.from({ length: 22 }, () =>
      newAgentSession(Array.from({ length: 110 }, () => ({ role: 'user', content: 'Message', createdAt: 1 })))
    );
    storeAgentSessions('A', { version: 1, activeId: sessions[21].id, sessions });
    const restored = loadAgentSessions('A', []);
    expect(restored.sessions).toHaveLength(20);
    expect(restored.sessions[0].messages).toHaveLength(100);
    localStorage.setItem('robo-boy-agent-sessions-v1:broken', '{bad');
    loadAgentSessions('broken', []);
    expect(localStorage.getItem('robo-boy-agent-sessions-v1:broken')).toBe('{bad');
  });
  it('refuses oversized writes without destroying the previous session', () => {
    const session = newAgentSession([proposal]);
    storeAgentSessions('A', { version: 1, activeId: session.id, sessions: [session] });
    const before = localStorage.getItem('robo-boy-agent-sessions-v1:A');
    expect(() =>
      storeAgentSessions('A', {
        version: 1,
        activeId: session.id,
        sessions: [{ ...session, messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024), createdAt: 1 }] }],
      })
    ).toThrow(/full/);
    expect(localStorage.getItem('robo-boy-agent-sessions-v1:A')).toBe(before);
  });
});
