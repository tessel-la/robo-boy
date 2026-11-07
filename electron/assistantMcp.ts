import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { HostTools } from '../src/features/assistant/tools/nativeTools';

/** Per-request capability bridge, not a general MCP server. Loopback, exact Host, no browser
 * Origin, bearer token, bounded body, code-owned tools, and automatic lifetime cleanup. */
export async function startAssistantMcp(
  tools: HostTools,
  signal: AbortSignal
): Promise<{ url: string; token: string; close(): Promise<void> }> {
  signal.throwIfAborted();
  const token = randomBytes(32).toString('hex');
  const sessions = new Set<StreamableHTTPServerTransport>();
  let expectedHost = '';
  const server = createServer(async (request, response) => {
    const authorization = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (
      signal.aborted ||
      request.headers.host !== expectedHost ||
      request.headers.origin ||
      authorization.length !== expected.length ||
      !timingSafeEqual(authorization, expected)
    ) {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== 'POST' || request.url !== '/mcp') {
      response.writeHead(405).end();
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 256 * 1024) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      signal.throwIfAborted();
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const mcp = new Server({ name: 'roboboy', version: '1.0.0' }, { capabilities: { tools: {} } });
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: tools.definitions.map(definition => ({
          name: definition.name,
          description: definition.description,
          inputSchema: definition.inputSchema as { type: 'object' },
        })),
      }));
      mcp.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        const result = await tools.execute(params.name, params.arguments ?? {}, randomBytes(16).toString('hex'));
        return {
          isError: !result.ok,
          content: [
            { type: 'text', text: JSON.stringify({ ...result, image: undefined }) },
            ...(result.image ? [{ type: 'image', data: result.image.data, mimeType: result.image.mimeType }] : []),
          ],
        };
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      sessions.add(transport);
      response.once('close', () => {
        sessions.delete(transport);
        void transport.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent) response.writeHead(400).end();
      else response.end();
    }
  });
  // User questions and child investigations may outlive an ordinary data read.
  // The parent request's abort signal still owns the entire bridge lifetime.
  server.requestTimeout = 20 * 60_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 8;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Cannot start subscription host tools.');
  expectedHost = `127.0.0.1:${address.port}`;
  const close = async () => {
    signal.removeEventListener('abort', abort);
    await Promise.all([...sessions].map(session => session.close()));
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  };
  const abort = () => {
    void close();
  };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) {
    await close();
    signal.throwIfAborted();
  }
  return { url: `http://${expectedHost}/mcp`, token, close };
}
