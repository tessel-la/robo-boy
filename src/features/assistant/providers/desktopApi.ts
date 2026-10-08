import { getDesktopBridge } from '../../../runtime/desktopBridge';
import type { SendChatRequest } from './types';
import { subscriptionErrorMessage } from '../../../runtime/assistantSubscription';

/** Desktop network inference reads credentials natively. Only code-owned host capabilities
 * cross the request-scoped IPC bridge; never send renderer credentials with the request. */
export async function sendDesktopApi(request: SendChatRequest): Promise<string> {
  const bridge = getDesktopBridge()?.assistant;
  if (!bridge?.sendApi || !request.tools || !bridge.onToolCall)
    throw new Error('This desktop runtime does not support native API tools.');
  const id = crypto.randomUUID();
  request.signal?.throwIfAborted();
  let rejectAbort!: (cause: Error) => void;
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    void bridge.cancel(id).catch(() => {});
    rejectAbort(new DOMException('Request cancelled.', 'AbortError'));
  };
  request.signal?.addEventListener('abort', abort, { once: true });
  const stopTokens = bridge.onToken?.(id, text => {
    if (!request.signal?.aborted) request.onToken?.(text);
  });
  const stopThinking = bridge.onThinking?.(id, text => {
    if (!request.signal?.aborted) request.onThinking?.(text);
  });
  const stopUsage = bridge.onUsage?.(id, usage => {
    if (!request.signal?.aborted) request.onUsage?.(usage);
  });
  const stopTools = bridge.onToolCall(id, async (name, input, callId) => {
    request.signal?.throwIfAborted();
    if (name === '__step') {
      request.beforeStep?.();
      await request.tools?.checkpoint?.();
      return { ok: true, value: { systemPrompt: request.refreshSystemPrompt?.() ?? request.systemPrompt } };
    }
    const result = await request.tools!.execute(name, input, callId);
    return { ...result, ...(request.shouldYield?.() ? { yieldRequested: true } : {}) };
  });
  try {
    const result = await Promise.race([
      bridge.sendApi(id, {
        provider: request.settings.provider,
        model: request.settings.model,
        baseUrl: request.settings.baseUrl,
        thinkingEffort: request.settings.thinkingEffort,
        systemPrompt: request.systemPrompt,
        messages: request.messages,
        nativeTools: true,
        toolScope: request.tools.scope,
        toolNames: request.tools.definitions.map(tool => tool.name),
        contextWindowTokens: request.contextWindowTokens,
        sessionId: request.sessionId,
      }),
      cancelled,
    ]);
    request.signal?.throwIfAborted();
    return result;
  } catch (cause) {
    if (request.signal?.aborted) throw new DOMException('Request cancelled.', 'AbortError');
    throw new Error(subscriptionErrorMessage(cause));
  } finally {
    stopTokens?.();
    stopThinking?.();
    stopUsage?.();
    stopTools();
    request.signal?.removeEventListener('abort', abort);
  }
}
