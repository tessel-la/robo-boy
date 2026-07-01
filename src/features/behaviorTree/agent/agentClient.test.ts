import { afterEach, describe, expect, it, vi } from 'vitest';
import { BehaviorNodeType, BehaviorTree } from '../types';
import { buildBehaviorTreeAgentPrompt, generateBehaviorTree, transcribeAgentAudio } from './agentClient';
import { getDefaultAgentSettings } from './agentStorage';

const tree: BehaviorTree = {
  id: 'tree',
  name: 'Mission',
  nodes: [
    { id: 'root', type: BehaviorNodeType.Sequence, position: { x: 0, y: 0 }, data: { label: 'Mission', type: 'sequence' } },
  ],
  edges: [],
  createdAt: 1,
  updatedAt: 1,
};

describe('buildBehaviorTreeAgentPrompt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('directs the model to infer routine movement values autonomously', () => {
    const prompt = buildBehaviorTreeAgentPrompt({
      prompt: 'Move forward and inspect.',
      settings: getDefaultAgentSettings(),
      currentTree: null,
      rosResources: { actions: [], services: [], topics: [] },
      resourceSchemas: { actions: {}, services: {} },
    });

    expect(prompt).toContain('act autonomously');
    expect(prompt).toContain('set unspecified displacement axes to 0');
    expect(prompt).toContain('Never ask about a field that has a schema default');
    expect(prompt).toContain('Ask at most once in the entire conversation');
    expect(prompt).toContain('subscriber|subtree');
    expect(prompt).toContain('blackboardDefaults');
    expect(prompt).toContain('sourceHandle "then" and "else"');
  });

  it('serializes combined open-tree and selected-tree context when supplied', () => {
    const selectedTree: BehaviorTree = {
      ...tree,
      id: 'selection',
      name: 'Mission — selected part',
    };
    const prompt = buildBehaviorTreeAgentPrompt({
      prompt: 'Improve this part.',
      settings: getDefaultAgentSettings(),
      currentTree: null,
      treeContext: {
        mode: 'open-and-selection',
        openTree: tree,
        selectedTree,
        note: 'Use full tree plus focused selection.',
      },
      rosResources: { actions: [], services: [], topics: [] },
      resourceSchemas: { actions: {}, services: {} },
    });

    expect(prompt).toContain('"mode":"open-and-selection"');
    expect(prompt).toContain('"openTree"');
    expect(prompt).toContain('"selectedTree"');
    expect(prompt).toContain('Use full tree plus focused selection.');
  });

  it('streams OpenAI-compatible chat completions and reports tokens', async () => {
    const tokens: string[] = [];
    const progress: string[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{\\"name\\":\\"Move"}}]}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":" done"}}]}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    ));

    const result = await generateBehaviorTree({
      prompt: 'Move',
      settings: { ...getDefaultAgentSettings(), apiKey: 'local-key' },
      currentTree: null,
      rosResources: { actions: [], services: [], topics: [] },
      resourceSchemas: { actions: {}, services: {} },
      onToken: token => tokens.push(token),
      onProgress: message => progress.push(message),
    });

    expect(result).toBe('{"name":"Move done');
    expect(tokens).toEqual(['{"name":"Move', ' done']);
    expect(progress).toEqual([
      'Contacting openai-compatible (qwen2.5-coder:7b)…',
      'Receiving and assembling the tree…',
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer local-key' }),
      })
    );
    expect(JSON.parse((fetchMock.mock.calls[0][1]?.body ?? '{}') as string)).toMatchObject({
      model: 'qwen2.5-coder:7b',
      stream: true,
      response_format: { type: 'json_object' },
    });
  });

  it('streams Gemini content through the configured model endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"{\\"name\\":\\"Gemini\\"}"}]}}]}\n\n'));
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    ));

    const result = await generateBehaviorTree({
      prompt: 'Build',
      settings: {
        ...getDefaultAgentSettings(),
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
        model: 'gemini-2.5-flash',
        apiKey: 'gemini-key',
      },
      currentTree: null,
      rosResources: { actions: [], services: [], topics: [] },
      resourceSchemas: { actions: {}, services: {} },
    });

    expect(result).toBe('{"name":"Gemini"}');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-key' }),
      })
    );
    expect(JSON.parse((fetchMock.mock.calls[0][1]?.body ?? '{}') as string)).toMatchObject({
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    });
  });

  it('surfaces provider errors with parsed API messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: { message: 'Bad model' } }),
      { status: 400, statusText: 'Bad Request' }
    ));

    await expect(generateBehaviorTree({
      prompt: 'Build',
      settings: getDefaultAgentSettings(),
      currentTree: null,
      rosResources: { actions: [], services: [], topics: [] },
      resourceSchemas: { actions: {}, services: {} },
    })).rejects.toThrow('400 Bad Request: Bad model');
  });
});

describe('transcribeAgentAudio', () => {
  it('sends recorded audio to an OpenAI-compatible transcription endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ text: 'move to the charging station' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    const settings = { ...getDefaultAgentSettings(), apiKey: 'local-key' };

    await expect(transcribeAgentAudio(new Blob(['audio'], { type: 'audio/webm' }), settings))
      .resolves.toBe('move to the charging station');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer local-key' } })
    );
    const form = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[1]?.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('selects the OpenAI transcription model internally', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ text: 'stop the robot' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    const settings = {
      ...getDefaultAgentSettings(),
      provider: 'openai' as const,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'openai-key',
    };

    await transcribeAgentAudio(new Blob(['audio'], { type: 'audio/webm' }), settings);

    const form = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[1]?.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
  });

  it('uses the configured Gemini model for audio instead of an OpenAI model name', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'move forward' }] } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    const settings = {
      ...getDefaultAgentSettings(),
      provider: 'gemini' as const,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
      apiKey: 'gemini-key',
    };

    await expect(transcribeAgentAudio(new Blob(['audio'], { type: 'audio/webm' }), settings))
      .resolves.toBe('move forward');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('requires provider credentials for cloud transcription', async () => {
    const settings = { ...getDefaultAgentSettings(), provider: 'openai' as const, baseUrl: 'https://api.openai.com/v1' };
    await expect(transcribeAgentAudio(new Blob(['audio']), settings)).rejects.toThrow('Add an API key for openai');
  });
});
