// Shared joystick types for use across gamepad components
// This interface is not exported from react-joystick-component, so we define it locally

export interface IJoystickUpdateEvent {
    type: 'move' | 'stop' | 'start';
    x: number | null;
    y: number | null;
    direction: string | null;
    distance: number | null;
}
