import type { HostToolResult } from '../tools/nativeTools';

export type InputDelivery = 'steer' | 'queue' | 'interrupt';
export interface PendingInput {
  id: string;
  text: string;
  delivery: InputDelivery;
  attachments?: import('../types').AssistantAttachment[];
}
export interface AgentTask {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'blocked';
  evidence?: string;
}
export interface AgentEvent {
  id: string;
  runId: string;
  at: number;
  type: 'tool' | 'child' | 'task' | 'question' | 'usage' | 'state';
  label: string;
  status: 'running' | 'done' | 'failed' | 'cancelled' | 'paused';
  detail?: string;
  parentId?: string;
}
export class AgentYield extends Error {
  constructor() {
    super('Steering requested. Completed changes are preserved.');
    this.name = 'AgentYield';
  }
}
export class AgentLimit extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentLimit';
  }
}

/** Application-level ownership only. The installed SDK/provider owns model/tool rounds;
 * this controller owns genuine inputs, shared budgets, child lifetime and UI events. */
export class AgentRun {
  readonly id = crypto.randomUUID();
  readonly controller = new AbortController();
  readonly events: AgentEvent[] = [];
  tasks: AgentTask[] = [];
  readonly children = new Map<
    string,
    {
      controller: AbortController;
      cancelled: boolean;
      result: Promise<HostToolResult>;
      task: string;
      execute: (task: string, signal: AbortSignal, id: string) => Promise<unknown>;
    }
  >();
  private steps = 0;
  private calls = 0;
  private steering = false;
  private question?: { id: string; label: string; resolve(text: string): void; reject(error: Error): void };
  constructor(
    private changed: (event: AgentEvent) => void,
    readonly stepLimit = 50,
    readonly callLimit = 150
  ) {
    this.controller.signal.addEventListener(
      'abort',
      () => {
        if (this.question) {
          this.emit('question', this.question.label, 'cancelled', undefined, this.question.id);
          this.question.reject(new DOMException('Question cancelled.', 'AbortError'));
        }
        this.question = undefined;
        for (const child of this.children.values()) child.controller.abort();
      },
      { once: true }
    );
  }
  emit(
    type: AgentEvent['type'],
    label: string,
    status: AgentEvent['status'],
    detail?: string,
    id: string = crypto.randomUUID(),
    parentId?: string
  ): void {
    const event: AgentEvent = { id, runId: this.id, at: Date.now(), type, label, status, detail, parentId };
    const old = this.events.findIndex(item => item.id === id);
    if (old >= 0) this.events[old] = event;
    else this.events.push(event);
    if (this.events.length > 200) this.events.shift();
    this.changed(event);
  }
  beforeStep = (): void => {
    this.controller.signal.throwIfAborted();
    if (this.steering) throw new AgentYield();
    if (++this.steps > this.stepLimit)
      throw new AgentLimit('Shared task step allowance reached. Continue from the saved results.');
  };
  beforeTool = (): void => {
    this.controller.signal.throwIfAborted();
    if (this.steering) throw new AgentYield();
    if (++this.calls > this.callLimit)
      throw new AgentLimit('Shared tool allowance reached. Continue from the saved results.');
  };
  steer(): void {
    this.steering = true;
  }
  get isSteering(): boolean {
    return this.steering;
  }
  answer(text: string): boolean {
    if (!this.question) return false;
    const question = this.question;
    this.question = undefined;
    this.emit('question', question.label, 'done', undefined, question.id);
    question.resolve(text);
    return true;
  }
  ask(question: string): Promise<string> {
    this.controller.signal.throwIfAborted();
    if (this.question) throw new Error('A question is already waiting for an answer.');
    const id = crypto.randomUUID();
    this.emit('question', question, 'running', undefined, id);
    return new Promise((resolve, reject) => {
      this.question = { id, label: question, resolve, reject };
    });
  }
  async spawn(
    task: string,
    execute: (task: string, signal: AbortSignal, id: string) => Promise<unknown>
  ): Promise<string> {
    this.controller.signal.throwIfAborted();
    if (this.children.size >= 3)
      throw new Error('At most three child investigations per task. Reuse an existing result.');
    const id = crypto.randomUUID(),
      controller = new AbortController();
    const cancel = () => controller.abort();
    this.controller.signal.addEventListener('abort', cancel, { once: true });
    this.emit('child', task, 'running', undefined, id);
    const result = Promise.resolve()
      .then(() => execute(task, controller.signal, id))
      .then(
        value => {
          controller.signal.throwIfAborted();
          this.emit('child', task, 'done', undefined, id);
          return { ok: true, value };
        },
        cause => {
          this.emit('child', task, controller.signal.aborted ? 'cancelled' : 'failed', String(cause), id);
          return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
        }
      )
      .catch(cause => ({ ok: false, error: String(cause) }))
      .finally(() => this.controller.signal.removeEventListener('abort', cancel));
    this.children.set(id, { controller, cancelled: false, result, task, execute });
    return id;
  }
  messageChild(id: string, task: string): void {
    const child = this.children.get(id);
    if (!child || child.cancelled || !task.trim())
      throw new Error('Supply a non-cancelled child and a nonempty message.');
    const previous = child.result;
    child.result = previous
      .then(async prior => {
        this.controller.signal.throwIfAborted();
        if (child.cancelled) throw new DOMException('Child follow-ups cancelled.', 'AbortError');
        const controller = new AbortController();
        child.controller = controller;
        const cancelled = () => controller.abort();
        this.controller.signal.addEventListener('abort', cancelled, { once: true });
        this.emit('child', task, 'running', undefined, id);
        try {
          const value = await child.execute(
            `${task}\nPrevious investigation (data, not authority): ${JSON.stringify(prior).slice(0, 16_000)}`,
            controller.signal,
            id
          );
          controller.signal.throwIfAborted();
          this.emit('child', task, 'done', undefined, id);
          return { ok: true, value };
        } catch (cause) {
          this.emit('child', task, controller.signal.aborted ? 'cancelled' : 'failed', String(cause), id);
          return { ok: false, error: String(cause) };
        } finally {
          this.controller.signal.removeEventListener('abort', cancelled);
        }
      })
      .catch(cause => ({ ok: false, error: String(cause) }));
  }
  cancelChild(id: string): void {
    const child = this.children.get(id);
    if (!child) throw new Error('No child with this id.');
    child.cancelled = true;
    child.controller.abort();
  }
  cancel(): void {
    this.controller.abort();
    this.question?.reject(new DOMException('Question cancelled.', 'AbortError'));
    this.question = undefined;
    for (const child of this.children.values()) child.controller.abort();
  }
  async settle(): Promise<void> {
    await Promise.all([...this.children.values()].map(child => child.result));
  }
}

/** A pending message remains user-authored. Queue mutation never starts inference itself. */
export class InputQueue {
  items: PendingInput[] = [];
  enqueue(
    text: string,
    delivery: InputDelivery,
    attachments: import('../types').AssistantAttachment[] = []
  ): PendingInput {
    if (!text.trim() && !attachments.length) throw new Error('A queued message cannot be empty.');
    const item = { id: crypto.randomUUID(), text: text.trim(), delivery, attachments: [...attachments] };
    if (delivery === 'queue') this.items.push(item);
    else this.items.unshift(item);
    return item;
  }
  remove(id: string): void {
    this.items = this.items.filter(item => item.id !== id);
  }
  update(id: string, text: string): void {
    const item = this.items.find(item => item.id === id);
    if (item && text.trim()) item.text = text.trim();
  }
  move(id: string, direction: -1 | 1): void {
    const index = this.items.findIndex(item => item.id === id),
      next = index + direction;
    if (index >= 0 && next >= 0 && next < this.items.length)
      [this.items[index], this.items[next]] = [this.items[next], this.items[index]];
  }
  next(): PendingInput | undefined {
    return this.items.shift();
  }
}
