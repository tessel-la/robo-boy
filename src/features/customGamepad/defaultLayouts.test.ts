import { describe, expect, it } from 'vitest';
import {
  componentLibrary,
  createComponent,
  defaultDualJoystickHeartbeatLayout,
  defaultGamepadLibrary,
} from './defaultLayouts';
import type { CustomGamepadLayout, GamepadLibraryItem } from './types';

describe('defaultLayouts', () => {
  const validateLayout = (layout: CustomGamepadLayout) => {
    expect(layout.id).toBeTruthy();
    expect(layout.name).toBeTruthy();
    expect(layout.gridSize.width).toBeGreaterThan(0);
    expect(layout.gridSize.height).toBeGreaterThan(0);
    expect(layout.cellSize).toBeGreaterThan(0);
    expect(Array.isArray(layout.components)).toBe(true);
    expect(layout.metadata.version).toBeTruthy();
  };

  it('offers only the generic controller as a starter template', () => {
    validateLayout(defaultDualJoystickHeartbeatLayout);
    expect(defaultGamepadLibrary).toHaveLength(1);
    expect(defaultGamepadLibrary[0]).toMatchObject({
      id: 'dual-joystick-heartbeat',
      name: 'Dual Joystick + Heartbeat',
      isDefault: true,
    });
    expect(defaultGamepadLibrary.some(item => item.id === 'physical-gamepad')).toBe(false);
  });

  it('maps both joysticks to one four-axis Joy topic', () => {
    const joysticks = defaultDualJoystickHeartbeatLayout.components.filter(
      component => component.type === 'joystick'
    );

    expect(joysticks).toHaveLength(2);
    expect(joysticks.map(component => component.action)).toEqual([
      { topic: '/joy', messageType: 'sensor_msgs/msg/Joy', field: 'axes' },
      { topic: '/joy', messageType: 'sensor_msgs/msg/Joy', field: 'axes' },
    ]);
    expect(joysticks.map(component => component.config?.axes)).toEqual([
      ['0', '1'],
      ['2', '3'],
    ]);
  });

  it('contains one pulse heartbeat and no Z controls', () => {
    const heartbeat = defaultDualJoystickHeartbeatLayout.components.find(
      component => component.type === 'heartbeat'
    );
    const buttons = defaultDualJoystickHeartbeatLayout.components.filter(
      component => component.type === 'button'
    );

    expect(buttons).toHaveLength(0);
    expect(heartbeat).toMatchObject({
      label: 'Heartbeat',
      action: { topic: '/heartbeat', messageType: 'std_msgs/msg/Bool' },
      config: { heartbeatMode: 'pulse', heartbeatTimeoutMs: 1500 },
    });
  });

  it('contains valid library items', () => {
    defaultGamepadLibrary.forEach((item: GamepadLibraryItem) => {
      expect(item.description).toBeTruthy();
      validateLayout(item.layout);
    });
  });

  it('keeps all editor component types available', () => {
    // Controls first, then what shows data.
    expect(componentLibrary.map(component => component.type)).toEqual([
      'joystick',
      'physical-gamepad',
      'button',
      'dpad',
      'toggle',
      'slider',
      'setpoint',
      'camera',
      'gauge',
      'level',
      'readout',
      'state',
      'plot',
      'text',
      'heartbeat',
    ]);
    componentLibrary.forEach(component => {
      expect(component.name).toBeTruthy();
      expect(component.description).toBeTruthy();
      expect(component.icon).toBeTruthy();
      expect(component.defaultSize.width).toBeGreaterThan(0);
      expect(component.defaultSize.height).toBeGreaterThan(0);
      expect(component.defaultAction.topic).toMatch(/^\//);
      expect(component.defaultAction.messageType).toBeTruthy();
    });
  });

  it('creates components with the defaults the editor always gave them', () => {
    const at = { x: 1, y: 2, width: 2, height: 1 };
    expect(createComponent('slider', at, 'slider-1')).toEqual({
      id: 'slider-1',
      type: 'slider',
      position: at,
      label: 'Slider',
      action: { topic: '/slider', messageType: 'std_msgs/Float32', field: 'data' },
      config: undefined,
    });
    expect(createComponent('plot', at)?.config).toEqual({
      fieldPath: 'data', fieldPaths: ['data'], timeWindowSec: 10, autoScale: true, minY: -1, maxY: 1,
    });
    expect(createComponent('heartbeat', at)?.action).toEqual({ topic: '/heartbeat', messageType: 'std_msgs/Bool', field: 'data' });
    expect(createComponent('gauge', at)).toMatchObject({
      label: 'Gauge',
      action: { topic: '/gauge', messageType: 'std_msgs/msg/Float64', field: 'data' },
      config: { min: 0, max: 100 },
    });
  });

  it('never shares default objects between components', () => {
    const first = createComponent('state', { x: 0, y: 0, width: 2, height: 1 })!;
    first.config!.stateMappings![0].label = 'Changed';
    first.position.x = 5;
    const second = createComponent('state', { x: 0, y: 0, width: 2, height: 1 })!;
    expect(second.config!.stateMappings![0].label).toBe('OK');
    expect(componentLibrary.find(item => item.type === 'state')!.defaultConfig!.stateMappings![0].label).toBe('OK');
  });
});
