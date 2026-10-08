import { useState } from 'react';
import {
  integrationUrl,
  loadIntegrations,
  storeIntegrations,
  setIntegrationToken,
  listIntegrationTools,
  type IntegrationTool,
} from '../runtime/integrations';
import { timedSignal } from '../runtime/abort';

export function AgentIntegrations() {
  const [integrations, setIntegrations] = useState(loadIntegrations),
    [url, setUrl] = useState(''),
    [error, setError] = useState('');
  const [catalogs, setCatalogs] = useState<Record<string, IntegrationTool[]>>({}),
    [busy, setBusy] = useState(false);
  const discover = async (id: string) => {
    const integration = integrations.find(item => item.id === id);
    if (!integration) return;
    const bounded = timedSignal(new AbortController().signal, 30_000);
    setBusy(true);
    try {
      const tools = await listIntegrationTools(integration, bounded.signal);
      setCatalogs(previous => ({ ...previous, [id]: tools }));
      setError('');
    } catch (cause) {
      setError(String(cause));
    } finally {
      bounded.dispose();
      setBusy(false);
    }
  };
  return (
    <details>
      <summary>Trusted MCP integrations</summary>
      <p>
        Enable only tools you trust. Read/local-edit grants are operator assertions, not guarantees from server
        annotations. Robot-control tools must stay disabled. Tokens are session-only; servers need browser-compatible
        HTTP/CORS.
      </p>
      <label>
        MCP endpoint
        <input
          aria-label="MCP endpoint"
          type="url"
          value={url}
          onChange={event => setUrl(event.target.value)}
          placeholder="https://example.com/mcp"
        />
      </label>
      <button
        type="button"
        disabled={busy || integrations.length >= 8}
        onClick={() => {
          try {
            const next = [
              ...integrations,
              { id: crypto.randomUUID(), name: new URL(url).hostname, url: integrationUrl(url), grants: {} },
            ];
            storeIntegrations(next);
            setIntegrations(next);
            setUrl('');
            setError('');
          } catch (cause) {
            setError(String(cause));
          }
        }}
      >
        Add endpoint
      </button>
      {integrations.map(integration => (
        <section key={integration.id}>
          <strong>{integration.name}</strong>
          <label>
            Session token
            <input
              type="password"
              autoComplete="off"
              aria-label={`MCP token for ${integration.name}`}
              onChange={event => {
                try {
                  setIntegrationToken(integration.id, event.target.value);
                } catch (cause) {
                  setError(String(cause));
                }
              }}
            />
          </label>
          <button type="button" disabled={busy} onClick={() => void discover(integration.id)}>
            Discover tools
          </button>
          <button
            type="button"
            onClick={() => {
              const next = integrations.filter(item => item.id !== integration.id);
              storeIntegrations(next);
              setIntegrationToken(integration.id, '');
              setIntegrations(next);
            }}
          >
            Remove integration
          </button>
          {(catalogs[integration.id] ?? []).map(tool => (
            <label key={tool.name}>
              {tool.name}
              <select
                aria-label={`Permission for ${tool.name}`}
                value={integration.grants[tool.name] ?? ''}
                onChange={event => {
                  const grants = { ...integration.grants };
                  if (event.target.value) grants[tool.name] = event.target.value as 'read' | 'local-edit';
                  else delete grants[tool.name];
                  const next = integrations.map(item => (item.id === integration.id ? { ...item, grants } : item));
                  storeIntegrations(next);
                  setIntegrations(next);
                }}
              >
                <option value="">Disabled</option>
                <option value="read">Trusted read</option>
                <option value="local-edit">Trusted local edit (not robot control)</option>
              </select>
            </label>
          ))}
        </section>
      ))}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
