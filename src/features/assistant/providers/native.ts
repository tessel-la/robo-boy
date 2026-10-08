import { streamText, jsonSchema, tool, isStepCount, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOllama } from 'ollama-ai-provider-v2';
import type { SendChatRequest } from './types';
import type { HostToolResult } from '../tools/nativeTools';
import { selectedThinkingEffort } from './thinking';
import { compactSessionHistory, contextSize } from '../runtime/context';

export function nativeModel(settings: SendChatRequest['settings']): LanguageModel {
  const { provider, apiKey, model } = settings;
  const baseURL = settings.baseUrl.replace(/\/+$/, '');
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey, baseURL }).responses(model);
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL, headers: { 'anthropic-dangerous-direct-browser-access': 'true' } })(
        model
      );
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey, baseURL })(model);
    case 'openai-compatible':
      return createOpenAICompatible({ name: 'compatible', apiKey: apiKey || undefined, baseURL }).chatModel(model);
    case 'ollama':
      return createOllama({
        baseURL: baseURL.endsWith('/api') ? baseURL : `${baseURL.replace(/\/v1$/, '')}/api`,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      })(model);
  }
}

export function nativeMessages(turns: SendChatRequest['messages']): ModelMessage[] {
  // Bound historical text, keeping the current request intact. Native call/result groups are
  // retained together by the SDK within the turn; never slice individual tool messages.
  let remaining = 120_000;
  if ((turns[turns.length - 1]?.content.length ?? 0) > remaining)
    throw new Error('The current request exceeds the 120 KiB text budget. Attach a smaller excerpt.');
  const selected: typeof turns = [];
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    if (index !== turns.length - 1 && turn.content.length > remaining) break;
    selected.unshift(turn);
    remaining -= turn.content.length;
  }
  return selected.map(turn =>
    turn.role === 'assistant'
      ? { role: 'assistant', content: turn.content }
      : {
          role: 'user',
          content: [
            { type: 'text', text: turn.content },
            ...(turn.images ?? []).map(image => ({
              type: 'image' as const,
              image: image.data,
              mediaType: image.mimeType,
            })),
          ],
        }
  );
}

/** Trim complete assistant/tool groups, never a single result or its reasoning signature. The
 * latest group and current user request are mandatory; if those alone exceed budget, stop. */
export function compactNativeMessages(
  initial: ModelMessage[],
  responses: ModelMessage[],
  budget: number
): ModelMessage[] {
  const groups: ModelMessage[][] = [];
  for (const message of responses) {
    if (message.role === 'assistant' || !groups.length) groups.push([]);
    groups[groups.length - 1].push(message);
  }
  const size = contextSize;
  let used = size(initial);
  const retained: ModelMessage[][] = [];
  for (let index = groups.length - 1; index >= 0; index--) {
    const count = size(groups[index]);
    if (used + count > budget) {
      if (index === groups.length - 1)
        throw new Error('The current tool result and request exceed the context budget. Read a smaller resource.');
      break;
    }
    retained.unshift(groups[index]);
    used += count;
  }
  if (used > budget) throw new Error('The request exceeds the context budget. Start a shorter conversation.');
  const omitted = groups.slice(0, groups.length - retained.length);
  const receipts = omitted
    .flatMap(group =>
      group.flatMap(message =>
        message.role !== 'tool'
          ? []
          : message.content.flatMap(part =>
              part.type === 'tool-result' &&
              ['edit_workspace', 'save_document', 'patch_pad', 'patch_tree', 'undo_document', 'start_monitor'].includes(
                part.toolName
              )
                ? [{ tool: part.toolName, callId: part.toolCallId, result: JSON.stringify(part.output).slice(0, 1000) }]
                : []
            )
      )
    )
    .slice(-8);
  const summary: ModelMessage = {
    role: 'assistant',
    content: `Earlier complete steps were omitted. Completed effects remain applied: ${JSON.stringify(receipts)}. Read current state; do not repeat edits simply because observations were compacted.`,
  };
  const remaining = budget - size([...initial, ...retained.flat()]);
  if (typeof summary.content === 'string') summary.content = summary.content.slice(0, Math.max(0, remaining - 80));
  return [...initial, ...(omitted.length && summary.content ? [summary] : []), ...retained.flat()];
}

/** One native model/tool conversation. The SDK owns tool ids, paired observations, vendor
 * reasoning metadata and multi-step replay; the host owns every effect and validation. */
export async function sendNativeChat(request: SendChatRequest): Promise<string> {
  if (!request.tools) throw new Error('Native chat needs host tools.');
  const tools: ToolSet = {};
  for (const definition of request.tools.definitions) {
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema),
      providerOptions: { openai: { strict: false } },
      execute: (input, { toolCallId }) => request.tools!.execute(definition.name, input, toolCallId),
      toModelOutput: ({ output }) => {
        const result = output as HostToolResult;
        if (!result.image) return { type: 'json', value: JSON.parse(JSON.stringify(result)) };
        return {
          type: 'content',
          value: [
            { type: 'text', text: JSON.stringify({ ...result, image: undefined }) },
            { type: 'image-data', data: result.image.data, mediaType: result.image.mimeType },
          ],
        };
      },
    });
  }
  const effort = selectedThinkingEffort(
    request.settings.provider,
    request.settings.model,
    request.settings.thinkingEffort
  );
  const initial = request.nativeHistory
    ? [...request.nativeHistory, ...nativeMessages(request.messages.slice(-1))]
    : nativeMessages(request.messages);
  const nativeRounds: ModelMessage[] = [];
  const windowTokens = request.contextWindowTokens ?? 32_768;
  const maxOutputTokens = Math.min(request.tools.scope ? 4096 : 8192, Math.floor(windowTokens / 4));
  const providerOptions: Parameters<typeof streamText>[0]['providerOptions'] =
    request.settings.provider === 'openai'
      ? {
          openai: {
            store: false,
            ...(/^(?:gpt-[56](?:[.-]|$)|o[134](?:-|$))/.test(request.settings.model)
              ? { reasoningSummary: 'auto' }
              : {}),
            ...(effort ? { reasoningEffort: effort } : {}),
          },
        }
      : request.settings.provider === 'anthropic' && effort
        ? { anthropic: { effort, thinking: { type: 'adaptive' } } }
        : undefined;
  const result = streamText({
    model: nativeModel(request.settings),
    tools,
    messages: initial,
    system: request.systemPrompt,
    abortSignal: request.signal,
    stopWhen: isStepCount(request.tools.scope ? 10 : 50),
    maxRetries: 1,
    maxOutputTokens,
    providerOptions,
    onError: () => {},
    prepareStep: async ({ initialMessages, responseMessages }) => {
      request.beforeStep?.();
      await request.tools?.checkpoint?.();
      const system = request.refreshSystemPrompt?.() ?? request.systemPrompt;
      const budget =
        Math.floor((windowTokens - maxOutputTokens - 2048) * 3) -
        system.length -
        JSON.stringify(request.tools!.definitions).length;
      let lastGroup = responseMessages.length - 1;
      while (lastGroup > 0 && responseMessages[lastGroup].role !== 'assistant') lastGroup--;
      const latestSize = contextSize(responseMessages.slice(Math.max(0, lastGroup)));
      const historical = compactSessionHistory(initialMessages, Math.max(1, budget - latestSize - 512));
      return { system, messages: compactNativeMessages(historical, responseMessages, budget) };
    },
    onStepFinish: ({ response, usage }) => {
      nativeRounds.push(...response.messages);
      request.onNativeMessages?.([...initial, ...nativeRounds]);
      request.onUsage?.({ inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 });
    },
  });
  let text = '';
  for await (const part of result.fullStream) {
    request.signal?.throwIfAborted();
    if (part.type === 'text-delta') {
      text += part.text;
      request.onToken?.(part.text);
    }
    if (part.type === 'reasoning-delta') request.onThinking?.(part.text);
    if (part.type === 'tool-error')
      request.onProgress?.(
        `Tool ${part.toolName} failed: ${part.error instanceof Error ? part.error.message : String(part.error)}`
      );
    if (part.type === 'error') throw part.error;
    if (text.length > 256 * 1024) throw new Error('The assistant answer exceeded the text limit.');
  }
  const finishReason = await result.finishReason;
  if (finishReason === 'tool-calls')
    throw new Error(
      'The assistant reached its step allowance. Completed changes remain visible; continue from those results.'
    );
  if (finishReason === 'length')
    throw new Error('The assistant exhausted its output budget. Continue with a smaller request.');
  return text.trim() || 'Tool work completed. Review the results above.';
}
