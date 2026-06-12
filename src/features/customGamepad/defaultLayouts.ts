import { CustomGamepadLayout, GamepadLibraryItem } from './types';

// The built-in library intentionally contains one generic starting point.
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

// Component library for the editor
export const componentLibrary = [
  {
    type: 'joystick' as const,
    name: 'Joystick',
    description: 'Analog stick for continuous control',
    defaultSize: { width: 2, height: 2 },
    icon: '🕹️'
  },
  {
    type: 'button' as const,
    name: 'Button',
    description: 'Momentary or toggle button',
    defaultSize: { width: 1, height: 1 },
    icon: '🔘'
  },
  {
    type: 'dpad' as const,
    name: 'D-Pad',
    description: 'Directional pad with 4 directions',
    defaultSize: { width: 2, height: 2 },
    icon: '✚'
  },
  {
    type: 'toggle' as const,
    name: 'Toggle',
    description: 'On/off switch',
    defaultSize: { width: 2, height: 1 },
    icon: '🔄'
  },
  {
    type: 'slider' as const,
    name: 'Slider',
    description: 'Linear control slider',
    defaultSize: { width: 3, height: 1 },
    icon: '🎚️'
  },
  {
    type: 'camera' as const,
    name: 'Camera',
    description: 'Live camera image stream',
    defaultSize: { width: 4, height: 3 },
    icon: '📷'
  },
  {
    type: 'plot' as const,
    name: 'Plot',
    description: 'Time series graph for numeric topic values',
    defaultSize: { width: 4, height: 2 },
    icon: '📈'
  },
  {
    type: 'heartbeat' as const,
    name: 'Heartbeat',
    description: 'Boolean status or recurring topic monitor',
    defaultSize: { width: 1, height: 1 },
    icon: 'HB'
  }
]; 
