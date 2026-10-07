import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { OpenAiSubscription } from './openaiSubscription';
import { ClaudeSubscription } from './claudeSubscription';
import { AssistantApiKeys } from './assistantStorage';
import { thinkingEfforts } from '../src/features/assistant/providers/thinking';
import type { SubscriptionChatRequest, SubscriptionProvider } from '../src/runtime/assistantSubscription';

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
  const requests = new Map<string, { owner: number; provider: SubscriptionProvider; controller: AbortController }>();
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
    requests.set(id, { owner: event.sender.id, provider: request.provider, controller });
    const timeout = setTimeout(() => controller.abort(), 300_000);
    try {
      const onThinking = (text: string) => {
        if (!controller.signal.aborted && epoch === epochs[request.provider] && !event.sender.isDestroyed()) {
          event.sender.send('roboboy:assistant-thinking', id, text.slice(0, 64 * 1024));
        }
      };
      const result = await (request.provider === 'openai'
        ? openai.send(request, controller.signal, onThinking)
        : claude.send(request, controller.signal, onThinking));
      controller.signal.throwIfAborted();
      if (epoch !== epochs[request.provider])
        throw new Error('The assistant account changed. Please send the message again.');
      return result;
    } finally {
      clearTimeout(timeout);
      requests.delete(id);
    }
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
