import { Validator } from '@cfworker/json-schema';
import type { HostToolResult } from '../tools/nativeTools';
import { timedSignal } from './abort';

export interface Integration {
  id: string;
  name: string;
  url: string;
  grants: Record<string, 'read' | 'local-edit'>;
}
export interface IntegrationTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
const KEY = 'robo-boy-agent-integrations-v1';
const tokens = new Map<string, string>();
export function integrationUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search)
    throw new Error('Use a credential-free MCP endpoint without query parameters.');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  )
    throw new Error('MCP needs HTTPS or explicit local loopback HTTP.');
  return url.href;
}
export function loadIntegrations(): Integration[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 64 * 1024) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        item =>
          item &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          item.name.length <= 100 &&
          typeof item.url === 'string' &&
          item.grants &&
          typeof item.grants === 'object' &&
          !Array.isArray(item.grants)
      )
      .slice(0, 8)
      .map(item => ({
        ...item,
        url: integrationUrl(item.url),
        grants: Object.fromEntries(
          Object.entries(item.grants).filter(([, grant]) => ['read', 'local-edit'].includes(String(grant)))
        ),
      }));
  } catch {
    return [];
  }
}
export function storeIntegrations(integrations: Integration[]): void {
  const value = JSON.stringify(
    integrations.map(({ id, name, url, grants }) => ({ id, name, url: integrationUrl(url), grants })).slice(0, 8)
  );
  if (value.length > 64 * 1024) throw new Error('Integration configuration exceeds 64 KiB.');
  localStorage.setItem(KEY, value);
}
export function setIntegrationToken(id: string, token: string): void {
  if (token.length > 8192 || /[\r\n]/.test(token)) throw new Error('Invalid MCP authorization token.');
  if (token) tokens.set(id, token);
  else tokens.delete(id);
}
async function withClient<T>(
  integration: Integration,
  signal: AbortSignal,
  task: (client: import('@modelcontextprotocol/sdk/client/index.js').Client) => Promise<T>
): Promise<T> {
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
  ]);
  signal.throwIfAborted();
  const client = new Client({ name: 'robo-boy', version: '1.0.0' }, { capabilities: {} });
  const credential = tokens.get(integration.id);
  const bounded = timedSignal(signal, 30_000),
    combined = bounded.signal;
  const transport = new StreamableHTTPClientTransport(new URL(integrationUrl(integration.url)), {
    requestInit: { credentials: 'omit', headers: credential ? { Authorization: `Bearer ${credential}` } : {} },
    fetch: async (url, options) => {
      const response = await fetch(url, { ...options, credentials: 'omit', redirect: 'error', signal: combined });
      if (!response.body) return response;
      let size = 0;
      const body = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            size += chunk.byteLength;
            if (size > 2 * 1024 * 1024) controller.error(new Error('MCP transport exceeds 2 MiB.'));
            else controller.enqueue(chunk);
          },
        })
      );
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  });
  const cancelled = () => {
    void client.close().catch(() => {});
  };
  combined.addEventListener('abort', cancelled, { once: true });
  try {
    await client.connect(transport);
    combined.throwIfAborted();
    const result = await task(client);
    combined.throwIfAborted();
    // A server may echo authorization in errors, metadata or descriptions. It is never
    // legitimate model context, even when the operator trusts the remote tool.
    return credential ? (JSON.parse(JSON.stringify(result).split(credential).join('[redacted]')) as T) : result;
  } catch (cause) {
    throw new Error(credential ? String(cause).split(credential).join('[redacted]') : String(cause));
  } finally {
    bounded.dispose();
    combined.removeEventListener('abort', cancelled);
    await client.close().catch(() => {});
  }
}
export async function listIntegrationTools(integration: Integration, signal: AbortSignal): Promise<IntegrationTool[]> {
  return withClient(integration, signal, async client => {
    const result = await client.listTools({}, { signal });
    if (JSON.stringify(result).length > 128 * 1024)
      throw new Error('MCP tool catalog exceeds 128 KiB. Use a narrower server.');
    return result.tools
      .slice(0, 100)
      .map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
  });
}
export async function integrationCatalog(signal: AbortSignal): Promise<unknown> {
  const catalog = [];
  for (const integration of loadIntegrations()) {
    try {
      const tools = await listIntegrationTools(integration, signal);
      catalog.push({
        id: integration.id,
        name: integration.name,
        tools: tools
          .filter(tool => integration.grants[tool.name])
          .map(tool => ({ ...tool, grant: integration.grants[tool.name] })),
      });
    } catch (cause) {
      signal.throwIfAborted();
      catalog.push({ id: integration.id, name: integration.name, error: String(cause) });
    }
  }
  return catalog;
}
export async function callIntegration(
  id: string,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  readOnly: boolean
): Promise<HostToolResult> {
  const integration = loadIntegrations().find(item => item.id === id);
  const grant = integration?.grants[name];
  if (!integration || !grant || (readOnly && grant !== 'read'))
    throw new Error('This integration tool has not been explicitly granted for this scope.');
  return withClient(integration, signal, async client => {
    const listed = await client.listTools({}, { signal }),
      tool = listed.tools.find(item => item.name === name);
    if (!tool) throw new Error('This MCP tool is no longer available.');
    if (!new Validator(tool.inputSchema).validate(args).valid)
      throw new Error('Arguments do not match the MCP tool schema.');
    signal.throwIfAborted();
    const current = loadIntegrations().find(item => item.id === id);
    if (!current || current.url !== integration.url || current.grants[name] !== grant)
      throw new Error('Integration permission changed while discovering the tool. Nothing was called.');
    const result = await client.callTool({ name, arguments: args }, undefined, { signal });
    if (JSON.stringify(result).length > 128 * 1024)
      throw new Error('MCP output exceeds 128 KiB. Ask for a smaller result.');
    return {
      ok: !result.isError,
      value: { source: integration.name, capturedAt: Date.now(), result, authority: 'untrusted tool data' },
    };
  });
}
