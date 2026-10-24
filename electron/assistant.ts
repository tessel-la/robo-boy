import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { OpenAiSubscription } from './openaiSubscription';
import { ClaudeSubscription } from './claudeSubscription';
import { AssistantApiKeys } from './assistantStorage';
import { thinkingEfforts } from '../src/features/assistant/providers/thinking';
import type { SubscriptionChatRequest, SubscriptionProvider } from '../src/runtime/assistantSubscription';
import type { AssistantProviderId } from '../src/features/assistant/providers/types';
import type { ModelMessage } from 'ai';
import { HOST_TOOL_DEFINITIONS } from '../src/features/assistant/tools/nativeTools';
import { SubscriptionTools } from './assistantTools';

export function subscriptionProvider(value: unknown): SubscriptionProvider {
  if (value !== 'openai' && value !== 'anthropic') throw new Error('Unsupported subscription provider.');
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    throw new Error('Invalid assistant request identifier.');
  return value;
}

export function validateSubscriptionRequest(value: unknown): SubscriptionChatRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid assistant request.');
  const input = value as SubscriptionChatRequest;
  const provider = subscriptionProvider(input.provider);
  if (
    typeof input.model !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(input.model) ||
    typeof input.systemPrompt !== 'string' ||
    input.systemPrompt.length > 16 * 1024 * 1024 ||
    (input.jsonMode !== undefined && typeof input.jsonMode !== 'boolean') ||
    (input.nativeTools !== undefined && typeof input.nativeTools !== 'boolean') ||
    (input.toolScope !== undefined && input.toolScope !== 'read-only') ||
    (input.toolNames !== undefined && (!Array.isArray(input.toolNames) || input.toolNames.length > 100 || input.toolNames.some(name => typeof name !== 'string' || !HOST_TOOL_DEFINITIONS.some(tool => tool.name === name)))) ||
    (input.contextWindowTokens !== undefined && (!Number.isInteger(input.contextWindowTokens) || input.contextWindowTokens < 4096 || input.contextWindowTokens > 2000000)) ||
    (input.sessionId !== undefined && (typeof input.sessionId !== 'string' || input.sessionId.length > 256)) ||
    !Array.isArray(input.messages) ||
    !input.messages.length ||
    input.messages.length > 1000
  )
    throw new Error('Invalid assistant request.');
  if (
    input.thinkingEffort !== undefined &&
    !thinkingEfforts(provider, input.model, true).includes(input.thinkingEffort)
  )
    throw new Error('Unsupported thinking effort for this model. Choose Model default in Assistant settings.');
  let size = input.systemPrompt.length;
  const messages = input.messages.map(turn => {
    if (
      !turn ||
      (turn.role !== 'user' && turn.role !== 'assistant') ||
      typeof turn.content !== 'string' ||
      (turn.images !== undefined && (!Array.isArray(turn.images) || turn.images.length > 20 || turn.role !== 'user'))
    ) {
      throw new Error('Invalid assistant conversation.');
    }
    size += turn.content.length;
    const images = turn.images?.map(image => {
      if (
        !image ||
        !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mimeType) ||
        typeof image.data !== 'string' ||
        image.data.length > 16 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)
      ) {
        throw new Error('Invalid assistant image. Use PNG, JPEG, WebP or GIF.');
      }
      size += image.data.length;
      return { mimeType: image.mimeType, data: image.data };
    });
    if (size > 32 * 1024 * 1024)
      throw new Error('Assistant context is too large. Shorten the conversation or attachments.');
    return { role: turn.role, content: turn.content, ...(images ? { images } : {}) };
  });
  if (messages.at(-1)?.role !== 'user') throw new Error('The assistant conversation must end with a user message.');
  const request = {
    provider,
    model: input.model,
    systemPrompt: input.systemPrompt,
    messages,
    jsonMode: input.jsonMode,
    ...(input.nativeTools ? { nativeTools: true } : {}),
    ...(input.toolScope ? { toolScope: input.toolScope } : {}),
    ...(input.toolNames ? { toolNames: input.toolNames } : {}),
    ...(input.contextWindowTokens ? { contextWindowTokens: input.contextWindowTokens } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.thinkingEffort ? { thinkingEffort: input.thinkingEffort } : {}),
  };
  if (JSON.stringify(request).length > 32 * 1024 * 1024)
    throw new Error('Assistant context is too large. Shorten the conversation or attachments.');
  return request;
}

export function assertAssistantCaller(event: IpcMainInvokeEvent, rendererOrigin: string): void {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) throw new Error('Assistant access is limited to the app window.');
  const actual = new URL(frame.url),
    expected = new URL(rendererOrigin);
  if (actual.protocol !== expected.protocol || actual.host !== expected.host)
    throw new Error('Untrusted assistant caller.');
}

export function registerAssistantSubscriptions(rendererOrigin: string): void {
  const openai = new OpenAiSubscription(join(app.getPath('userData'), 'assistant', 'chatgpt'));
  const claude = new ClaudeSubscription(join(app.getPath('userData'), 'assistant', 'claude-code'));
  const apiKeys = new AssistantApiKeys(join(app.getPath('userData'), 'assistant', 'api-keys'));
  const requests = new Map<string, { owner: number; provider: AssistantProviderId; controller: AbortController; tools?: SubscriptionTools }>();
  const apiHistory = new Map<string, { key: string; messages: ModelMessage[] }>();
  const changes = new Map<SubscriptionProvider, { owner: number; controller: AbortController }>();
  const owners = new Set<number>();
  const epochs = { openai: 0, anthropic: 0 };
  const cancelProvider = (provider: SubscriptionProvider) => {
    epochs[provider]++;
    for (const request of requests.values()) if (request.provider === provider) request.controller.abort();
  };
  const protect = (event: IpcMainInvokeEvent) => {
    assertAssistantCaller(event, rendererOrigin);
    const owner = event.sender.id;
    if (owners.has(owner)) return;
    owners.add(owner);
    const cancelOwner = () => {
      for (const request of requests.values()) if (request.owner === owner) request.controller.abort();
      for (const change of changes.values()) if (change.owner === owner) change.controller.abort();
      for (const key of apiHistory.keys()) if (key.startsWith(`${owner}:`)) apiHistory.delete(key);
    };
    event.sender.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame) cancelOwner();
    });
    event.sender.once('destroyed', () => {
      cancelOwner();
      owners.delete(owner);
    });
  };
  const state = (provider: SubscriptionProvider) => (provider === 'openai' ? openai.getState() : claude.getState());
  const change = async (
    event: IpcMainInvokeEvent,
    value: unknown,
    operation: (provider: SubscriptionProvider, signal: AbortSignal) => Promise<void>
  ) => {
    protect(event);
    const provider = subscriptionProvider(value);
    if (changes.has(provider)) throw new Error('Finish or cancel the current sign-in before changing accounts.');
    cancelProvider(provider);
    const controller = new AbortController();
    changes.set(provider, { owner: event.sender.id, controller });
    const timeout = setTimeout(() => controller.abort(), 300_000);
    try {
      await operation(provider, controller.signal);
      controller.signal.throwIfAborted();
      return await state(provider);
    } finally {
      clearTimeout(timeout);
      changes.delete(provider);
    }
  };

  ipcMain.handle('roboboy:assistant-api-key', (event, provider: unknown) => {
    protect(event);
    return apiKeys.get(provider);
  });
  ipcMain.handle('roboboy:assistant-api-key-storage', (event, provider: unknown) => {
    protect(event);
    return apiKeys.getStorage(provider);
  });
  ipcMain.handle('roboboy:assistant-save-api-key', (event, provider: unknown, key: unknown, policy?: unknown) => {
    protect(event);
    for (const request of requests.values()) if (request.provider === provider) request.controller.abort();
    apiHistory.clear();
    return apiKeys.set(provider, key, policy);
  });
  ipcMain.handle('roboboy:assistant-state', (event, value: unknown) => {
    protect(event);
    return state(subscriptionProvider(value));
  });
  ipcMain.handle('roboboy:assistant-sign-in', (event, value: unknown, accountId?: unknown) =>
    change(event, value, async (provider, signal) => {
      if (provider === 'openai')
        await openai.signIn(accountId === undefined ? undefined : identifier(accountId), signal);
      else await claude.signIn(signal);
    })
  );
  ipcMain.handle('roboboy:assistant-cancel-sign-in', (event, value: unknown) => {
    protect(event);
    const attempt = changes.get(subscriptionProvider(value));
    if (attempt?.owner === event.sender.id) attempt.controller.abort();
  });
  ipcMain.handle('roboboy:assistant-select-account', (event, value: unknown, accountId: unknown) =>
    change(event, value, async provider => {
      if (provider !== 'openai') throw new Error('Claude accounts are managed through Claude Code sign-in.');
      await openai.selectAccount(identifier(accountId));
    })
  );
  ipcMain.handle('roboboy:assistant-sign-out', (event, value: unknown) =>
    change(event, value, async (provider, signal) => {
      if (provider === 'openai') await openai.signOut();
      else await claude.signOut(signal);
    })
  );
  ipcMain.handle('roboboy:assistant-usage', (event, value: unknown) => {
    protect(event);
    return shell.openExternal(
      subscriptionProvider(value) === 'openai'
        ? 'https://chatgpt.com/settings/usage'
        : 'https://claude.ai/settings/usage'
    );
  });
  ipcMain.handle('roboboy:assistant-send', async (event, value: unknown, input: unknown) => {
    protect(event);
    const id = identifier(value),
      request = validateSubscriptionRequest(input);
    if (requests.has(id) || requests.size >= 4) throw new Error('An assistant request is already in progress.');
    if (changes.has(request.provider)) throw new Error('Finish sign-in before sending an assistant message.');
    const controller = new AbortController(),
      epoch = epochs[request.provider];
    const tools = request.nativeTools ? new SubscriptionTools(controller.signal, (callId, name, input) => {
      if (controller.signal.aborted || event.sender.isDestroyed() || epoch !== epochs[request.provider]) throw new Error('Subscription scope changed.');
      event.sender.send('roboboy:assistant-tool', id, callId, name, input);
    }, request.toolScope, request.toolNames, reason => controller.abort(reason)) : undefined;
    requests.set(id, { owner: event.sender.id, provider: request.provider, controller, tools });
    const timeout = setTimeout(() => controller.abort(new Error('The assistant task reached its 20-minute deadline. Completed changes were preserved; check their state before continuing.')), 20 * 60_000);
    try {
      const onThinking = (text: string) => {
        if (!controller.signal.aborted && epoch === epochs[request.provider] && !event.sender.isDestroyed()) {
          event.sender.send('roboboy:assistant-thinking', id, text.slice(0, 64 * 1024));
        }
      };
      const onToken = (text: string) => {
        if (!controller.signal.aborted && epoch === epochs[request.provider] && !event.sender.isDestroyed()) event.sender.send('roboboy:assistant-token', id, text.slice(0, 64 * 1024));
      };
      const onUsage = (usage: { inputTokens: number; outputTokens: number }) => { if (!controller.signal.aborted && epoch === epochs[request.provider] && !event.sender.isDestroyed()) event.sender.send('roboboy:assistant-usage-event', id, usage); };
      const result = await (request.provider === 'openai'
        ? openai.send(request, controller.signal, onThinking, tools, onToken, onUsage)
        : claude.send(request, controller.signal, onThinking, tools, onToken, onUsage));
      controller.signal.throwIfAborted();
      if (epoch !== epochs[request.provider])
        throw new Error('The assistant account changed. Please send the message again.');
      return result;
    } catch (cause) {
      // A transport may throw a generic AbortError. Preserve the owning deadline/tool reason.
      if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
      throw cause;
    } finally {
      clearTimeout(timeout);
      tools?.dispose();
      requests.delete(id);
    }
  });
  ipcMain.handle('roboboy:assistant-api-send', async (event, value: unknown, raw: unknown) => {
    protect(event);
    const id = identifier(value);
    if (!raw || typeof raw !== 'object') throw new Error('Invalid native API request.');
    const input = raw as Record<string, any>;
    if (!['openai', 'anthropic', 'gemini', 'openai-compatible', 'ollama'].includes(input.provider)) throw new Error('Unknown API provider.');
    const provider = input.provider as AssistantProviderId;
    if (typeof input.baseUrl !== 'string' || input.baseUrl.length > 2048) throw new Error('Invalid API base URL.');
    const url = new URL(input.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('Use a credential-free HTTP(S) API endpoint without query parameters.');
    const request = validateSubscriptionRequest({ ...input, provider: 'openai', thinkingEffort: undefined });
    if (input.thinkingEffort !== undefined && !thinkingEfforts(provider, request.model).includes(input.thinkingEffort)) throw new Error('Unsupported model thinking effort.');
    if (requests.has(id) || requests.size >= 4) throw new Error('An assistant request is already in progress.');
    const controller = new AbortController();
    const tools = new SubscriptionTools(controller.signal, (callId, name, args) => {
      if (controller.signal.aborted || event.sender.isDestroyed()) throw new Error('Native API scope ended.');
      event.sender.send('roboboy:assistant-tool', id, callId, name, args);
    }, request.toolScope, request.toolNames, reason => controller.abort(reason));
    requests.set(id, { owner: event.sender.id, provider, controller, tools });
    const timeout = setTimeout(() => controller.abort(new Error('The assistant task reached its 20-minute deadline. Completed changes were preserved; check their state before continuing.')), 20 * 60_000);
    try {
      const key = await apiKeys.get(provider) ?? '';
      if (!key && !['ollama', 'openai-compatible'].includes(provider)) throw new Error('Enter an API key in Assistant settings.');
      controller.signal.throwIfAborted();
      const historyId = `${event.sender.id}:${provider}:${request.model}:${url.href}:${request.sessionId ?? id}`;
      const history = apiHistory.get(historyId);
      const { sendNativeChat } = await import('../src/features/assistant/providers/native');
      return await sendNativeChat({
        settings: { provider, baseUrl: url.href, model: request.model, apiKey: key, thinkingEffort: input.thinkingEffort },
        systemPrompt: request.systemPrompt, messages: request.messages, signal: controller.signal, tools, contextWindowTokens: request.contextWindowTokens,
        refreshSystemPrompt: () => tools.systemPrompt ?? request.systemPrompt,
        nativeHistory: history?.key === key ? history.messages : undefined,
        onNativeMessages: messages => {
          if (controller.signal.aborted || JSON.stringify(messages).length > 320_000) return;
          apiHistory.set(historyId, { key, messages });
          if (apiHistory.size > 20) apiHistory.delete(apiHistory.keys().next().value!);
        },
        onToken: text => { if (!controller.signal.aborted && !event.sender.isDestroyed()) event.sender.send('roboboy:assistant-token', id, text.slice(0, 64 * 1024)); },
        onThinking: text => { if (!controller.signal.aborted && !event.sender.isDestroyed()) event.sender.send('roboboy:assistant-thinking', id, text.slice(0, 64 * 1024)); },
        onUsage: usage => { if (!controller.signal.aborted && !event.sender.isDestroyed()) event.sender.send('roboboy:assistant-usage-event', id, usage); },
      });
    } catch (cause) {
      if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
      throw cause;
    } finally { clearTimeout(timeout); tools.dispose(); requests.delete(id); }
  });
  ipcMain.handle('roboboy:assistant-tool-result', (event, id: unknown, callId: unknown, value: unknown) => {
    protect(event);
    const request = requests.get(identifier(id));
    if (!request?.tools || request.owner !== event.sender.id) throw new Error('Untrusted host tool reply.');
    request.tools.reply(identifier(callId), value);
    if ((value as { yieldRequested?: unknown })?.yieldRequested === true) setImmediate(() => request.controller.abort());
  });
  ipcMain.handle('roboboy:assistant-cancel', (event, value: unknown) => {
    protect(event);
    const request = requests.get(identifier(value));
    if (request?.owner === event.sender.id) request.controller.abort();
  });
  app.once('before-quit', () => {
    for (const request of requests.values()) request.controller.abort();
    for (const change of changes.values()) change.controller.abort();
  });
}
