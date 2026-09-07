import type { PhysicalGamepadControlId, PhysicalGamepadProfile } from './types';

export const DEFAULT_PHYSICAL_GAMEPAD_PUBLISH_HZ = 20;
export const MIN_PHYSICAL_GAMEPAD_PUBLISH_HZ = 1;
export const MAX_PHYSICAL_GAMEPAD_PUBLISH_HZ = 60;

export const normalizePhysicalGamepadPublishHz = (value: number | undefined): number => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_PHYSICAL_GAMEPAD_PUBLISH_HZ;
  return Math.max(MIN_PHYSICAL_GAMEPAD_PUBLISH_HZ, Math.min(MAX_PHYSICAL_GAMEPAD_PUBLISH_HZ, numericValue));
};

export const PHYSICAL_GAMEPAD_CONTROLS: ReadonlyArray<{
  id: PhysicalGamepadControlId;
  buttonIndex: number;
}> = [
  { id: 'face-bottom', buttonIndex: 0 },
  { id: 'face-right', buttonIndex: 1 },
  { id: 'face-left', buttonIndex: 2 },
  { id: 'face-top', buttonIndex: 3 },
  { id: 'left-bumper', buttonIndex: 4 },
  { id: 'right-bumper', buttonIndex: 5 },
  { id: 'left-trigger', buttonIndex: 6 },
  { id: 'right-trigger', buttonIndex: 7 },
  { id: 'select', buttonIndex: 8 },
  { id: 'start', buttonIndex: 9 },
  { id: 'left-stick', buttonIndex: 10 },
  { id: 'right-stick', buttonIndex: 11 },
  { id: 'dpad-up', buttonIndex: 12 },
  { id: 'dpad-down', buttonIndex: 13 },
  { id: 'dpad-left', buttonIndex: 14 },
  { id: 'dpad-right', buttonIndex: 15 },
  { id: 'home', buttonIndex: 16 },
];

const PROFILE_LABELS: Record<Exclude<PhysicalGamepadProfile, 'auto'>, Record<PhysicalGamepadControlId, string>> = {
  xbox: {
    'face-bottom': 'A',
    'face-right': 'B',
    'face-left': 'X',
    'face-top': 'Y',
    'left-bumper': 'LB',
    'right-bumper': 'RB',
    'left-trigger': 'LT',
    'right-trigger': 'RT',
    select: 'View',
    start: 'Menu',
    'left-stick': 'LS',
    'right-stick': 'RS',
    'dpad-up': 'D-pad Up',
    'dpad-down': 'D-pad Down',
    'dpad-left': 'D-pad Left',
    'dpad-right': 'D-pad Right',
    home: 'Xbox',
  },
  playstation: {
    'face-bottom': '×',
    'face-right': '○',
    'face-left': '□',
    'face-top': '△',
    'left-bumper': 'L1',
    'right-bumper': 'R1',
    'left-trigger': 'L2',
    'right-trigger': 'R2',
    select: 'Create',
    start: 'Options',
    'left-stick': 'L3',
    'right-stick': 'R3',
    'dpad-up': 'D-pad Up',
    'dpad-down': 'D-pad Down',
    'dpad-left': 'D-pad Left',
    'dpad-right': 'D-pad Right',
    home: 'PS',
  },
  logitech: {
    'face-bottom': 'A',
    'face-right': 'B',
    'face-left': 'X',
    'face-top': 'Y',
    'left-bumper': 'LB',
    'right-bumper': 'RB',
    'left-trigger': 'LT',
    'right-trigger': 'RT',
    select: 'Back',
    start: 'Start',
    'left-stick': 'L',
    'right-stick': 'R',
    'dpad-up': 'D-pad Up',
    'dpad-down': 'D-pad Down',
    'dpad-left': 'D-pad Left',
    'dpad-right': 'D-pad Right',
    home: 'Mode',
  },
};

export interface PhysicalGamepadSnapshot {
  axes: [number, number, number, number];
  buttons: number[];
  pressed: boolean[];
}

export const EMPTY_GAMEPAD_SNAPSHOT: PhysicalGamepadSnapshot = {
  axes: [0, 0, 0, 0],
  buttons: Array(17).fill(0),
  pressed: Array(17).fill(false),
};

export const detectPhysicalGamepadProfile = (
  requested: PhysicalGamepadProfile | undefined,
  gamepadId = ''
): Exclude<PhysicalGamepadProfile, 'auto'> => {
  if (requested && requested !== 'auto') return requested;
  const id = gamepadId.toLowerCase();
  if (/playstation|dualshock|dualsense|sony|wireless controller/.test(id)) return 'playstation';
  if (/logitech|f310|f510|f710/.test(id)) return 'logitech';
  return 'xbox';
};

export const getPhysicalGamepadControlLabel = (
  controlId: PhysicalGamepadControlId,
  profile: Exclude<PhysicalGamepadProfile, 'auto'>
): string => PROFILE_LABELS[profile][controlId];

export const applyGamepadDeadzone = (value: number, deadzone: number): number => {
  const safeValue = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  const safeDeadzone = Number.isFinite(deadzone) ? Math.max(0, Math.min(0.95, deadzone)) : 0.08;
  const magnitude = Math.abs(safeValue);
  if (magnitude <= safeDeadzone) return 0;
  return Math.sign(safeValue) * ((magnitude - safeDeadzone) / (1 - safeDeadzone));
};

export const snapshotPhysicalGamepad = (gamepad: Gamepad, deadzone = 0.08): PhysicalGamepadSnapshot => ({
  axes: [0, 1, 2, 3].map(index =>
    applyGamepadDeadzone(gamepad.axes[index] ?? 0, deadzone)
  ) as PhysicalGamepadSnapshot['axes'],
  buttons: PHYSICAL_GAMEPAD_CONTROLS.map(({ buttonIndex }) => gamepad.buttons[buttonIndex]?.value ?? 0),
  pressed: PHYSICAL_GAMEPAD_CONTROLS.map(({ buttonIndex }) => gamepad.buttons[buttonIndex]?.pressed ?? false),
});

export const findPhysicalGamepad = (gamepads: ArrayLike<Gamepad | null>, preferredIndex?: number): Gamepad | null => {
  if (preferredIndex !== undefined && preferredIndex >= 0) {
    const preferred = gamepads[preferredIndex];
    return preferred?.connected ? preferred : null;
  }
  return Array.from(gamepads).find((gamepad): gamepad is Gamepad => Boolean(gamepad?.connected)) ?? null;
};

export const physicalGamepadSnapshotKey = (snapshot: PhysicalGamepadSnapshot): string =>
  [...snapshot.axes.map(value => value.toFixed(3)), ...snapshot.buttons.map(value => value.toFixed(2))].join(',');
