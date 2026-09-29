import type {
  CustomGamepadLayout,
  GamepadComponentConfig,
  GamepadLibraryItem,
  GridPosition,
  PadComponentType,
  ROSTopicConfig,
} from './types';
import { DEFAULT_PHYSICAL_GAMEPAD_PUBLISH_HZ } from './physicalGamepad';

// Generic ROS Joy starting point.
export const defaultDualJoystickHeartbeatLayout: CustomGamepadLayout = {
  id: 'default-dual-joystick-heartbeat',
  name: 'Dual Joystick + Heartbeat',
  description: 'Generic four-axis Joy controller with a heartbeat monitor',
  gridSize: { width: 8, height: 4 },
  cellSize: 80,
  components: [
    {
      id: 'left-joystick',
      type: 'joystick',
      position: { x: 0, y: 1, width: 3, height: 3 },
      label: 'Left Stick',
      action: {
        topic: '/joy',
        messageType: 'sensor_msgs/msg/Joy',
        field: 'axes'
      },
      config: {
        min: -1,
        max: 1,
        axes: ['0', '1']
      }
    },
    {
      id: 'right-joystick',
      type: 'joystick',
      position: { x: 5, y: 1, width: 3, height: 3 },
      label: 'Right Stick',
      action: {
        topic: '/joy',
        messageType: 'sensor_msgs/msg/Joy',
        field: 'axes'
      },
      config: {
        min: -1,
        max: 1,
        axes: ['2', '3']
      }
    },
    {
      id: 'heartbeat',
      type: 'heartbeat',
      position: { x: 3, y: 0, width: 2, height: 1 },
      label: 'Heartbeat',
      action: {
        topic: '/heartbeat',
        messageType: 'std_msgs/msg/Bool'
      },
      config: {
        heartbeatMode: 'pulse',
        heartbeatTimeoutMs: 1500
      }
    }
  ],
  rosConfig: {
    defaultTopic: '/joy',
    defaultMessageType: 'sensor_msgs/msg/Joy'
  },
  metadata: {
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    version: '1.0.0'
  }
};

// Default library items
export const defaultGamepadLibrary: GamepadLibraryItem[] = [
  {
    id: 'dual-joystick-heartbeat',
    name: 'Dual Joystick + Heartbeat',
    description: 'Generic four-axis Joy controller with a heartbeat monitor',
    layout: defaultDualJoystickHeartbeatLayout,
    isDefault: true
  }
];

/** A component the editor offers: what it is called, how big it starts, and what a new one is set to. */
export interface ComponentLibraryItem {
  type: PadComponentType;
  name: string;
  description: string;
  defaultSize: { width: number; height: number };
  icon: string;
  /** The topic a new component publishes to or shows. */
  defaultAction: ROSTopicConfig;
  defaultConfig?: GamepadComponentConfig['config'];
}

// Component library for the editor
export const componentLibrary: ComponentLibraryItem[] = [
  {
    type: 'joystick',
    name: 'Joystick',
    description: 'Analog stick for continuous control',
    defaultSize: { width: 2, height: 2 },
    icon: '🕹️',
    defaultAction: { topic: '/joystick', messageType: 'sensor_msgs/Joy', field: 'axes' },
    defaultConfig: { min: -1, max: 1, sliderMin: -1, sliderMax: 1, axes: ['0', '1'] },
  },
  {
    type: 'physical-gamepad',
    name: 'Physical Gamepad',
    description: 'Connected Xbox, PlayStation, or Logitech controller',
    defaultSize: { width: 6, height: 4 },
    icon: '🎮',
    defaultAction: { topic: '/joy', messageType: 'sensor_msgs/msg/Joy', field: 'axes' },
    defaultConfig: {
      physicalGamepadProfile: 'auto',
      physicalGamepadDeadzone: 0.08,
      physicalGamepadPublishHz: DEFAULT_PHYSICAL_GAMEPAD_PUBLISH_HZ,
    },
  },
  {
    type: 'button',
    name: 'Button',
    description: 'Momentary or toggle button',
    defaultSize: { width: 1, height: 1 },
    icon: '🔘',
    defaultAction: { topic: '/button', messageType: 'std_msgs/Bool', field: 'data' },
  },
  {
    type: 'dpad',
    name: 'D-Pad',
    description: 'Directional pad with 4 directions',
    defaultSize: { width: 2, height: 2 },
    icon: '✚',
    defaultAction: { topic: '/dpad', messageType: 'sensor_msgs/Joy', field: 'buttons' },
    defaultConfig: { buttonMapping: { up: 0, right: 1, down: 2, left: 3 } },
  },
  {
    type: 'toggle',
    name: 'Toggle',
    description: 'On/off switch',
    defaultSize: { width: 2, height: 1 },
    icon: '🔄',
    defaultAction: { topic: '/toggle', messageType: 'std_msgs/Bool', field: 'data' },
  },
  {
    type: 'slider',
    name: 'Slider',
    description: 'Linear control slider',
    defaultSize: { width: 3, height: 1 },
    icon: '🎚️',
    defaultAction: { topic: '/slider', messageType: 'std_msgs/Float32', field: 'data' },
  },
  {
    type: 'setpoint',
    name: 'Setpoint',
    description: 'Numeric command: step or type a value and send it',
    defaultSize: { width: 3, height: 1 },
    icon: '±',
    defaultAction: { topic: '/setpoint', messageType: 'std_msgs/msg/Float64', field: 'data' },
    defaultConfig: { min: 0, max: 100, step: 1, fieldType: 'float64', sendOnChange: false },
  },
  {
    type: 'camera',
    name: 'Camera',
    description: 'Live camera image stream',
    defaultSize: { width: 4, height: 3 },
    icon: '📷',
    defaultAction: { topic: '/camera/image_raw', messageType: 'sensor_msgs/Image' },
    defaultConfig: { cameraTransport: 'proxy' },
  },
  {
    type: 'gauge',
    name: 'Gauge',
    description: 'Dial for a live value: speed, temperature, charge',
    defaultSize: { width: 2, height: 2 },
    icon: '◔',
    defaultAction: { topic: '/gauge', messageType: 'std_msgs/msg/Float64', field: 'data' },
    defaultConfig: { min: 0, max: 100, fieldType: 'float64' },
  },
  {
    type: 'level',
    name: 'Level Bar',
    description: 'Bar filled by a live value: battery, tank, effort',
    defaultSize: { width: 3, height: 1 },
    icon: '▭',
    defaultAction: { topic: '/level', messageType: 'std_msgs/msg/Float64', field: 'data' },
    defaultConfig: { min: 0, max: 100, fieldType: 'float64' },
  },
  {
    type: 'readout',
    name: 'Readout',
    description: 'Large number with its unit',
    defaultSize: { width: 2, height: 1 },
    icon: '#',
    defaultAction: { topic: '/readout', messageType: 'std_msgs/msg/Float64', field: 'data' },
    defaultConfig: { decimals: 2, fieldType: 'float64' },
  },
  {
    type: 'state',
    name: 'State',
    description: 'Names and colours a mode, status code or flag',
    defaultSize: { width: 2, height: 1 },
    icon: '◉',
    defaultAction: { topic: '/state', messageType: 'std_msgs/msg/String', field: 'data' },
    defaultConfig: {
      fieldType: 'string',
      stateMappings: [
        { value: 'ok', label: 'OK', tone: 'ok' },
        { value: 'warning', label: 'Warning', tone: 'warning' },
        { value: 'error', label: 'Error', tone: 'error' },
      ],
    },
  },
  {
    type: 'plot',
    name: 'Plot',
    description: 'Time series graph for numeric topic values',
    defaultSize: { width: 4, height: 2 },
    icon: '📈',
    defaultAction: { topic: '/plot', messageType: 'std_msgs/Float32', field: 'data' },
    defaultConfig: { fieldPath: 'data', fieldPaths: ['data'], timeWindowSec: 10, autoScale: true, minY: -1, maxY: 1 },
  },
  {
    type: 'text',
    name: 'Text',
    description: 'Latest text message, or a short log',
    defaultSize: { width: 4, height: 2 },
    icon: '¶',
    defaultAction: { topic: '/text', messageType: 'std_msgs/msg/String', field: 'data' },
    defaultConfig: { historyLength: 5, fieldType: 'string' },
  },
  {
    type: 'heartbeat',
    name: 'Heartbeat',
    description: 'Boolean status or recurring topic monitor',
    defaultSize: { width: 1, height: 1 },
    icon: 'HB',
    defaultAction: { topic: '/heartbeat', messageType: 'std_msgs/Bool', field: 'data' },
    defaultConfig: { heartbeatMode: 'boolean', heartbeatTimeoutMs: 2000, heartbeatFieldPath: 'data' },
  },
];

/** A new component as the editor adds it: the library's defaults (copied, never shared) and its name as the label. */
export function createComponent(
  type: PadComponentType,
  position: GridPosition,
  id = `${type}-${Date.now()}`
): GamepadComponentConfig | null {
  const item = componentLibrary.find(entry => entry.type === type);
  if (!item) return null;
  const copy = <T,>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  return {
    id,
    type,
    position: { ...position },
    label: item.name,
    action: copy(item.defaultAction),
    config: copy(item.defaultConfig),
  };
}
