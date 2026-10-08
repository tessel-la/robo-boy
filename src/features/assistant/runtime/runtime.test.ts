// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';
const topics = vi.hoisted(() => ({ receive: undefined as unknown as (value: unknown) => void, unsubscribe: vi.fn() }));
vi.mock('roslib', () => ({
  Topic: class {
    subscribe(callback: (value: unknown) => void) {
      topics.receive = callback;
    }
    unsubscribe = topics.unsubscribe;
  },
}));
import { AgentRun, AgentYield, InputQueue } from './session';
import { DocumentChanges, documentDiff } from '../tools/documents';
import { documentRevision } from '../tools/nativeTools';
import { TopicMonitor } from './monitors';
import { importSkill, loadSkills, storeSkills } from './skills';
import { loadAgentProfiles, saveAgentProfiles } from './profiles';
import {
  integrationUrl,
  loadIntegrations,
  setIntegrationToken,
  storeIntegrations,
  callIntegration,
} from './integrations';
import { compactSessionHistory } from './context';
import { timedSignal } from './abort';
import { loadAgentHooks, storeAgentHooks } from './hooks';
import { createHostTools } from '../tools/hostTools';
import { newAgentSession } from '../storage/sessionStorage';

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  vi.stubGlobal('navigator', {});
  topics.unsubscribe.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('owned agent lifecycle', () => {
  it('creates sessions, run events and queued inputs without secure-context randomUUID', async () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    const run = new AgentRun(vi.fn());
    const session = newAgentSession();
    const question = run.ask('Which Pad?');
    expect(run.answer('Drive')).toBe(true);
    await expect(question).resolves.toBe('Drive');
    const queue = new InputQueue();
    queue.enqueue('Inspect TF', 'queue');
    const ids = [run.id, session.id, run.events[0].id, queue.items[0].id];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{14}4[0-9a-f-]{21}$/);
    run.cancel();
  });
  it('shares step/call budgets, yields steering, and keeps questions user-authored', async () => {
    const run = new AgentRun(vi.fn(), 2, 1);
    run.beforeStep();
    run.beforeStep();
    expect(() => run.beforeStep()).toThrow(/allowance/);
    run.beforeTool();
    expect(() => run.beforeTool()).toThrow(/allowance/);
    const question = run.ask('Which saved Pad?');
    expect(run.answer('Drive Pad')).toBe(true);
    await expect(question).resolves.toBe('Drive Pad');
    expect(run.answer('extra')).toBe(false);
    run.steer();
    expect(() => run.beforeStep()).toThrow(AgentYield);
  });
  it('cancels questions and children and rejects late successful results', async () => {
    const run = new AgentRun(vi.fn());
    const question = run.ask('Which controller?');
    let done!: (value: unknown) => void;
    const id = await run.spawn(
      'Inspect TF',
      () =>
        new Promise(resolve => {
          done = resolve;
        })
    );
    await Promise.resolve();
    run.cancel();
    done('late evidence');
    await expect(question).rejects.toMatchObject({ name: 'AbortError' });
    await expect(run.children.get(id)!.result).resolves.toMatchObject({ ok: false });
    expect(run.children.get(id)!.controller.signal.aborted).toBe(true);
    await run.settle();
  });
  it('queues child follow-ups and enforces the three-child task bound', async () => {
    const run = new AgentRun(vi.fn()),
      execute = vi.fn(async (task: string) => task);
    const id = await run.spawn('Initial investigation', execute);
    run.messageChild(id, 'Focus on controller joints');
    await expect(run.children.get(id)!.result).resolves.toMatchObject({
      ok: true,
      value: expect.stringContaining('Focus on controller joints'),
    });
    expect(execute).toHaveBeenCalledTimes(2);
    await run.spawn('Logs', execute);
    await run.spawn('Parameters', execute);
    await expect(run.spawn('Fourth', execute)).rejects.toThrow(/three/);
  });
  it('edits/reorders queued inputs without creating synthetic user messages', () => {
    const queue = new InputQueue();
    const a = queue.enqueue('Later', 'queue'),
      b = queue.enqueue('Next', 'queue');
    queue.update(a.id, 'Edited');
    queue.move(b.id, -1);
    expect(queue.next()?.id).toBe(b.id);
    queue.enqueue('Steer now', 'steer');
    expect(queue.next()?.text).toBe('Steer now');
    expect(queue.next()?.text).toBe('Edited');
    expect(queue.next()).toBeUndefined();
    expect(() => queue.enqueue('', 'queue')).toThrow(/empty/);
  });
});

describe('document revision/checkpoint boundary', () => {
  const setup = (initial: unknown = { id: 'pad', name: 'Original', components: [] }) => {
    let value = initial;
    const owner = {
      read: () => value,
      save: vi.fn((_kind: unknown, document: unknown) => {
        value = document;
        return true;
      }),
      remove: vi.fn(() => {
        value = undefined;
        return true;
      }),
    };
    return { owner, journal: new DocumentChanges(owner, 'journal'), value: () => value };
  };
  it('journals before writing, reads back, refuses stale writes/undo, and restores only unchanged revisions', async () => {
    const { owner, journal, value } = setup();
    const revision = await documentRevision(value());
    const saved = await journal.save('pad', { id: 'pad', name: 'Home', components: [] }, revision);
    expect(saved.state).toBe('committed');
    expect(saved.afterRevision).toBe(await documentRevision(value()));
    await expect(journal.save('pad', { id: 'pad', name: 'stale' }, revision)).rejects.toThrow(/changed/);
    await journal.restore(saved.id);
    expect(value()).toMatchObject({ name: 'Original' });
    expect(owner.save).toHaveBeenCalledTimes(2);
    await expect(journal.restore(saved.id)).rejects.toThrow(/not available/);
  });
  it('does not overwrite a manual edit after a checkpoint', async () => {
    const { owner, journal, value } = setup();
    const saved = await journal.save('pad', { id: 'pad', name: 'Agent' }, await documentRevision(value()));
    owner.save('pad', { id: 'pad', name: 'Human' });
    await expect(journal.restore(saved.id)).rejects.toThrow(/changed after/);
    expect(value()).toMatchObject({ name: 'Human' });
  });
  it('removes a newly created document on undo and honors cancellation before mutation', async () => {
    const { journal, owner, value } = setup(undefined);
    // Explicitly clear the fixture because the default parameter supplies an initial value.
    owner.remove();
    const saved = await journal.save('pad', { id: 'new', name: 'New' });
    await expect(
      journal.restore(saved.id, () => {
        throw new DOMException('Cancelled', 'AbortError');
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(value()).toMatchObject({ name: 'New' });
    await journal.restore(saved.id);
    expect(value()).toBeUndefined();
  });
  it('preserves malformed journal data and reconciles interrupted saves without replaying them', async () => {
    const { owner } = setup({ id: 'pad', name: 'Home', metadata: { modified: 'owner timestamp' } });
    localStorage.setItem('broken', '{bad');
    await expect(new DocumentChanges(owner, 'broken').save('pad', { id: 'pad' })).rejects.toThrow(/safely/);
    expect(localStorage.getItem('broken')).toBe('{bad');
    const pending = {
      id: 'change',
      kind: 'pad',
      documentId: 'pad',
      state: 'pending',
      createdAt: 1,
      before: { id: 'pad', name: 'Old' },
      intended: { id: 'pad', name: 'Home', metadata: { modified: 'model timestamp' } },
    };
    localStorage.setItem('pending', JSON.stringify([pending]));
    const journal = new DocumentChanges(owner, 'pending');
    await journal.reconcile();
    expect(journal.checkpoints[0]).toMatchObject({ state: 'committed', afterRevision: expect.any(String) });
    expect(owner.save).not.toHaveBeenCalled();
    localStorage.setItem('conflict', JSON.stringify([{ ...pending, intended: { id: 'pad', name: 'Other' } }]));
    const conflict = new DocumentChanges(owner, 'conflict');
    await conflict.reconcile();
    expect(conflict.checkpoints[0].state).toBe('conflicted');
  });
  it('uses the browser cross-window lock and keeps a bounded readable diff', async () => {
    const request = vi.fn(async (_key: string, operation: () => Promise<unknown>) => operation());
    vi.stubGlobal('navigator', { locks: { request } });
    const { journal, value } = setup();
    await journal.save('pad', { id: 'pad', name: 'Home' }, await documentRevision(value()));
    expect(request).toHaveBeenCalledWith('robo-boy-authoring:pad:pad', expect.any(Function));
    expect(documentDiff({ name: 'Old', updatedAt: 1 }, { name: 'Home', updatedAt: 2 })).toContain('- "Old"\n+ "Home"');
    expect(documentDiff({ updatedAt: 1 }, { updatedAt: 2 })).toBe('');
  });
});

describe('bounded deterministic monitoring', () => {
  const options = {
    topic: '/temperature',
    messageType: 'std_msgs/msg/Float64',
    fieldPath: 'data',
    comparison: 'above' as const,
    value: 50,
    durationMinutes: 10,
    maxInferences: 2,
  };
  it('triggers read-only analysis on edges, observes cooldown, then stops at its allowance', async () => {
    vi.useFakeTimers();
    const analyse = vi.fn(async () => {});
    const monitor = new TopicMonitor({} as never, options, vi.fn(), analyse);
    topics.receive({ data: 60 });
    await vi.advanceTimersByTimeAsync(0);
    expect(analyse).toHaveBeenCalledOnce();
    topics.receive({ data: 70 });
    expect(analyse).toHaveBeenCalledOnce();
    topics.receive({ data: 10 });
    await vi.advanceTimersByTimeAsync(300_001);
    topics.receive({ data: 80 });
    await vi.advanceTimersByTimeAsync(0);
    expect(analyse).toHaveBeenCalledTimes(2);
    expect(monitor.state.status).toBe('stopped');
    expect(topics.unsubscribe).toHaveBeenCalledOnce();
  });
  it('expires, cancels in-flight analysis, ignores non-scalars and rejects unbounded watches', async () => {
    vi.useFakeTimers();
    let analysisSignal: AbortSignal | undefined;
    const monitor = new TopicMonitor(
      {} as never,
      { ...options, durationMinutes: 1 },
      vi.fn(),
      async (_value, signal) => {
        analysisSignal = signal;
      }
    );
    topics.receive({ data: Infinity });
    topics.receive({ data: {} });
    expect(analysisSignal).toBeUndefined();
    topics.receive({ data: 70 });
    monitor.stop();
    expect(analysisSignal?.aborted).toBe(true);
    const expires = new TopicMonitor({} as never, { ...options, durationMinutes: 1 }, vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(expires.state.status).toBe('stopped');
    expect(() => new TopicMonitor({} as never, { ...options, maxInferences: 0 }, vi.fn(), vi.fn())).toThrow(/bounded/);
  });
});

describe('trusted extension configuration and context', () => {
  it('imports instruction-only skills and remembers explicit enabled settings', () => {
    const skill = importSkill(
      '---\nname: home-helper\ndescription: Capture a measured pose\n---\nRead actual joint values.'
    );
    expect(skill.instructions).toBe('Read actual joint values.');
    expect(() => importSkill('unbounded '.repeat(3000))).toThrow(/24 KiB/);
    expect(() => importSkill('No frontmatter')).toThrow(/SKILL.md/);
    storeSkills([...loadSkills().map(item => ({ ...item, enabled: false })), skill]);
    expect(loadSkills().find(item => item.id === 'home-capture')?.enabled).toBe(false);
    expect(loadSkills().find(item => item.id === skill.id)?.builtin).toBe(false);
  });
  it('preserves builtin profiles while importing only bounded custom profiles', () => {
    const profiles = loadAgentProfiles();
    saveAgentProfiles([
      ...profiles,
      { id: 'custom', name: 'Arm', description: 'Inspect arm', instructions: 'Read only', readOnly: true },
    ]);
    expect(loadAgentProfiles()).toHaveLength(4);
    localStorage.setItem(
      'robo-boy-agent-profiles-v1',
      JSON.stringify([
        { id: 'general', instructions: 'grant motion' },
        { id: 'bad', name: 'bad', instructions: 3 },
      ])
    );
    expect(loadAgentProfiles()).toHaveLength(3);
  });
  it('permits only explicit credential-free MCP endpoints and never persists bearer tokens', async () => {
    expect(integrationUrl('http://localhost:8010/mcp')).toBe('http://localhost:8010/mcp');
    for (const url of [
      'http://robot/mcp',
      'https://user:secret@example.com/mcp',
      'https://example.com/mcp?key=secret',
      'file:///tmp/socket',
    ])
      expect(() => integrationUrl(url)).toThrow();
    storeIntegrations([
      {
        id: 'mcp',
        name: 'Inspection',
        url: 'https://example.com/mcp',
        grants: { inspect: 'read', edit: 'local-edit' },
      },
    ]);
    setIntegrationToken('mcp', 'session-secret');
    expect(JSON.stringify(loadIntegrations())).not.toContain('secret');
    await expect(callIntegration('mcp', 'edit', {}, new AbortController().signal, true)).rejects.toThrow(
      /explicitly granted/
    );
    await expect(callIntegration('mcp', 'robot_motion', {}, new AbortController().signal, false)).rejects.toThrow(
      /explicitly granted/
    );
    setIntegrationToken('mcp', '');
  });
  it('compacts whole turns, retains completed-effect receipts, and never slices signatures', () => {
    const history: ModelMessage[] = [
      { role: 'user', content: 'Save Home' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolName: 'save_document', toolCallId: 'saved', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolName: 'save_document',
            toolCallId: 'saved',
            output: { type: 'json', value: { ok: true, checkpointId: 'cp', raw: 'x'.repeat(5000) } },
          },
        ],
      },
      { role: 'user', content: 'Read back Home' },
    ];
    const compacted = compactSessionHistory(history, 2200);
    expect(compacted[compacted.length - 1]).toEqual(history[history.length - 1]);
    expect(JSON.stringify(compacted)).toContain('save_document');
    expect(JSON.stringify(compacted)).toContain('checkpointId');
    expect(compacted.some(message => message.role === 'tool')).toBe(false);
    expect(() => compactSessionHistory([{ role: 'user', content: 'x'.repeat(2000) }], 100)).toThrow(/allowance/);
  });
  it('applies declarative tool blocks/reminders without granting capabilities or scripts', async () => {
    storeAgentHooks([
      {
        id: 'deny',
        enabled: true,
        when: 'before',
        tool: 'save_document',
        action: 'block',
        message: 'Investigation only',
      },
      {
        id: 'remind',
        enabled: true,
        when: 'success',
        tool: 'read_workspace',
        action: 'note',
        message: 'Verify current source',
      },
    ]);
    const save = vi.fn(),
      tools = createHostTools({
        signal: new AbortController().signal,
        checkCurrent: () => {},
        schemas: () => ({ actions: {}, services: {} }),
        validate: () => [],
        execute: async () => [{ ok: true }],
        present: () => {},
        document: () => undefined,
        progress: () => {},
        saveDocument: save,
      });
    expect(await tools.execute('save_document', { kind: 'pad', document: { id: 'p' } }, 'blocked')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Investigation only'),
    });
    expect(save).not.toHaveBeenCalled();
    expect(await tools.execute('read_workspace', {}, 'read')).toMatchObject({
      ok: true,
      notes: ['Verify current source'],
    });
    localStorage.setItem('robo-boy-agent-hooks-v1', '[{"tool":"Bash"}]');
    expect(() => loadAgentHooks()).toThrow(/Invalid/);
  });
  it('stops repeated failures at a model-step boundary and respects tool subsets for delegation', async () => {
    const delegate = vi.fn(),
      tools = createHostTools({
        signal: new AbortController().signal,
        checkCurrent: () => {},
        schemas: () => ({ actions: {}, services: {} }),
        validate: () => [],
        execute: async () => [{ ok: false, error: 'Missing topic' }],
        present: () => {},
        document: () => undefined,
        progress: () => {},
        delegate,
        allowedTools: ['read_topic'],
      });
    for (let index = 0; index < 3; index++) await tools.execute('read_topic', { name: '/missing' }, String(index));
    expect(() => tools.checkpoint?.()).toThrow(/three times/);
    expect(await tools.execute('delegate_read', { task: 'Bypass profile' }, 'child')).toMatchObject({ ok: false });
    expect(delegate).not.toHaveBeenCalled();
  });
  it('uses mobile-compatible composed cancellation and releases its timer', async () => {
    vi.useFakeTimers();
    const parent = new AbortController(),
      timed = timedSignal(parent.signal, 1000);
    parent.abort();
    expect(timed.signal.aborted).toBe(true);
    timed.dispose();
    expect(vi.getTimerCount()).toBe(0);
    const timeout = timedSignal(new AbortController().signal, 10);
    await vi.advanceTimersByTimeAsync(11);
    expect(timeout.signal.reason.name).toBe('TimeoutError');
    timeout.dispose();
  });
});
