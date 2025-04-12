# Custom Gamepad Layouts

This directory (`src/components/gamepads/`) contains different visual layouts and control logic for gamepad-style interfaces used in the application.

## Structure

Each distinct layout resides in its own subdirectory. Current layouts include:

*   **standard**: A standard dual-joystick layout (`StandardPadLayout.tsx`).
*   **voice**: A voice input interface (`VoiceLayout.tsx`).
*   **gameboy**: A GameBoy-style D-pad and A/B button layout (`GameBoyLayout.tsx`).

Example structure:

```
src/
└── components/
    └── gamepads/
        ├── standard/
        │   ├── StandardPadLayout.tsx
        │   └── StandardPadLayout.css
        ├── voice/
        │   ├── VoiceLayout.tsx
        │   └── VoiceLayout.css
        ├── gameboy/
        │   ├── GameBoyLayout.tsx
        │   └── GameBoyLayout.css
        └── README.md              # This file
```

## Creating a New Layout

To add a new custom gamepad layout (e.g., a "SNES Controller"):

1.  **Create Directory:** Make a new folder inside `src/components/gamepads/` (e.g., `snes`).
2.  **Create Component File:** Inside the new folder (e.g., `SnesLayout.tsx`).
    *   Accept `ros: Ros` prop.
    *   Handle user interactions (pointer events recommended).
    *   Publish `sensor_msgs/Joy` messages (or other relevant type) to a ROS topic.
    *   Manage state and ROS topic lifecycle (`useRef`, `useState`, `useEffect`, `useCallback`).
    *   Export the component.
3.  **Create CSS File:** Create corresponding CSS (e.g., `SnesLayout.css`) for styling.
    *   Import into the `.tsx` file.
4.  **Update `MainControlView.tsx`:**
    *   **Add Type:** Add identifier (e.g., `'snes'`) to `PanelType`.
    *   **Import:** Import the new component (`import SnesLayout from './gamepads/snes/SnesLayout';`).
    *   **Add Case:** Add a `case` to the `switch` in `SelectedPanelComponent`.
    *   **Update Counter:** Add to `panelCounters` ref initialization.
5.  **Update `AddPanelMenu.tsx`:**
    *   Add an entry to `availablePanelTypes` (e.g., `{ type: 'snes', label: 'SNES Control' }`).

This integrates the new layout into the control panel system. 