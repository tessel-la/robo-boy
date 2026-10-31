import { assertSafeFieldPath, collection, parseContentJson, record, text } from '../library/json';
import { readContentPackage } from '../library/packages';
import { createUuid } from '../../utils/uuid';
import type { CustomGamepadLayout } from './types';

const componentTypes = new Set([
  'joystick',
  'physical-gamepad',
  'button',
  'dpad',
  'toggle',
  'slider',
  'camera',
  'plot',
  'heartbeat',
  'gauge',
  'level',
  'readout',
  'state',
  'setpoint',
  'text',
]);
const numberConfig = new Set([
  'maxValue',
  'physicalGamepadIndex',
  'physicalGamepadDeadzone',
  'physicalGamepadPublishHz',
  'buttonIndex',
  'pressedValue',
  'releasedValue',
  'min',
  'max',
  'step',
  'sliderMin',
  'sliderMax',
  'streamWidth',
  'streamHeight',
  'timeWindowSec',
  'sampleLimit',
  'minY',
  'maxY',
  'heartbeatTimeoutMs',
  'decimals',
  'scale',
  'offset',
  'warnAt',
  'alarmAt',
  'staleAfterMs',
  'historyLength',
]);
const boolConfig = new Set([
  'poseStampedUseOdometryOrientation',
  'momentary',
  'autoScale',
  'alertBelow',
  'sendOnChange',
]);
const stringConfig = new Set([
  'poseStampedFrameId',
  'poseStampedReferenceMode',
  'poseStampedReferenceFrameId',
  'poseStampedOdometryTopic',
  'poseStampedOdometryMessageType',
  'twistStampedFrameId',
  'physicalGamepadProfile',
  'messagePath',
  'orientation',
  'cameraTransport',
  'streamType',
  'fieldPath',
  'heartbeatMode',
  'heartbeatFieldPath',
  'fieldType',
  'unit',
]);
function operation(value: unknown) {
  const op = record(value, 'ROS operation');
  if (!['topic', 'service', 'action'].includes(op.kind)) throw new Error('Unknown ROS operation kind.');
  text(op.name, 'ROS name');
  text(op.messageType, 'ROS message type');
  if (op.payload !== undefined) record(op.payload, 'ROS payload');
  if (
    op.timeoutMs !== undefined &&
    (typeof op.timeoutMs !== 'number' || !Number.isFinite(op.timeoutMs) || op.timeoutMs <= 0)
  )
    throw new Error('Invalid operation timeout.');
}
export function decodePad(value: unknown): CustomGamepadLayout {
  const pad = record(value, 'Pad');
  text(pad.id, 'Pad id');
  text(pad.name, 'Pad name');
  const components = collection(pad.components, 'Pad components', 500);
  const ids = new Set<string>();
  for (const value of components) {
    const component = record(value, 'Pad component');
    text(component.id, 'Component id');
    if (ids.has(component.id)) throw new Error('Component ids must be unique.');
    ids.add(component.id);
    if (!componentTypes.has(component.type)) throw new Error(`Unsupported Pad component: ${component.type}.`);
    const position = record(component.position, 'Component position');
    for (const key of ['x', 'y', 'width', 'height']) {
      if (
        !Number.isInteger(position[key]) ||
        position[key] < (key === 'x' || key === 'y' ? 0 : 1) ||
        position[key] > 1000
      )
        throw new Error('Invalid component position or size.');
    }
    if (component.label !== undefined && typeof component.label !== 'string')
      throw new Error('Invalid component label.');
    if (component.action !== undefined) {
      const action = record(component.action, 'Component action');
      if (action.type === 'custom') throw new Error('Custom handlers are not supported in imported Pads.');
      if (action.type !== undefined && !['action', 'service'].includes(action.type))
        throw new Error('Unsupported component action.');
      text(action.type ? action.name : action.topic, 'Component ROS name');
      text(action.messageType, 'Component message type');
      if (action.field !== undefined) assertSafeFieldPath(action.field, 'ROS field');
    }
    if (component.eventOperations !== undefined)
      for (const [key, op] of Object.entries(record(component.eventOperations, 'Event operations'))) {
        if (!['press', 'release', 'on', 'off'].includes(key)) throw new Error('Unknown Pad event.');
        operation(op);
      }
    if (component.style !== undefined) {
      const style = record(component.style, 'Component style');
      if (Object.values(style).some(value => typeof value !== 'string')) throw new Error('Invalid component style.');
    }
    if (component.config !== undefined)
      for (const [key, config] of Object.entries(record(component.config, 'Component configuration'))) {
        if (['axes', 'fieldPaths'].includes(key) && Array.isArray(config))
          config.forEach(path => assertSafeFieldPath(path, key));
        if (numberConfig.has(key)) {
          if (typeof config !== 'number' || !Number.isFinite(config)) throw new Error(`Invalid number: ${key}.`);
        } else if (boolConfig.has(key)) {
          if (typeof config !== 'boolean') throw new Error(`Invalid flag: ${key}.`);
        } else if (stringConfig.has(key)) {
          if (typeof config !== 'string') throw new Error(`Invalid text: ${key}.`);
          if (['messagePath', 'fieldPath', 'heartbeatFieldPath'].includes(key)) assertSafeFieldPath(config, key);
        } else if (['axes', 'fieldPaths', 'axisScales'].includes(key)) {
          if (
            !Array.isArray(config) ||
            config.some(item => typeof item !== (key === 'axisScales' ? 'number' : 'string'))
          )
            throw new Error(`Invalid array: ${key}.`);
        } else if (key === 'physicalGamepadBindings') {
          for (const binding of Object.values(record(config, 'Gamepad bindings')))
            for (const [event, op] of Object.entries(record(binding, 'Gamepad binding'))) {
              if (!['press', 'release'].includes(event)) throw new Error('Invalid gamepad binding event.');
              operation(op);
            }
        } else if (key === 'buttonMapping') {
          if (Object.values(record(config, 'Button mapping')).some(value => !Number.isInteger(value)))
            throw new Error('Invalid button mapping.');
        } else if (key === 'stateMappings') {
          for (const mapping of collection(config, 'State mappings', 500)) {
            const state = record(mapping, 'State mapping');
            if (
              typeof state.label !== 'string' ||
              !['string', 'number', 'boolean'].includes(typeof state.value) ||
              !['ok', 'info', 'warning', 'error', 'neutral'].includes(state.tone)
            )
              throw new Error('Invalid state mapping.');
          }
        } else throw new Error(`Unsupported Pad configuration: ${key}.`);
      }
  }
  // Older exported Pads omitted editor defaults; normalize those explicitly.
  const grid = pad.gridSize === undefined ? { width: 20, height: 12 } : record(pad.gridSize, 'Pad grid');
  if (![grid.width, grid.height].every(value => Number.isInteger(value) && value > 0 && value <= 1000))
    throw new Error('Invalid Pad grid.');
  const cellSize = pad.cellSize ?? 40;
  if (typeof cellSize !== 'number' || cellSize <= 0 || cellSize > 1000) throw new Error('Invalid Pad cell size.');
  const ros =
    pad.rosConfig === undefined
      ? { defaultTopic: '/joy', defaultMessageType: 'sensor_msgs/Joy' }
      : record(pad.rosConfig, 'Pad ROS defaults');
  text(ros.defaultTopic, 'Default ROS topic');
  text(ros.defaultMessageType, 'Default ROS message type');
  // Missing source dates stay stable across catalog refreshes; copying assigns local dates.
  const now = new Date(0).toISOString();
  const portableComponents = components.map(value => {
    const item = record(value, 'Component');
    const action = item.action
      ? Object.fromEntries(
          ['topic', 'messageType', 'field', 'name', 'type']
            .filter(key => item.action[key] !== undefined)
            .map(key => [key, item.action[key]])
        )
      : undefined;
    return {
      id: item.id,
      type: item.type,
      position: { x: item.position.x, y: item.position.y, width: item.position.width, height: item.position.height },
      label: item.label,
      action,
      eventOperations: item.eventOperations,
      config: item.config,
      style: item.style ? { color: item.style.color, size: item.style.size, variant: item.style.variant } : undefined,
    };
  });
  return JSON.parse(
    JSON.stringify({
      id: pad.id,
      name: pad.name,
      description: typeof pad.description === 'string' ? pad.description : undefined,
      components: portableComponents,
      gridSize: { width: grid.width, height: grid.height },
      cellSize,
      rosConfig: { defaultTopic: ros.defaultTopic, defaultMessageType: ros.defaultMessageType },
      metadata: {
        created: typeof pad.metadata?.created === 'string' ? pad.metadata.created : now,
        modified: typeof pad.metadata?.modified === 'string' ? pad.metadata.modified : now,
        version: '1.0.0',
      },
    })
  ) as CustomGamepadLayout;
}
export function readPads(source: string): CustomGamepadLayout[] {
  const value = parseContentJson(source);
  const pack = readContentPackage(value);
  let pads: unknown[];
  if (pack) {
    if (pack.documents.some(doc => doc.kind !== 'pad'))
      throw new Error('Use the workspace importer for workspace packages. This importer accepts Pads only.');
    pads = pack.documents.map(doc => doc.data);
  } else {
    const data = record(value, 'Pad file');
    if (data.version !== undefined && data.version !== '1.0.0') throw new Error('Unsupported Pad file version.');
    if (!Array.isArray(data.layouts)) throw new Error('Invalid import format: missing layouts array');
    pads = collection(data.layouts, 'Pads', 100);
  }
  if (!pads.length) throw new Error('No Pads to import.');
  const decoded = pads.map(decodePad);
  if (new Set(decoded.map(pad => pad.id)).size !== decoded.length) throw new Error('Pad ids must be unique.');
  return decoded;
}
export function copyPads(pads: CustomGamepadLayout[]): { pads: CustomGamepadLayout[]; idMap: Record<string, string> } {
  const idMap = Object.fromEntries(pads.map(pad => [pad.id, `custom-${createUuid()}`]));
  const now = new Date().toISOString();
  const snapshots = JSON.parse(JSON.stringify(pads)) as CustomGamepadLayout[];
  return {
    idMap,
    pads: snapshots.map(pad => ({
      ...pad,
      id: idMap[pad.id],
      metadata: { ...pad.metadata, created: now, modified: now },
    })),
  };
}

/** Keep the established file wrapper while sharing the same owner validation on export. */
export function serializePads(pads: CustomGamepadLayout[]): string {
  return JSON.stringify(
    { version: '1.0.0', exportDate: new Date().toISOString(), layouts: pads.map(decodePad) },
    null,
    2
  );
}
