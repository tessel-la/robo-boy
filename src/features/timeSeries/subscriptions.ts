import type { TopicSource } from './config';

export interface ManagedSubscription {
  unsubscribe(): Promise<void>;
}

export type SubscribeToSource = (
  source: TopicSource,
  listener: (message: unknown) => void
) => Promise<ManagedSubscription>;

interface Entry {
  source: TopicSource;
  token: number;
  subscription: ManagedSubscription | null;
}

const sameSource = (left: TopicSource, right: TopicSource): boolean =>
  left.key === right.key &&
  left.topic === right.topic &&
  left.messageType === right.messageType &&
  left.throttleMs === right.throttleMs;

/** Reconciles desired ROS sources and rejects late async subscriptions safely. */
export class SubscriptionController {
  private readonly entries = new Map<string, Entry>();
  private nextToken = 0;
  private disposed = false;

  constructor(
    private readonly subscribe: SubscribeToSource,
    private readonly onMessage: (source: TopicSource, message: unknown) => void,
    private readonly onError: (source: TopicSource, error: unknown, operation: 'subscribe' | 'unsubscribe') => void,
    private readonly onChange: () => void = () => undefined
  ) {}

  get size(): number {
    return this.entries.size;
  }

  reconcile(desired: readonly TopicSource[]): void {
    if (this.disposed) return;
    const next = new Map(desired.map(source => [source.key, source]));
    [...this.entries.entries()].forEach(([key, entry]) => {
      const replacement = next.get(key);
      if (!replacement || !sameSource(entry.source, replacement)) this.remove(key);
    });
    desired.forEach(source => {
      if (!this.entries.has(source.key)) this.add(source);
    });
    this.onChange();
  }

  restart(desired: readonly TopicSource[]): void {
    [...this.entries.keys()].forEach(key => this.remove(key));
    this.reconcile(desired);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    [...this.entries.keys()].forEach(key => this.remove(key));
  }

  private add(source: TopicSource): void {
    const token = ++this.nextToken;
    const entry: Entry = { source, token, subscription: null };
    this.entries.set(source.key, entry);
    void this.subscribe(source, message => {
      const current = this.entries.get(source.key);
      if (!this.disposed && current?.token === token) this.onMessage(source, message);
    }).then(
      subscription => {
        const current = this.entries.get(source.key);
        if (this.disposed || current?.token !== token) {
          this.release(source, subscription);
          return;
        }
        current.subscription = subscription;
        this.onChange();
      },
      error => {
        const current = this.entries.get(source.key);
        if (current?.token !== token) return;
        this.entries.delete(source.key);
        this.onError(source, error, 'subscribe');
        this.onChange();
      }
    );
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    entry.token = ++this.nextToken;
    if (entry.subscription) this.release(entry.source, entry.subscription);
  }

  private release(source: TopicSource, subscription: ManagedSubscription): void {
    void subscription.unsubscribe().catch(error => {
      this.onError(source, error, 'unsubscribe');
    });
  }
}
