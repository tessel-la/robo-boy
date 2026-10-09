// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  list: vi.fn(),
  call: vi.fn(),
  options: undefined as any,
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = sdk.connect;
    close = sdk.close;
    listTools = sdk.list;
    callTool = sdk.call;
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(_url: unknown, options: unknown) {
      sdk.options = options;
    }
  },
}));
import {
  callIntegration,
  integrationCatalog,
  listIntegrationTools,
  setIntegrationToken,
  storeIntegrations,
} from './integrations';
const integration = {
  id: 'fixture',
  name: 'Trusted fixture',
  url: 'https://example.test/mcp',
  grants: { inspect: 'read' as const, edit: 'local-edit' as const },
};
const schema = {
  name: 'inspect',
  inputSchema: {
    type: 'object',
    properties: { count: { type: 'integer', minimum: 1 } },
    required: ['count'],
    additionalProperties: false,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  sdk.connect.mockResolvedValue(undefined);
  sdk.close.mockResolvedValue(undefined);
  sdk.list.mockResolvedValue({ tools: [schema] });
  sdk.call.mockResolvedValue({ content: [{ type: 'text', text: 'measured' }] });
  setIntegrationToken('fixture', '');
  storeIntegrations([integration]);
});
afterEach(() => {
  setIntegrationToken('fixture', '');
  vi.unstubAllGlobals();
});
describe('explicit MCP grants and bounded transport', () => {
  it('discovers only granted tools and validates the exact schema before calling', async () => {
    sdk.list.mockResolvedValue({ tools: [schema, { ...schema, name: 'ungranted' }] });
    expect(await integrationCatalog(new AbortController().signal)).toMatchObject([
      { id: 'fixture', tools: [{ name: 'inspect', grant: 'read' }] },
    ]);
    await expect(
      callIntegration('fixture', 'inspect', { count: 0 }, new AbortController().signal, true)
    ).rejects.toThrow(/schema/);
    expect(sdk.call).not.toHaveBeenCalled();
    expect(await callIntegration('fixture', 'inspect', { count: 1 }, new AbortController().signal, true)).toMatchObject(
      { ok: true, value: { source: 'Trusted fixture', authority: 'untrusted tool data' } }
    );
    expect(sdk.call).toHaveBeenCalledWith(
      { name: 'inspect', arguments: { count: 1 } },
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(sdk.close).toHaveBeenCalled();
  });
  it('fails closed when grants change while discovery is pending', async () => {
    sdk.list.mockImplementation(async () => {
      storeIntegrations([{ ...integration, grants: {} }]);
      return { tools: [schema] };
    });
    await expect(
      callIntegration('fixture', 'inspect', { count: 1 }, new AbortController().signal, true)
    ).rejects.toThrow(/permission changed/);
    expect(sdk.call).not.toHaveBeenCalled();
  });
  it('redacts session authorization from output, catalogs and errors', async () => {
    setIntegrationToken('fixture', 'fixture-session-token');
    sdk.call.mockResolvedValue({ content: [{ type: 'text', text: 'Echo fixture-session-token' }] });
    const result = await callIntegration('fixture', 'inspect', { count: 1 }, new AbortController().signal, true);
    expect(JSON.stringify(result)).not.toContain('fixture-session-token');
    expect(JSON.stringify(result)).toContain('[redacted]');
    expect(sdk.options.requestInit.headers.Authorization).toBe('Bearer fixture-session-token');
    sdk.connect.mockRejectedValue(new Error('Rejected fixture-session-token'));
    await expect(listIntegrationTools(integration, new AbortController().signal)).rejects.toThrow(
      'Rejected [redacted]'
    );
  });
  it('refuses oversized catalogs/results and exposes remote errors without pretending success', async () => {
    sdk.list.mockResolvedValue({ tools: [{ ...schema, description: 'x'.repeat(140_000) }] });
    await expect(listIntegrationTools(integration, new AbortController().signal)).rejects.toThrow(/catalog/);
    sdk.list.mockResolvedValue({ tools: [schema] });
    sdk.call.mockResolvedValue({ content: [{ type: 'text', text: 'x'.repeat(140_000) }] });
    await expect(
      callIntegration('fixture', 'inspect', { count: 1 }, new AbortController().signal, true)
    ).rejects.toThrow(/output/);
    sdk.call.mockResolvedValue({ isError: true, content: [{ type: 'text', text: 'Tool failed' }] });
    expect(await callIntegration('fixture', 'inspect', { count: 1 }, new AbortController().signal, true)).toMatchObject(
      { ok: false }
    );
  });
  it('blocks redirects/ambient credentials and enforces streamed response bytes', async () => {
    const fetch = vi.fn(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    vi.stubGlobal('fetch', fetch);
    await listIntegrationTools(integration, new AbortController().signal);
    const response = await sdk.options.fetch(integration.url, { method: 'POST', credentials: 'include' });
    await expect(response.text()).rejects.toThrow(/2 MiB/);
    expect(fetch).toHaveBeenCalledWith(
      integration.url,
      expect.objectContaining({ credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) })
    );
  });
  it('closes owned transports on cancellation and never calls a tool after cancellation', async () => {
    const controller = new AbortController();
    sdk.list.mockImplementation(async () => {
      controller.abort();
      return { tools: [schema] };
    });
    await expect(callIntegration('fixture', 'inspect', { count: 1 }, controller.signal, true)).rejects.toThrow();
    expect(sdk.call).not.toHaveBeenCalled();
    expect(sdk.close).toHaveBeenCalled();
  });
});
