import { randomUUID } from 'node:crypto';
import {
  HOST_TOOL_DEFINITIONS,
  READ_ONLY_TOOL_DEFINITIONS,
  type HostTools,
  type HostToolResult,
} from '../src/features/assistant/tools/nativeTools';

/** One trusted-window/request scope. A panel, another window or a late reply cannot resolve
 * this request's tools. The main process never accepts tool definitions from the renderer. */
export class SubscriptionTools implements HostTools {
  readonly definitions;
  private pending = new Map<
    string,
    { resolve(value: HostToolResult): void; reject(error: Error): void; cleanup(): void }
  >();
  private count = 0;
  systemPrompt?: string;
  private calls = new Map<string, { signature: string; result: Promise<HostToolResult> }>();
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  constructor(
    private signal: AbortSignal,
    private dispatch: (id: string, name: string, input: unknown) => void,
    readonly scope?: 'read-only',
    names?: string[],
    private expired: (reason: Error) => void = () => {}
  ) {
    this.definitions = (scope ? READ_ONLY_TOOL_DEFINITIONS : HOST_TOOL_DEFINITIONS).filter(
      tool => !names || names.includes(tool.name)
    );
  }
  async checkpoint(): Promise<void> {
    const result = await this.execute('__step', {});
    if (!result.ok) throw new Error(result.error || 'Runtime boundary rejected.');
    const prompt = (result.value as { systemPrompt?: unknown })?.systemPrompt;
    if (typeof prompt === 'string' && prompt.length <= 128 * 1024) this.systemPrompt = prompt;
  }

  execute(name: string, input: unknown, callId?: string): Promise<HostToolResult> {
    if (this.disposed) return Promise.reject(new Error('Subscription request ended.'));
    this.signal.throwIfAborted();
    if (name !== '__step' && !this.definitions.some(tool => tool.name === name))
      return Promise.resolve({ ok: false, error: 'Unknown Robo-Boy host tool.' });
    if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 256 * 1024)
      return Promise.resolve({ ok: false, error: 'Invalid or oversized tool arguments.' });
    const signature = JSON.stringify({ name, input });
    const prior = callId ? this.calls.get(callId) : undefined;
    if (prior)
      return prior.signature === signature
        ? prior.result
        : Promise.resolve({ ok: false, error: 'Tool call identity changed arguments.' });
    if (name !== '__step' && ++this.count > 150)
      return Promise.resolve({ ok: false, error: 'This request reached its tool allowance.' });
    const id = randomUUID();
    // The renderer serializes host effects. Start each deadline only when its call is dispatched,
    // not while it is waiting behind another read or an operator question.
    const result = this.queue.then(() => {
      if (this.disposed) throw new Error('Subscription request ended.');
      this.signal.throwIfAborted();
      return new Promise<HostToolResult>((resolve, reject) => {
        const abort = () => {
          cleanup();
          reject(new Error('Subscription tool cancelled.'));
        };
        const timeout = setTimeout(
          () => {
            cleanup();
            const reason = new Error(
              `Host tool ${name} timed out. The task was stopped; completed changes were preserved. Check current state before retrying edits.`
            );
            reason.name = 'TimeoutError';
            this.expired(reason);
            resolve({
              ok: false,
              error: 'Host tool timed out. The request was stopped; check state before retrying edits.',
            });
          },
          ['ask_user', 'wait_agent', 'delegate_read'].includes(name) ? 20 * 60_000 : 30_000
        );
        const cleanup = () => {
          clearTimeout(timeout);
          this.signal.removeEventListener('abort', abort);
          this.pending.delete(id);
        };
        this.pending.set(id, { resolve, reject, cleanup });
        this.signal.addEventListener('abort', abort, { once: true });
        try {
          this.dispatch(id, name, input);
        } catch (cause) {
          cleanup();
          reject(cause);
        }
      });
    });
    this.queue = result.then(
      () => {},
      () => {}
    );
    if (callId) this.calls.set(callId, { signature, result });
    return result;
  }

  reply(id: string, value: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) throw new Error('Unknown or expired tool reply.');
    if (
      !value ||
      typeof value !== 'object' ||
      typeof (value as HostToolResult).ok !== 'boolean' ||
      JSON.stringify(value).length > 20 * 1024 * 1024
    )
      throw new Error('Invalid tool result.');
    const result = value as HostToolResult;
    if (JSON.stringify({ ...result, image: undefined }).length > 128 * 1024)
      throw new Error('Tool text result is too large.');
    if (
      result.image &&
      (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(result.image.mimeType) ||
        typeof result.image.data !== 'string' ||
        result.image.data.length > 16 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(result.image.data))
    )
      throw new Error('Invalid tool image.');
    this.signal.throwIfAborted();
    pending.cleanup();
    pending.resolve(result);
  }

  dispose(): void {
    this.disposed = true;
    for (const pending of [...this.pending.values()]) {
      pending.cleanup();
      pending.reject(new Error('Subscription request ended.'));
    }
  }
}
