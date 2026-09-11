import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetchOllamaModels } from './index';

// The model picker in Assistant settings is the only place a user finds out whether their Ollama
// host is reachable at all, so what this returns -- and what it says when it cannot -- is the
// whole diagnostic.

describe('fetchOllamaModels', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  const tags = (payload: unknown) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it.each([
    ['http://host:11434', 'http://host:11434/api/tags'],
    ['http://host:11434/', 'http://host:11434/api/tags'],
    // An OpenAI-compatible base URL is what the other providers use, so people paste that here too.
    ['http://host:11434/v1', 'http://host:11434/api/tags'],
    ['http://host:11434/api', 'http://host:11434/api/tags'],
    ['/ollama', '/ollama/api/tags'],
  ])('resolves %s to the native API at %s', async (baseUrl, expected) => {
    fetchMock.mockResolvedValue(tags({ models: [{ name: 'llama3' }] }));

    await fetchOllamaModels(baseUrl);

    expect(fetchMock.mock.calls[0][0]).toBe(expected);
  });

  it('returns a sorted, de-duplicated list and accepts either name field', async () => {
    fetchMock.mockResolvedValue(
      tags({ models: [{ name: 'qwen' }, { model: 'llama3' }, { name: 'qwen' }, { name: '  ' }, {}, null] })
    );

    await expect(fetchOllamaModels('http://host:11434')).resolves.toEqual(['llama3', 'qwen']);
  });

  it('sends a bearer token only when one is configured', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(tags({ models: [] })));

    await fetchOllamaModels('http://host:11434', '  ');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});

    await fetchOllamaModels('http://host:11434', ' secret ');
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer secret' });
  });

  it('names the URL it tried and points at the usual cause when discovery fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetchOllamaModels('http://robot.local:11434')).rejects.toThrow(
      /Could not reach http:\/\/robot\.local:11434\/api\/tags: Failed to fetch\..*For remote connections, make sure Ollama listens/s
    );
  });

  it('rejects a response that is not a model list', async () => {
    fetchMock.mockResolvedValue(tags({ models: 'llama3' }));

    await expect(fetchOllamaModels('http://host:11434')).rejects.toThrow('Ollama returned an invalid model list.');
  });

  it('refuses an empty base URL instead of fetching a relative /api/tags', async () => {
    await expect(fetchOllamaModels('   ')).rejects.toThrow('Set the Ollama base URL before loading models.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rethrows an abort untouched, so a cancelled refresh is not reported as a host failure', async () => {
    const controller = new AbortController();
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(abort);
    });

    await expect(fetchOllamaModels('http://host:11434', '', controller.signal)).rejects.toBe(abort);
  });
});
