import { documentRevision } from './nativeTools';

export type DocumentKind = 'pad' | 'behaviorTree';
export interface DocumentCheckpoint {
  id: string;
  kind: DocumentKind;
  documentId: string;
  before: unknown;
  intended?: unknown;
  afterRevision?: string;
  state: 'pending' | 'committed' | 'restored' | 'conflicted';
  createdAt: number;
}
export interface DocumentOwner {
  read(kind: DocumentKind, id: string): unknown;
  save(kind: DocumentKind, document: unknown): boolean;
  remove(kind: DocumentKind, id: string): boolean;
}

/** The existing document stores stay authoritative. Journal intent before mutating them;
 * on interruption reconcile against revisions, never blindly replay a document write. */
export class DocumentChanges {
  readonly checkpoints: DocumentCheckpoint[];
  private queue = Promise.resolve();
  private storageError?: Error;
  constructor(
    private owner: DocumentOwner,
    private key: string
  ) {
    try {
      const raw = localStorage.getItem(key) ?? '[]';
      if (raw.length > 2 * 1024 * 1024) throw new Error('Checkpoint storage is oversized. Export it before editing.');
      const stored = JSON.parse(raw);
      if (
        !Array.isArray(stored) ||
        stored.some(
          item =>
            !item ||
            typeof item.id !== 'string' ||
            !['pad', 'behaviorTree'].includes(item.kind) ||
            typeof item.documentId !== 'string' ||
            !['pending', 'committed', 'restored', 'conflicted'].includes(item.state) ||
            !Number.isFinite(item.createdAt) ||
            !('before' in item)
        )
      )
        throw new Error('Checkpoint storage is invalid. Export it before editing.');
      this.checkpoints = stored.slice(-20);
    } catch (cause) {
      this.checkpoints = [];
      this.storageError = new Error(`Cannot safely read checkpoints: ${String(cause)}`);
    }
  }
  private persist(): void {
    if (this.storageError) throw this.storageError;
    if (this.checkpoints.length > 20) this.checkpoints.splice(0, this.checkpoints.length - 20);
    const value = JSON.stringify(this.checkpoints.slice(-20));
    if (value.length > 2 * 1024 * 1024)
      throw new Error('Document checkpoint allowance is full. Export or clear old checkpoints before editing.');
    localStorage.setItem(this.key, value);
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
    this.queue = run.then(
      () => {},
      () => {}
    );
    return run;
  }
  private async locked<T>(kind: DocumentKind, id: string, operation: () => Promise<T>): Promise<T> {
    if (this.storageError) throw this.storageError;
    const freshOperation = async () => {
      // Another window may have advanced this journal while our document lock was queued.
      const latest = new DocumentChanges(this.owner, this.key);
      if (latest.storageError) throw latest.storageError;
      this.checkpoints.splice(0, this.checkpoints.length, ...latest.checkpoints);
      return operation();
    };
    // Both the document revision and shared journal have cross-window ownership.
    return navigator.locks
      ? await navigator.locks.request(`robo-boy-authoring:${kind}:${id}`, () =>
          navigator.locks.request(`robo-boy-authoring-journal:${this.key}`, freshOperation)
        )
      : freshOperation();
  }
  async reconcile(): Promise<void> {
    if (this.storageError) throw this.storageError;
    const content = (document: unknown) => {
      if (!document || typeof document !== 'object') return JSON.stringify(document);
      const value = { ...(document as Record<string, unknown>) };
      delete value.updatedAt;
      if (value.metadata && typeof value.metadata === 'object') {
        value.metadata = { ...(value.metadata as Record<string, unknown>) };
        delete (value.metadata as Record<string, unknown>).modified;
      }
      return JSON.stringify(value);
    };
    for (const pending of this.checkpoints.filter(item => item.state === 'pending')) {
      await this.locked(pending.kind, pending.documentId, async () => {
        const checkpoint = this.checkpoints.find(item => item.id === pending.id);
        if (!checkpoint || checkpoint.state !== 'pending') return;
        const current = this.owner.read(checkpoint.kind, checkpoint.documentId) ?? null;
        if (checkpoint.intended !== undefined && content(current) === content(checkpoint.intended)) {
          checkpoint.afterRevision = await documentRevision(current);
          checkpoint.state = 'committed';
        } else checkpoint.state = 'conflicted';
        this.persist();
      });
    }
  }
  async save(
    kind: DocumentKind,
    document: unknown,
    baseRevision?: string,
    checkCurrent: () => void = () => {}
  ): Promise<DocumentCheckpoint> {
    return this.serial(async () => {
      const id = (document as { id?: unknown })?.id;
      if (typeof id !== 'string' || !id || id.length > 512) throw new Error('A document needs a stable id.');
      return this.locked(kind, id, async () => {
        const before = this.owner.read(kind, id);
        if (before ? !baseRevision || (await documentRevision(before)) !== baseRevision : baseRevision !== undefined)
          throw new Error('The document changed. Read its latest revision and rebase.');
        const checkpoint: DocumentCheckpoint = {
          id: crypto.randomUUID(),
          kind,
          documentId: id,
          before: before ?? null,
          intended: document,
          state: 'pending',
          createdAt: Date.now(),
        };
        checkCurrent();
        this.checkpoints.push(checkpoint);
        this.persist();
        // No await between this last read and the synchronous owner commit.
        if (JSON.stringify(this.owner.read(kind, id) ?? null) !== JSON.stringify(before ?? null))
          throw new Error('Concurrent document edit detected. Nothing was saved.');
        checkCurrent();
        if (!this.owner.save(kind, document)) throw new Error('The owning document store could not save.');
        const saved = this.owner.read(kind, id);
        checkpoint.afterRevision = await documentRevision(saved);
        checkpoint.state = 'committed';
        this.persist();
        return checkpoint;
      });
    });
  }
  async restore(checkpointId: string, checkCurrent: () => void = () => {}): Promise<DocumentCheckpoint> {
    return this.serial(async () => {
      const target = this.checkpoints.find(item => item.id === checkpointId);
      if (!target) throw new Error('This checkpoint is not available for restore.');
      return this.locked(target.kind, target.documentId, async () => {
        const checkpoint = this.checkpoints.find(item => item.id === checkpointId);
        if (!checkpoint || checkpoint.state !== 'committed' || !checkpoint.afterRevision)
          throw new Error('This checkpoint is not available for restore.');
        const current = this.owner.read(checkpoint.kind, checkpoint.documentId);
        if ((await documentRevision(current)) !== checkpoint.afterRevision)
          throw new Error('The document changed after this checkpoint. Nothing was overwritten.');
        if (JSON.stringify(this.owner.read(checkpoint.kind, checkpoint.documentId)) !== JSON.stringify(current))
          throw new Error('Concurrent edit detected.');
        checkCurrent();
        const saved =
          checkpoint.before === null
            ? this.owner.remove(checkpoint.kind, checkpoint.documentId)
            : this.owner.save(checkpoint.kind, checkpoint.before);
        if (!saved) throw new Error('The document owner could not restore this checkpoint.');
        checkpoint.state = 'restored';
        this.persist();
        return checkpoint;
      });
    });
  }
}

/** Bounded readable before/after diff, deliberately excluding storage timestamps. */
export function documentDiff(before: unknown, after: unknown): string {
  const lines: string[] = [];
  const format = (value: unknown) => (JSON.stringify(value) ?? '(absent)').slice(0, 600);
  const visit = (left: unknown, right: unknown, path: string) => {
    if (lines.length >= 80 || JSON.stringify(left) === JSON.stringify(right)) return;
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      const a = left as Record<string, unknown>,
        b = right as Record<string, unknown>;
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        if (!((path === '' && key === 'updatedAt') || (path === 'metadata' && key === 'modified')))
          visit(a[key], b[key], path ? `${path}.${key}` : key);
    } else lines.push(`${path || 'document'}\n- ${format(left)}\n+ ${format(right)}`);
  };
  visit(before, after, '');
  return (
    lines.join('\n\n') + (lines.length >= 80 ? '\n… Diff truncated; read the complete document for all changes.' : '')
  );
}
