// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHostTools } from './hostTools';
import { documentRevision, HOST_TOOL_DEFINITIONS } from './nativeTools';
import type { CustomGamepadLayout } from '../../customGamepad/types';

const pad: CustomGamepadLayout = {
  id: 'pad',
  name: 'Robot',
  gridSize: { width: 8, height: 4 },
  cellSize: 80,
  components: [{ id: 'existing', type: 'button', label: 'Keep', position: { x: 0, y: 0, width: 1, height: 1 } }],
  rosConfig: { defaultTopic: '/joy', defaultMessageType: 'sensor_msgs/msg/Joy' },
  metadata: { created: '2026-01-01', modified: '2026-01-01', version: '1.0.0' },
};
const setup = () => {
  const controller = new AbortController();
  const host = {
    signal: controller.signal,
    checkCurrent: vi.fn(),
    schemas: () => ({ actions: {}, services: {} }),
    validate: vi.fn((): string[] => []),
    execute: vi.fn(async (_response: unknown): Promise<unknown> => [{ ok: true, value: 'measured' }]),
    present: vi.fn(),
    document: vi.fn((_kind: string, _id: string): unknown => pad),
    progress: vi.fn(),
  };
  return { host, controller, tools: createHostTools(host) };
};
describe('native host tools', () => {
  it('advertises only unique, code-owned tools with schemas', () => {
    expect(new Set(HOST_TOOL_DEFINITIONS.map(tool => tool.name)).size).toBe(HOST_TOOL_DEFINITIONS.length);
    expect(HOST_TOOL_DEFINITIONS.every(tool => tool.inputSchema.type === 'object')).toBe(true);
    expect(HOST_TOOL_DEFINITIONS.some(tool => /shell|publish|execute_robot/.test(tool.name))).toBe(false);
  });
  it('returns timestamped host observations rather than pretending the user said them', async () => {
    const { tools, host } = setup();
    await expect(tools.execute('read_topic', { name: '/joint_states' }, 'call')).resolves.toMatchObject({
      ok: true,
      value: [{ value: 'measured' }],
    });
    expect(host.execute).toHaveBeenCalledWith({
      kind: 'contextRequest',
      summary: '',
      reads: [{ kind: 'topic', name: '/joint_states' }],
    });
    expect(host.present).not.toHaveBeenCalled();
  });
  it('returns read failures and images as native tool results', async () => {
    const { tools, host } = setup();
    host.execute
      .mockResolvedValueOnce([{ ok: false, error: 'No sample.' }])
      .mockResolvedValueOnce([{ ok: true, value: 'camera', image: { mimeType: 'image/png', data: 'AA==' } }]);
    await expect(tools.execute('read_topic', { name: '/missing' }, 'a')).resolves.toEqual({
      ok: false,
      error: 'No sample.',
    });
    await expect(tools.execute('read_camera', { name: '/image' }, 'b')).resolves.toMatchObject({
      image: { data: 'AA==' },
      value: [{ image: undefined }],
    });
  });
  it('reads a saved document with a stable revision and reports missing documents', async () => {
    const { tools, host } = setup();
    await expect(tools.execute('read_document', { kind: 'pad', id: 'pad' }, 'a')).resolves.toMatchObject({
      value: { document: pad, revision: await documentRevision(pad) },
    });
    host.document.mockReturnValue(undefined);
    await expect(tools.execute('read_document', { kind: 'pad', id: 'missing' }, 'b')).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('No document'),
    });
    await expect(tools.execute('read_document', { kind: 'shell', id: 'pad' }, 'c')).resolves.toMatchObject({
      ok: false,
    });
  });
  it('patches only requested components and requires a matching revision', async () => {
    const { tools, host } = setup();
    const revision = await documentRevision(pad);
    await expect(
      tools.execute(
        'patch_pad',
        {
          id: pad.id,
          baseRevision: revision,
          upsertComponents: [
            { id: 'home', type: 'button', label: 'Home', position: { x: 2, y: 0, width: 1, height: 1 } },
          ],
          removeComponentIds: [],
        },
        'a'
      )
    ).resolves.toMatchObject({ ok: true });
    const response = host.present.mock.calls[0][0];
    expect(response).toMatchObject({
      kind: 'padProposal',
      baseRevision: revision,
      layout: {
        components: [
          expect.objectContaining({ id: 'existing', label: 'Keep' }),
          expect.objectContaining({ id: 'home' }),
        ],
      },
    });
    expect(pad.components).toHaveLength(1);
    await expect(
      tools.execute(
        'patch_pad',
        { id: pad.id, baseRevision: 'stale', upsertComponents: [], removeComponentIds: [] },
        'b'
      )
    ).resolves.toMatchObject({ ok: false });
  });
  it('does not apply invalid or conflicting Pad edits', async () => {
    const { tools, host } = setup();
    await expect(tools.execute('propose_pad', { layout: pad }, 'a')).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('revision'),
    });
    host.validate.mockReturnValue(['Missing executable goal.']);
    await expect(
      tools.execute('propose_pad', { layout: pad, baseRevision: await documentRevision(pad) }, 'b')
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining('Missing executable') });
    expect(host.present).not.toHaveBeenCalled();
    expect(host.execute).not.toHaveBeenCalled();
  });
  it('deduplicates replay by call identity but permits intentionally identical new operations', async () => {
    const { tools, host } = setup();
    const input = { operations: [{ op: 'addPanel', panelType: 'behaviorTree' }] };
    await Promise.all([tools.execute('edit_workspace', input, 'a'), tools.execute('edit_workspace', input, 'a')]);
    expect(host.execute).toHaveBeenCalledOnce();
    expect(host.present).not.toHaveBeenCalled();
    await tools.execute('edit_workspace', input, 'new-call');
    expect(host.execute).toHaveBeenCalledTimes(2);
  });
  it('previews a tree and proposes an operation without robot execution', async () => {
    const { tools, host } = setup();
    await expect(
      tools.execute(
        'propose_tree',
        { tree: { name: 'Wait', nodes: [{ id: 'root', type: 'sequence', label: 'Root', config: {} }], edges: [] } },
        'a'
      )
    ).resolves.toMatchObject({ ok: true });
    expect(host.present.mock.calls[0][0]).toMatchObject({ kind: 'behaviorTree', tree: { name: 'Wait' } });
    await expect(
      tools.execute(
        'propose_operation',
        { operation: { kind: 'service', name: '/reset', messageType: 'std_srvs/srv/Empty', payload: {} } },
        'b'
      )
    ).resolves.toMatchObject({ ok: true });
    expect(host.present.mock.calls[1][0]).toMatchObject({ kind: 'rosAction' });
  });
  it.each([
    ['read_topic', { name: '' }],
    ['read_schema', { resource: 'shell', name: '/x' }],
    ['read_topic', null],
    ['shell', {}],
    ['patch_pad', {}],
  ])('rejects invalid %s calls', async (name, input) => {
    const { tools, host } = setup();
    await expect(tools.execute(name, input, 'a')).resolves.toMatchObject({ ok: false });
    expect(host.execute).not.toHaveBeenCalled();
  });
  it('rejects oversized results and propagates cancellation', async () => {
    const { tools, host, controller } = setup();
    host.execute.mockResolvedValue([{ ok: true, value: 'x'.repeat(140_000) }]);
    await expect(tools.execute('read_workspace', {}, 'a')).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('128 KiB'),
    });
    controller.abort();
    await expect(tools.execute('read_topic', { name: '/x' }, 'b')).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('bounds native call count', async () => {
    const { tools } = setup();
    for (let index = 0; index < 150; index++) await tools.execute('read_tf', {}, String(index));
    await expect(tools.execute('read_tf', {}, 'last')).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('tool allowance'),
    });
  });
});
