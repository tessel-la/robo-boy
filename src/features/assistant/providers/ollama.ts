import { checkedFetch, readNdjson } from './transport';
import type { SendChat } from './types';

const getOllamaApiBaseUrl = (baseUrl: string): string => {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/api')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized.slice(0, -3)}/api`;
  return `${normalized}/api`;
};

export const sendChat: SendChat = async ({ settings, systemPrompt, messages, signal, onToken, jsonMode }) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;

  const body: Record<string, unknown> = {
    model: settings.model,
    stream: true,
    options: { temperature: 0.2 },
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(turn => ({
        role: turn.role,
        content: turn.content,
        ...(turn.images && turn.images.length > 0 ? { images: turn.images.map(image => image.data) } : {}),
      })),
    ],
  };
  if (jsonMode) body.format = 'json';

  const response = await checkedFetch(`${getOllamaApiBaseUrl(settings.baseUrl)}/chat`, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify(body),
  });
  return readNdjson(response, payload => payload.message?.content, onToken);
};

export const fetchOllamaModels = async (baseUrl: string, apiKey = '', signal?: AbortSignal): Promise<string[]> => {
  if (!baseUrl.trim()) throw new Error('Set the Ollama base URL before loading models.');
  const headers: Record<string, string> = {};
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  const apiBaseUrl = getOllamaApiBaseUrl(baseUrl);

  try {
    const response = await checkedFetch(`${apiBaseUrl}/tags`, { method: 'GET', signal, headers });
    const payload = await response.json();
    if (!Array.isArray(payload?.models)) throw new Error('Ollama returned an invalid model list.');
    const names = payload.models
      .map((model: any): unknown => model?.name ?? model?.model)
      .filter((name: unknown): name is string => typeof name === 'string' && Boolean(name.trim()));
    return Array.from(new Set<string>(names)).sort((left, right) => left.localeCompare(right));
  } catch (cause) {
    if (signal?.aborted) throw cause;
    const detail = cause instanceof Error ? cause.message : 'Unknown connection error';
    throw new Error(
      `Ollama model discovery failed at ${apiBaseUrl}: ${detail}. ` +
        'For remote connections, make sure Ollama listens on the VPN or LAN interface.'
    );
  }
};
