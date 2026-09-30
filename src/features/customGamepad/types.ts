// Types for the custom gamepad system

import type { RosOperation } from '../../utils/rosOperations';
import type { StateMapping } from './padValues';

export type PhysicalGamepadProfile = 'auto' | 'xbox' | 'playstation' | 'logitech';

export type PhysicalGamepadControlId =
  | 'face-bottom'
  | 'face-right'
  | 'face-left'
  | 'face-top'
  | 'left-bumper'
  | 'right-bumper'
  | 'left-trigger'
  | 'right-trigger'
  | 'select'
  | 'start'
  | 'left-stick'
  | 'right-stick'
  | 'dpad-up'
  | 'dpad-down'
  | 'dpad-left'
  | 'dpad-right'
  | 'home';

export interface PhysicalGamepadBinding {
  press?: RosOperation;
  release?: RosOperation;
}

export interface GridPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ROSTopicConfig {
  topic: string;
  messageType: string;
  field?: string; // For specific fields in complex messages
}

export interface ActionServiceConfig {
  name: string;
  type: 'action' | 'service';
  messageType: string;
}

export type ComponentAction = ROSTopicConfig | ActionServiceConfig | {
  type: 'custom';
  handler: string; // Function name for custom handlers
};

export enum ComponentInteractionMode {
  None = 'none',
  Translate = 'translate',
  Resize = 'resize',
  Settings = 'settings'
}

export type PadComponentType =
  | 'joystick' | 'physical-gamepad' | 'button' | 'dpad' | 'toggle' | 'slider' | 'camera' | 'plot' | 'heartbeat'
  | 'gauge' | 'level' | 'readout' | 'state' | 'setpoint' | 'text';

export interface GamepadComponentConfig {
  id: string;
  type: PadComponentType;
  position: GridPosition;
  label?: string;
  action?: ComponentAction;
  eventOperations?: {
    press?: RosOperation;
    release?: RosOperation;
    on?: RosOperation;
    off?: RosOperation;
  };
  style?: {
    color?: string;
    size?: 'small' | 'medium' | 'large';
    variant?: string;
  };
  config?: {
    // Joystick specific
    maxValue?: number;
    axes?: string[]; // Which axes to map to
    axisScales?: number[]; // Optional per-axis output scaling after range mapping
    poseStampedFrameId?: string;
    poseStampedReferenceMode?: 'frame' | 'tf' | 'odometry';
    poseStampedReferenceFrameId?: string;
    poseStampedOdometryTopic?: string;
    poseStampedOdometryMessageType?: string;
    poseStampedUseOdometryOrientation?: boolean;
    twistStampedFrameId?: string;

    // Physical gamepad specific
    physicalGamepadProfile?: PhysicalGamepadProfile;
    physicalGamepadIndex?: number;
    physicalGamepadDeadzone?: number;
    physicalGamepadPublishHz?: number;
    physicalGamepadBindings?: Partial<Record<PhysicalGamepadControlId, PhysicalGamepadBinding>>;

    // Button specific
    buttonIndex?: number;
    momentary?: boolean; // true for momentary, false for toggle
    messagePath?: string;
    pressedValue?: number;
    releasedValue?: number;

    // D-pad specific
    buttonMapping?: Record<string, number>; // direction -> button index

    // Slider specific
    min?: number;
    max?: number;
    step?: number;
    orientation?: 'horizontal' | 'vertical';
    sliderMin?: number;  // Alias for min used by settings modal
    sliderMax?: number;  // Alias for max used by settings modal

    // Camera specific
    cameraTransport?: 'proxy' | 'ros';
    streamType?: string;
    streamWidth?: number;
    streamHeight?: number;

    // Plot specific
    fieldPath?: string;
    fieldPaths?: string[];
    timeWindowSec?: number;
    sampleLimit?: number;
    autoScale?: boolean;
    minY?: number;
    maxY?: number;

    // Heartbeat specific
    heartbeatMode?: 'boolean' | 'pulse';
    heartbeatTimeoutMs?: number;
    heartbeatFieldPath?: string;

    // Values shown or sent (gauge, level, readout, state, setpoint, text). The field is `action.field`; the range
    // is `min`/`max`, with `step` for a setpoint and `orientation` for a level bar.
    /** Primitive type of the field (`float64`, `int32`, `bool`…), when it was picked from the message's fields. */
    fieldType?: string;
    unit?: string;
    decimals?: number;
    /** Shown value = field value × scale + offset (e.g. 0–1 battery fraction × 100 → percent). */
    scale?: number;
    offset?: number;
    /** Thresholds, in shown units: at or past them the value turns amber, then red. */
    warnAt?: number;
    alarmAt?: number;
    /** The thresholds count downward: low values are the concern (battery, pressure). */
    alertBelow?: boolean;
    /** No message for this long marks the value stale; 0 or unset never does. */
    staleAfterMs?: number;
    /** State indicator: what each value is called and how it is coloured. */
    stateMappings?: StateMapping[];
    /** Text display: how many recent messages stay on screen. */
    historyLength?: number;
    /** Setpoint: publish on every change instead of waiting for Send. */
    sendOnChange?: boolean;
  };
}

export type JoyAxesPublisher = (
  config: GamepadComponentConfig,
  values: number[]
) => boolean;

export type TwistAxesPublisher = (
  config: GamepadComponentConfig,
  values: number[]
) => boolean;

export interface CustomGamepadLayout {
  id: string;
  name: string;
  description?: string;
  gridSize: {
    width: number;
    height: number;
  };
  cellSize: number; // Size of each grid cell in pixels
  components: GamepadComponentConfig[];
  rosConfig: {
    defaultTopic: string;
    defaultMessageType: string;
  };
  metadata: {
    created: string;
    modified: string;
    version: string;
  };
}

export interface GamepadLibraryItem {
  id: string;
  name: string;
  description: string;
  layout: CustomGamepadLayout;
  isDefault: boolean;
  thumbnail?: string; // Base64 encoded image or URL
}

// For the grid editor
export interface DragItem {
  componentType: GamepadComponentConfig['type'];
  defaultSize: { width: number; height: number };
}

// Drag source types for distinguishing between palette drags and component moves
export type DragSource = 'palette' | 'grid';

export interface DragState {
  isDragging: boolean;
  source: DragSource;
  componentType?: GamepadComponentConfig['type'];
  componentId?: string;  // For moving existing components
  defaultSize?: { width: number; height: number };
  startPosition?: { x: number; y: number };
}

export interface DropPreview {
  x: number;
  y: number;
  width: number;
  height: number;
  isValid: boolean;
  /** Smaller than the component's default size, to fit the room there is. */
  isFitted?: boolean;
}

export interface EditorState {
  selectedComponentId: string | null;
  draggedComponent: DragItem | null;
  dragState: DragState | null;
  dropPreview: DropPreview | null;
  gridSize: { width: number; height: number };
  cellSize: number;
  showGrid: boolean;
  snapToGrid: boolean;
}
