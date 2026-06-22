export type TfSource = 'dynamic' | 'static';

export interface TfTransformRecord {
  parentFrame: string;
  childFrame: string;
  source: TfSource;
  messageTimestampMs: number | null;
  receivedAtMs: number;
  orderTimestampMs: number;
}

export interface TfTreeState {
  transformsByChild: Map<string, TfTransformRecord>;
  observedParentsByChild: Map<string, Set<string>>;
  knownFrames: Set<string>;
}

export interface TfMultipleParentWarning {
  childFrame: string;
  parentFrames: string[];
}

export interface TfGraphDiagnostics {
  components: string[][];
  cycles: string[][];
  multipleParents: TfMultipleParentWarning[];
}

type TfMessage = {
  transforms?: unknown;
};

type TransformStamped = {
  header?: {
    frame_id?: unknown;
    stamp?: unknown;
  };
  child_frame_id?: unknown;
};

export const createEmptyTfTreeState = (): TfTreeState => ({
  transformsByChild: new Map(),
  observedParentsByChild: new Map(),
  knownFrames: new Set(),
});

export const normalizeFrameId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^\/+/, '');
  return normalized || null;
};

const finiteNumber = (value: unknown): number | null => {
  const numberValue = typeof value === 'string' ? Number(value) : value;
  return typeof numberValue === 'number' && Number.isFinite(numberValue) ? numberValue : null;
};

export const stampToMilliseconds = (stamp: unknown): number | null => {
  if (!stamp || typeof stamp !== 'object') return null;
  const value = stamp as Record<string, unknown>;
  const seconds = finiteNumber(value.sec ?? value.secs);
  const nanoseconds = finiteNumber(value.nanosec ?? value.nsecs) ?? 0;
  if (seconds === null || seconds < 0 || nanoseconds < 0) return null;
  const timestamp = seconds * 1000 + nanoseconds / 1_000_000;
  return timestamp > 0 && Number.isFinite(timestamp) ? timestamp : null;
};

const addObservedParent = (parentsByChild: Map<string, Set<string>>, childFrame: string, parentFrame: string) => {
  const current = parentsByChild.get(childFrame);
  if (current?.has(parentFrame)) return parentsByChild;

  const next = new Map(parentsByChild);
  next.set(childFrame, new Set(current ?? []).add(parentFrame));
  return next;
};

export const consumeTfMessage = (
  state: TfTreeState,
  message: TfMessage | null | undefined,
  source: TfSource,
  receivedAtMs: number
): TfTreeState => {
  if (!Array.isArray(message?.transforms)) return state;

  let transformsByChild = state.transformsByChild;
  let observedParentsByChild = state.observedParentsByChild;
  let knownFrames = state.knownFrames;

  for (const candidate of message.transforms) {
    if (!candidate || typeof candidate !== 'object') continue;
    const transform = candidate as TransformStamped;
    const parentFrame = normalizeFrameId(transform.header?.frame_id);
    const childFrame = normalizeFrameId(transform.child_frame_id);
    if (!parentFrame || !childFrame) continue;

    if (!knownFrames.has(parentFrame) || !knownFrames.has(childFrame)) {
      knownFrames = new Set(knownFrames);
      knownFrames.add(parentFrame);
      knownFrames.add(childFrame);
    }
    observedParentsByChild = addObservedParent(observedParentsByChild, childFrame, parentFrame);

    const messageTimestampMs = stampToMilliseconds(transform.header?.stamp);
    const orderTimestampMs = messageTimestampMs ?? receivedAtMs;
    const current = transformsByChild.get(childFrame);

    if (current) {
      const isOlder =
        messageTimestampMs !== null && current.messageTimestampMs !== null
          ? messageTimestampMs < current.messageTimestampMs
          : receivedAtMs < current.receivedAtMs;
      if (isOlder) continue;
    }

    const nextRecord: TfTransformRecord = {
      parentFrame,
      childFrame,
      source,
      messageTimestampMs,
      receivedAtMs,
      orderTimestampMs,
    };

    if (transformsByChild === state.transformsByChild) {
      transformsByChild = new Map(transformsByChild);
    }
    transformsByChild.set(childFrame, nextRecord);
  }

  if (
    transformsByChild === state.transformsByChild &&
    observedParentsByChild === state.observedParentsByChild &&
    knownFrames === state.knownFrames
  ) {
    return state;
  }

  return { transformsByChild, observedParentsByChild, knownFrames };
};

const buildUndirectedAdjacency = (state: TfTreeState) => {
  const adjacency = new Map<string, Set<string>>();
  state.knownFrames.forEach(frame => adjacency.set(frame, new Set()));
  state.transformsByChild.forEach(transform => {
    adjacency.get(transform.parentFrame)?.add(transform.childFrame);
    adjacency.get(transform.childFrame)?.add(transform.parentFrame);
  });
  return adjacency;
};

export const computeConnectedComponents = (state: TfTreeState): string[][] => {
  const adjacency = buildUndirectedAdjacency(state);
  const visited = new Set<string>();
  const components: string[][] = [];

  [...state.knownFrames].sort().forEach(start => {
    if (visited.has(start)) return;
    const component: string[] = [];
    const queue = [start];
    visited.add(start);

    while (queue.length > 0) {
      const frame = queue.shift()!;
      component.push(frame);
      [...(adjacency.get(frame) ?? [])].sort().forEach(neighbor => {
        if (visited.has(neighbor)) return;
        visited.add(neighbor);
        queue.push(neighbor);
      });
    }

    components.push(component.sort());
  });

  return components.sort((a, b) => a[0].localeCompare(b[0]));
};

export const detectTfCycles = (state: TfTreeState): string[][] => {
  const parentByChild = new Map(
    [...state.transformsByChild.values()].map(transform => [transform.childFrame, transform.parentFrame])
  );
  const cyclesByKey = new Map<string, string[]>();

  state.knownFrames.forEach(start => {
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let current: string | undefined = start;

    while (current && !pathIndex.has(current)) {
      pathIndex.set(current, path.length);
      path.push(current);
      current = parentByChild.get(current);
    }

    if (!current) return;
    const cycleStart = pathIndex.get(current);
    if (cycleStart === undefined) return;
    const cycle = path.slice(cycleStart);
    const canonicalStart = cycle.reduce(
      (best, frame, index) => (frame.localeCompare(cycle[best]) < 0 ? index : best),
      0
    );
    const canonical = [...cycle.slice(canonicalStart), ...cycle.slice(0, canonicalStart)];
    cyclesByKey.set([...canonical].sort().join('\u0000'), canonical);
  });

  return [...cyclesByKey.values()].sort((a, b) => a[0].localeCompare(b[0]));
};

export const getTfGraphDiagnostics = (state: TfTreeState): TfGraphDiagnostics => ({
  components: computeConnectedComponents(state),
  cycles: detectTfCycles(state),
  multipleParents: [...state.observedParentsByChild.entries()]
    .filter(([, parents]) => parents.size > 1)
    .map(([childFrame, parents]) => ({
      childFrame,
      parentFrames: [...parents].sort(),
    }))
    .sort((a, b) => a.childFrame.localeCompare(b.childFrame)),
});

export const getTransformAgeMs = (transform: TfTransformRecord, nowMs: number): number =>
  Math.max(0, nowMs - transform.receivedAtMs);

export const isTransformStale = (transform: TfTransformRecord, nowMs: number, staleAfterMs: number): boolean =>
  transform.source === 'dynamic' && getTransformAgeMs(transform, nowMs) >= staleAfterMs;
