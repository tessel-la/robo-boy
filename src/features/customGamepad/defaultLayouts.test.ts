import { describe, expect, it } from 'vitest';
import {
  componentLibrary,
  defaultDualJoystickHeartbeatLayout,
  defaultGamepadLibrary,
  defaultPhysicalGamepadLayout,
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

  it('provides the generic and physical-controller templates', () => {
    validateLayout(defaultDualJoystickHeartbeatLayout);
    validateLayout(defaultPhysicalGamepadLayout);
    expect(defaultGamepadLibrary).toHaveLength(2);
    expect(defaultGamepadLibrary[0]).toMatchObject({
      id: 'dual-joystick-heartbeat',
      name: 'Dual Joystick + Heartbeat',
      isDefault: true,
    });
    expect(defaultGamepadLibrary[1]).toMatchObject({
      id: 'physical-gamepad',
      name: 'Physical Gamepad',
      isDefault: true,
    });
    expect(defaultPhysicalGamepadLayout.components[0]).toMatchObject({
      type: 'physical-gamepad',
      position: { x: 0, y: 0, width: 8, height: 4 },
      action: { topic: '/joy', messageType: 'sensor_msgs/msg/Joy', field: 'axes' },
      config: { physicalGamepadProfile: 'auto', physicalGamepadDeadzone: 0.08, physicalGamepadPublishHz: 20 },
    });
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
    expect(componentLibrary.map(component => component.type)).toEqual([
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
    componentLibrary.forEach(component => {
      expect(component.name).toBeTruthy();
      expect(component.description).toBeTruthy();
      expect(component.icon).toBeTruthy();
      expect(component.defaultSize.width).toBeGreaterThan(0);
      expect(component.defaultSize.height).toBeGreaterThan(0);
    });
  });
});
