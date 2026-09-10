import { v4 as uuidv4 } from 'uuid';
import type {
  ComponentAction,
  CustomGamepadLayout,
  GamepadComponentConfig,
} from '../../customGamepad/types';
import type { RosOperation } from '../../../utils/rosOperations';
import type { AssistantCapability } from '../capabilities';

/**
 * Parse/repair for model-generated Pad layouts — the Pad equivalent of behaviorTree's
 * `treeGeneration.ts`. Models reliably get the *shape* of a CustomGamepadLayout slightly wrong
 * (`topicName` instead of `topic`, a bare string action, a missing `metadata` block), which used
 * to produce a Pad that saved but had no usable ROS binding. Everything here is repair-first:
 * fix what can be fixed, drop what cannot, and throw only when the result would be unusable.
 */

export const PAD_CAPABILITY: AssistantCapability = {
  id: 'pad-generation',
  summary: 'You can build a Pad — a touch control layout — or repair an existing one.',
  detail: ['It opens in the user\'s own Pad editor for review; nothing is saved to their library until they save it there.'],
  responseKind: 'padProposal',
};

const COMPONENT_TYPES = new Set<GamepadComponentConfig['type']>([
  'joystick',
  'physical-gamepad',
  'button',
  'dpad',
  'toggle',
  'slider',
  'camera',
  'plot',
  'heartbeat',
]);

const DEFAULT_GRID = { width: 8, height: 4 };
const DEFAULT_CELL_SIZE = 80;

const asRecord = (value: unknown, label: string): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, any>;
};

const finiteNumber = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asPlainObject = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** Accepts the documented `{topic, messageType, field?}` / `{name, type, messageType}` shapes plus
 * the aliases models commonly emit (`topicName`, `topic_name`, `serviceName`, `actionName`). */
const normalizeAction = (raw: unknown): ComponentAction | undefined => {
  const record = asPlainObject(raw);
  if (!record) return undefined;

  const messageType = typeof record.messageType === 'string' ? record.messageType : typeof record.type === 'string' && record.type.includes('/') ? record.type : '';

  const topic =
    typeof record.topic === 'string'
      ? record.topic
      : typeof record.topicName === 'string'
        ? record.topicName
        : typeof record.topic_name === 'string'
          ? record.topic_name
          : undefined;
  if (topic) {
    const field = typeof record.field === 'string' ? record.field : undefined;
    return { topic, messageType, ...(field ? { field } : {}) };
  }

  const kind = record.type === 'service' || record.type === 'action' ? record.type : undefined;
  const name =
    typeof record.name === 'string'
      ? record.name
      : typeof record.serviceName === 'string'
        ? record.serviceName
        : typeof record.actionName === 'string'
          ? record.actionName
          : undefined;
  if (name && kind) return { name, type: kind, messageType };
  if (name && typeof record.serviceName === 'string') return { name, type: 'service', messageType };
  if (name && typeof record.actionName === 'string') return { name, type: 'action', messageType };

  return undefined;
};

const normalizeOperation = (raw: unknown): RosOperation | undefined => {
  const record = asPlainObject(raw);
  if (!record) return undefined;

  const messageType = typeof record.messageType === 'string' ? record.messageType : '';
  const payload = asPlainObject(record.payload);
  const timeoutMs = Number.isFinite(record.timeoutMs) ? (record.timeoutMs as number) : undefined;

  const kind =
    record.kind === 'topic' || record.kind === 'service' || record.kind === 'action'
      ? record.kind
      : typeof record.topic === 'string' || typeof record.topicName === 'string'
        ? 'topic'
        : typeof record.serviceName === 'string'
          ? 'service'
          : typeof record.actionName === 'string'
            ? 'action'
            : undefined;
  if (!kind) return undefined;

  const name =
    typeof record.name === 'string'
      ? record.name
      : typeof record.topic === 'string'
        ? record.topic
        : typeof record.topicName === 'string'
          ? record.topicName
          : typeof record.serviceName === 'string'
            ? record.serviceName
            : typeof record.actionName === 'string'
              ? record.actionName
              : undefined;
  if (!name || !messageType) return undefined;

  return {
    kind,
    name,
    messageType,
    ...(payload ? { payload } : {}),
    ...(kind !== 'topic' && timeoutMs !== undefined ? { timeoutMs } : {}),
  } as RosOperation;
};

const normalizeEventOperations = (raw: unknown): GamepadComponentConfig['eventOperations'] => {
  const record = asPlainObject(raw);
  if (!record) return undefined;
  const result: NonNullable<GamepadComponentConfig['eventOperations']> = {};
  (['press', 'release', 'on', 'off'] as const).forEach(key => {
    const operation = normalizeOperation(record[key]);
    if (operation) result[key] = operation;
  });
  return Object.keys(result).length > 0 ? result : undefined;
};

const normalizePosition = (raw: unknown, grid: { width: number; height: number }) => {
  const record = asPlainObject(raw) ?? {};
  const width = Math.max(1, Math.min(grid.width, Math.round(finiteNumber(record.width, 2))));
  const height = Math.max(1, Math.min(grid.height, Math.round(finiteNumber(record.height, 2))));
  const x = Math.max(0, Math.min(grid.width - width, Math.round(finiteNumber(record.x, 0))));
  const y = Math.max(0, Math.min(grid.height - height, Math.round(finiteNumber(record.y, 0))));
  return { x, y, width, height };
};

const normalizeComponent = (
  raw: unknown,
  index: number,
  grid: { width: number; height: number },
  usedIds: Set<string>
): GamepadComponentConfig | null => {
  const record = asPlainObject(raw);
  if (!record) return null;

  const type = String(record.type ?? '') as GamepadComponentConfig['type'];
  if (!COMPONENT_TYPES.has(type)) return null;

  let id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `${type}-${index}`;
  while (usedIds.has(id)) id = `${id}-${index}`;
  usedIds.add(id);

  const action = normalizeAction(record.action);
  const eventOperations = normalizeEventOperations(record.eventOperations);
  const config = asPlainObject(record.config);
  const style = asPlainObject(record.style);

  // Physical-gamepad bindings carry their own nested press/release operations.
  if (config && asPlainObject(config.physicalGamepadBindings)) {
    const bindings = asPlainObject(config.physicalGamepadBindings)!;
    const normalizedBindings: Record<string, { press?: RosOperation; release?: RosOperation }> = {};
    Object.entries(bindings).forEach(([controlId, binding]) => {
      const bindingRecord = asPlainObject(binding);
      if (!bindingRecord) return;
      const press = normalizeOperation(bindingRecord.press);
      const release = normalizeOperation(bindingRecord.release);
      if (press || release) normalizedBindings[controlId] = { ...(press ? { press } : {}), ...(release ? { release } : {}) };
    });
    config.physicalGamepadBindings = normalizedBindings;
  }

  return {
    id,
    type,
    position: normalizePosition(record.position, grid),
    ...(typeof record.label === 'string' ? { label: record.label } : {}),
    ...(action ? { action } : {}),
    ...(eventOperations ? { eventOperations } : {}),
    ...(style ? { style } : {}),
    ...(config ? { config } : {}),
  } as GamepadComponentConfig;
};

const positionsOverlap = (
  left: GamepadComponentConfig['position'],
  right: GamepadComponentConfig['position']
) =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

/** Keeps already-valid positions, then relocates only later colliding components to the first
 * free grid slot. The grid may grow vertically (up to the persisted format's 24-cell cap) rather
 * than returning an unusable Pad with controls on top of each other. */
const resolveOverlaps = (
  components: GamepadComponentConfig[],
  grid: { width: number; height: number }
): GamepadComponentConfig[] => {
  const placed: GamepadComponentConfig[] = [];
  for (const component of components) {
    let position = component.position;
    const collides = (candidate: typeof position) => placed.some(item => positionsOverlap(candidate, item.position));
    if (collides(position)) {
      let replacement: typeof position | null = null;
      for (let height = grid.height; height <= 24 && !replacement; height += 1) {
        for (let y = 0; y <= height - position.height && !replacement; y += 1) {
          for (let x = 0; x <= grid.width - position.width; x += 1) {
            const candidate = { ...position, x, y };
            if (!collides(candidate)) replacement = candidate;
          }
        }
        if (replacement) grid.height = Math.max(grid.height, replacement.y + replacement.height);
      }
      if (!replacement) throw new Error(`Generated Pad has no free grid space for component "${component.label || component.id}".`);
      position = replacement;
    }
    placed.push(position === component.position ? component : { ...component, position });
  }
  return placed;
};

export const normalizePadLayout = (value: unknown): CustomGamepadLayout => {
  const raw = asRecord(value, 'Generated Pad');
  if (!Array.isArray(raw.components)) throw new Error('Generated Pad must contain a components array.');

  const gridRecord = asPlainObject(raw.gridSize) ?? {};
  const grid = {
    width: Math.max(1, Math.min(24, Math.round(finiteNumber(gridRecord.width, DEFAULT_GRID.width)))),
    height: Math.max(1, Math.min(24, Math.round(finiteNumber(gridRecord.height, DEFAULT_GRID.height)))),
  };

  const usedIds = new Set<string>();
  const components = resolveOverlaps(raw.components
    .map((component: unknown, index: number) => normalizeComponent(component, index, grid, usedIds))
    .filter((component): component is GamepadComponentConfig => component !== null), grid);

  if (components.length === 0) {
    throw new Error('Generated Pad has no usable components. Every component needs a supported "type".');
  }

  const rosConfigRecord = asPlainObject(raw.rosConfig) ?? {};
  const firstTopicAction = components
    .map(component => component.action)
    .find((action): action is { topic: string; messageType: string } => Boolean(action && 'topic' in action));

  const now = new Date().toISOString();
  const metadata = asPlainObject(raw.metadata);
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `assistant-pad-${uuidv4().slice(0, 8)}`,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'AI generated pad',
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    gridSize: grid,
    cellSize: Math.max(30, Math.min(200, Math.round(finiteNumber(raw.cellSize, DEFAULT_CELL_SIZE)))),
    components,
    rosConfig: {
      defaultTopic:
        typeof rosConfigRecord.defaultTopic === 'string' ? rosConfigRecord.defaultTopic : (firstTopicAction?.topic ?? ''),
      defaultMessageType:
        typeof rosConfigRecord.defaultMessageType === 'string'
          ? rosConfigRecord.defaultMessageType
          : (firstTopicAction?.messageType ?? ''),
    },
    metadata: {
      created: typeof metadata?.created === 'string' ? metadata.created : now,
      modified: now,
      version: typeof metadata?.version === 'string' ? metadata.version : '1.0.0',
    },
  };
};
