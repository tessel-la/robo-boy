import { createUuid } from '../../../utils/uuid';
import { getDesktopBridge } from '../../../runtime/desktopBridge';
import { subscriptionErrorMessage } from '../../../runtime/assistantSubscription';
import type { SendChat } from './types';
import { selectedThinkingEffort } from './thinking';

export const sendSubscriptionChat: SendChat = async ({
  settings,
  systemPrompt,
  messages,
  signal,
  jsonMode,
  onThinking,
  onToken,
  onUsage,
  tools,
  beforeStep,
  shouldYield,
  contextWindowTokens,
  sessionId,
  refreshSystemPrompt,
}) => {
  const bridge = getDesktopBridge()?.assistant;
  if (!bridge)
    throw new Error(
      'Subscription sign-in requires the updated Robo-Boy Electron desktop app. Choose API key on this device.'
    );
  if (settings.provider !== 'openai' && settings.provider !== 'anthropic')
    throw new Error('This provider does not support subscription sign-in.');
  if (tools && !bridge.onToolCall)
    throw new Error('Install the updated desktop build to use subscription host tools. No API fallback was attempted.');
  if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
  const id = createUuid();
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    void bridge.cancel(id).catch(() => {});
    rejectAbort(new DOMException('Request cancelled.', 'AbortError'));
  };
  signal?.addEventListener('abort', cancel, { once: true });
  const unsubscribe = bridge.onThinking?.(id, text => {
    if (!signal?.aborted) onThinking?.(text);
  });
  const unsubscribeToken = bridge.onToken?.(id, text => {
    if (!signal?.aborted) onToken?.(text);
  });
  const unsubscribeUsage = bridge.onUsage?.(id, usage => {
    if (!signal?.aborted) onUsage?.(usage);
  });
  const unsubscribeTools = tools
    ? bridge.onToolCall?.(id, async (name, input, callId) => {
        signal?.throwIfAborted();
        if (name === '__step') {
          beforeStep?.();
          await tools.checkpoint?.();
          return { ok: true, value: { systemPrompt: refreshSystemPrompt?.() ?? systemPrompt } };
        }
        const result = await tools.execute(name, input, callId);
        return { ...result, ...(shouldYield?.() ? { yieldRequested: true } : {}) };
      })
    : undefined;
  try {
    const result = await Promise.race([
      bridge.send(id, {
        provider: settings.provider,
        model: settings.model,
        systemPrompt,
        messages,
        jsonMode,
        ...(tools
          ? {
              nativeTools: true,
              toolNames: tools.definitions.map(tool => tool.name),
              ...(tools.scope ? { toolScope: tools.scope } : {}),
            }
          : {}),
        contextWindowTokens,
        sessionId,
        thinkingEffort: selectedThinkingEffort(settings.provider, settings.model, settings.thinkingEffort, true),
      }),
      aborted,
    ]);
    if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
    return result;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new Error(subscriptionErrorMessage(cause));
  } finally {
    unsubscribe?.();
    unsubscribeToken?.();
    unsubscribeUsage?.();
    unsubscribeTools?.();
    signal?.removeEventListener('abort', cancel);
  }
};
