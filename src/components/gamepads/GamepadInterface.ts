import type { Ros } from 'roslib';

/**
 * Common interface for all gamepad components
 * This ensures all gamepad types implement the same basic props
 */
export interface GamepadProps {
  ros: Ros;
  // Add other common props here if needed
}

/**
 * An enum of available gamepad types
 * Use this for type-safe references to gamepad types
 */
export enum GamepadType {
  Standard = 'standardpad',
  Voice = 'voicelayout',
  GameBoy = 'gameboy',
  Drone = 'dronepad',
  Manipulator = 'manipulatorpad'
} 