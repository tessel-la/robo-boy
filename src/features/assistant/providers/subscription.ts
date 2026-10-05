import { getDesktopBridge } from '../../../runtime/desktopBridge';
import { subscriptionErrorMessage } from '../../../runtime/assistantSubscription';
import type { SendChat } from './types';
import { selectedThinkingEffort } from './thinking';

export const sendSubscriptionChat: SendChat = async ({ settings, systemPrompt, messages, signal, jsonMode }) => {
  const bridge = getDesktopBridge()?.assistant;
  if (!bridge)
    throw new Error(
      'Subscription sign-in requires the updated Robo-Boy Electron desktop app. Choose API key on this device.'
    );
  if (settings.provider !== 'openai' && settings.provider !== 'anthropic')
    throw new Error('This provider does not support subscription sign-in.');
  if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
  const id = crypto.randomUUID();
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    void bridge.cancel(id).catch(() => {});
    rejectAbort(new DOMException('Request cancelled.', 'AbortError'));
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await Promise.race([
      bridge.send(id, { provider: settings.provider, model: settings.model, systemPrompt, messages, jsonMode,
        thinkingEffort: selectedThinkingEffort(settings.provider, settings.model, settings.thinkingEffort, true) }),
      aborted,
    ]);
    if (signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
    return result;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new Error(subscriptionErrorMessage(cause));
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
};
