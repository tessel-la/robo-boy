// Types for the custom gamepad system

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

export interface GamepadComponentConfig {
  id: string;
  type: 'joystick' | 'button' | 'dpad' | 'toggle' | 'slider';
  position: GridPosition;
  label?: string;
  action?: ComponentAction;
  style?: {
    color?: string;
    size?: 'small' | 'medium' | 'large';
    variant?: string;
  };
  config?: {
    // Joystick specific
    maxValue?: number;
    axes?: string[]; // Which axes to map to
    
    // Button specific
    buttonIndex?: number;
    momentary?: boolean; // true for momentary, false for toggle
    
    // D-pad specific
    buttonMapping?: Record<string, number>; // direction -> button index
    
    // Slider specific
    min?: number;
    max?: number;
    step?: number;
    orientation?: 'horizontal' | 'vertical';
  };
}

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

export interface EditorState {
  selectedComponentId: string | null;
  draggedComponent: DragItem | null;
  gridSize: { width: number; height: number };
  cellSize: number;
  showGrid: boolean;
  snapToGrid: boolean;
} 