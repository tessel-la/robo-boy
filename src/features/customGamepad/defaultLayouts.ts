import { CustomGamepadLayout, GamepadLibraryItem } from './types';

// Default layouts based on existing gamepads
export const defaultStandardLayout: CustomGamepadLayout = {
  id: 'default-standard',
  name: 'Standard Dual Joystick',
  description: 'Classic dual joystick layout for robot control',
  gridSize: { width: 8, height: 6 },
  cellSize: 80,
  components: [
    {
      id: 'left-joystick',
      type: 'joystick',
      position: { x: 0, y: 1, width: 2, height: 2 },
      label: 'Movement',
      action: {
        topic: '/joy',
        messageType: 'sensor_msgs/Joy',
        field: 'axes'
      },
      config: {
        maxValue: 1.0,
        axes: ['0', '1'] // axes 0 and 1
      }
    },
    {
      id: 'right-joystick',
      type: 'joystick',
      position: { x: 6, y: 1, width: 2, height: 2 },
      label: 'Camera',
      action: {
        topic: '/joy',
        messageType: 'sensor_msgs/Joy',
        field: 'axes'
      },
      config: {
        maxValue: 1.0,
        axes: ['2', '3'] // axes 2 and 3
      }
    }
  ],
  rosConfig: {
    defaultTopic: '/joy',
    defaultMessageType: 'sensor_msgs/Joy'
  },
  metadata: {
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    version: '1.0.0'
  }
};

export const defaultGameBoyLayout: CustomGamepadLayout = {
  id: 'default-gameboy',
  name: 'GameBoy Style',
  description: 'Retro GameBoy-inspired control layout',
  gridSize: { width: 8, height: 4 },
  cellSize: 80,
  components: [
    {
      id: 'dpad',
      type: 'dpad',
      position: { x: 0, y: 1, width: 2, height: 2 },
      label: 'D-Pad',
      action: {
        topic: '/joy',
        messageType: 'sensor_msgs/Joy',
        field: 'buttons'
      },
      config: {
        buttonMapping: {
          up: 0,
          right: 1,
          down: 2,
          left: 3
        }
      }
    },
    {
      id: 'button-b',
      type: 'button',
      position: { x: 5, y: 1, width: 1, height: 1 },
      label: 'B',
      action: {
        topic: '/joy',
        messageType: 'sensor_msgs/Joy',
        field: 'buttons'
      },
      config: {
        buttonIndex: 5,
        momentary: true
      },
      style: {
        color: '#ff6b6b'
      }
    },
    {
      id: 'button-a',
      type: 'button',
      position: { x: 6, y: 2, width: 1, height: 1 },
      label: 'A',
      action: {
        topic: '/joy',
        messageType: 'sensor_msgs/Joy',
        field: 'buttons'
      },
      config: {
        buttonIndex: 4,
        momentary: true
      },
      style: {
        color: '#4ecdc4'
      }
    },
    {
      id: 'select-button',
      type: 'button',
      position: { x: 2, y: 3, width: 1, height: 1 },
      label: 'SELECT',
      action: {
        topic: '/joy',
        messageType: 'sensor_msgs/Joy',
        field: 'buttons'
      },
      config: {
        buttonIndex: 6,
        momentary: true
      },
      style: {
        size: 'small'
      }
    },
    {
      id: 'start-button',
      type: 'button',
      position: { x: 5, y: 3, width: 1, height: 1 },
      label: 'START',
      action: {
        topic: '/joy',
        messageType: 'sensor_msgs/Joy',
        field: 'buttons'
      },
      config: {
        buttonIndex: 7,
        momentary: true
      },
      style: {
        size: 'small'
      }
    }
  ],
  rosConfig: {
    defaultTopic: '/joy',
    defaultMessageType: 'sensor_msgs/Joy'
  },
  metadata: {
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    version: '1.0.0'
  }
};

export const defaultDroneLayout: CustomGamepadLayout = {
  id: 'default-drone',
  name: 'Drone Control',
  description: 'Specialized layout for drone control',
  gridSize: { width: 8, height: 6 },
  cellSize: 80,
  components: [
    {
      id: 'left-stick',
      type: 'joystick',
      position: { x: 0, y: 2, width: 2, height: 2 },
      label: 'Throttle/Yaw',
      action: {
        topic: '/joy',
        messageType: 'sensor_msgs/Joy',
        field: 'axes'
      },
      config: {
        maxValue: 1.0,
        axes: ['0', '1']
      }
    },
    {
      id: 'right-stick',
      type: 'joystick',
      position: { x: 6, y: 2, width: 2, height: 2 },
      label: 'Pitch/Roll',
      action: {
        topic: '/joy',
        messageType: 'sensor_msgs/Joy',
        field: 'axes'
      },
      config: {
        maxValue: 1.0,
        axes: ['2', '3']
      }
    },
    {
      id: 'arm-button',
      type: 'toggle',
      position: { x: 1, y: 0, width: 2, height: 1 },
      label: 'ARM',
      action: {
        topic: '/drone/arm',
        messageType: 'std_msgs/Bool'
      },
      style: {
        color: '#ff4757'
      }
    },
    {
      id: 'takeoff-button',
      type: 'button',
      position: { x: 3, y: 0, width: 2, height: 1 },
      label: 'TAKEOFF',
      action: {
        name: '/drone/takeoff',
        type: 'action',
        messageType: 'drone_msgs/TakeoffAction'
      },
      config: {
        momentary: false
      },
      style: {
        color: '#2ed573'
      }
    },
    {
      id: 'land-button',
      type: 'button',
      position: { x: 5, y: 0, width: 2, height: 1 },
      label: 'LAND',
      action: {
        name: '/drone/land',
        type: 'action',
        messageType: 'drone_msgs/LandAction'
      },
      config: {
        momentary: false
      },
      style: {
        color: '#ffa502'
      }
    }
  ],
  rosConfig: {
    defaultTopic: '/joy',
    defaultMessageType: 'sensor_msgs/Joy'
  },
  metadata: {
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    version: '1.0.0'
  }
};

export const defaultManipulatorLayout: CustomGamepadLayout = {
  id: 'default-manipulator',
  name: 'Manipulator Cartesian Control',
  description: 'Dual-stick Cartesian arm control based on the legacy manipulator pad',
  gridSize: { width: 8, height: 4 },
  cellSize: 80,
  components: [
    {
      id: 'rotation-stick',
      type: 'joystick',
      position: { x: 0, y: 1, width: 3, height: 3 },
      label: 'Rotation',
      action: {
        topic: '/servo_node/delta_twist_cmds',
        messageType: 'geometry_msgs/TwistStamped'
      },
      config: {
        min: -0.6,
        max: 0.6,
        axes: ['angular.x', 'angular.y'],
        twistStampedFrameId: 'panda_link0'
      }
    },
    {
      id: 'translation-stick',
      type: 'joystick',
      position: { x: 5, y: 1, width: 3, height: 3 },
      label: 'Translation',
      action: {
        topic: '/servo_node/delta_twist_cmds',
        messageType: 'geometry_msgs/TwistStamped'
      },
      config: {
        min: -0.6,
        max: 0.6,
        axes: ['linear.x', 'linear.y'],
        twistStampedFrameId: 'panda_link0'
      }
    },
    {
      id: 'z-up-button',
      type: 'button',
      position: { x: 3, y: 1, width: 2, height: 1 },
      label: 'Z +',
      action: {
        topic: '/servo_node/delta_twist_cmds',
        messageType: 'geometry_msgs/TwistStamped'
      },
      config: {
        momentary: true,
        messagePath: 'linear.z',
        pressedValue: 0.6,
        releasedValue: 0,
        twistStampedFrameId: 'panda_link0'
      }
    },
    {
      id: 'z-down-button',
      type: 'button',
      position: { x: 3, y: 2, width: 2, height: 1 },
      label: 'Z -',
      action: {
        topic: '/servo_node/delta_twist_cmds',
        messageType: 'geometry_msgs/TwistStamped'
      },
      config: {
        momentary: true,
        messagePath: 'linear.z',
        pressedValue: -0.6,
        releasedValue: 0,
        twistStampedFrameId: 'panda_link0'
      }
    },
    {
      id: 'manipulator-heartbeat',
      type: 'heartbeat',
      position: { x: 3, y: 0, width: 1, height: 1 },
      label: 'Arm 1',
      action: {
        topic: '/arm_1/dynamic_joint_states',
        messageType: 'control_msgs/msg/DynamicJointState'
      },
      config: {
        heartbeatMode: 'pulse',
        heartbeatTimeoutMs: 1500
      }
    }
  ],
  rosConfig: {
    defaultTopic: '',
    defaultMessageType: ''
  },
  metadata: {
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    version: '1.0.0'
  }
};

// Mobile-optimized layout
export const defaultMobileLayout: CustomGamepadLayout = {
  id: 'default-mobile',
  name: 'Mobile Optimized',
  description: 'Simple layout optimized for smartphone use',
  gridSize: { width: 6, height: 4 },
  cellSize: 100,
  components: [
    {
      id: 'left-joystick',
      type: 'joystick',
      position: { x: 0, y: 1, width: 2, height: 2 },
      label: 'Move',
      action: {
        topic: '/cmd_vel',
        messageType: 'geometry_msgs/Twist',
        field: 'linear'
      },
      config: {
        maxValue: 1.0,
        axes: ['linear.x', 'angular.z']
      }
    },
    {
      id: 'stop-button',
      type: 'button',
      position: { x: 2, y: 0, width: 2, height: 1 },
      label: 'STOP',
      action: {
        topic: '/cmd_vel',
        messageType: 'geometry_msgs/Twist'
      },
      config: {
        momentary: false
      },
      style: {
        color: '#ff4757'
      }
    },
    {
      id: 'action-button',
      type: 'button',
      position: { x: 4, y: 2, width: 2, height: 1 },
      label: 'ACTION',
      action: {
        topic: '/action',
        messageType: 'std_msgs/Bool'
      },
      config: {
        momentary: true
      },
      style: {
        color: '#2ed573'
      }
    }
  ],
  rosConfig: {
    defaultTopic: '',
    defaultMessageType: ''
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
    id: 'mobile',
    name: 'Mobile Optimized',
    description: 'Simple layout optimized for smartphone use',
    layout: defaultMobileLayout,
    isDefault: true
  },
  {
    id: 'standard',
    name: 'Standard Dual Joystick',
    description: 'Classic dual joystick layout for general robot control',
    layout: defaultStandardLayout,
    isDefault: true
  },
  {
    id: 'gameboy',
    name: 'GameBoy Style',
    description: 'Retro GameBoy-inspired control layout with D-pad and buttons',
    layout: defaultGameBoyLayout,
    isDefault: true
  },
  {
    id: 'drone',
    name: 'Drone Control',
    description: 'Specialized layout for aerial vehicle control',
    layout: defaultDroneLayout,
    isDefault: true
  },
  {
    id: 'manipulator',
    name: 'Manipulator Cartesian Control',
    description: 'Dual-stick Cartesian arm controls with Z movement and heartbeat',
    layout: defaultManipulatorLayout,
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
