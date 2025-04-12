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

## Theme Customization

The application supports multiple themes, including user-created custom themes. Themes define the color palette for the UI elements.

### Creating & Managing Themes

1.  **Access Theme Menu:** Click the theme icon button (usually in the bottom-right corner). This opens a popup menu displaying available themes (default and custom).

    ![Theme Selector Popup](images/theme_custom_1.jpg)

2.  **Create New Theme:** Click the "Create New Theme..." button in the popup. This opens the Theme Creator modal.

    ![Theme Creator Modal](images/theme_custom_2.jpg)

3.  **Define Theme:**
    *   Enter a unique **Name** for your theme.
    *   Select the base **Colors** (Primary, Secondary, Background) using the color pickers. Optional colors (Text, Border, etc.) can also be set.
    *   Choose an **Icon** to represent your theme in the selector menu.
    *   Click **Save Theme**.

4.  **Editing/Deleting:** Custom themes will have Edit (pencil) and Delete (trash) icons next to them in the theme selector popup. Clicking Edit opens the Theme Creator pre-filled with that theme's settings. Clicking Delete prompts for confirmation before removing the theme.

    ![Theme with Edit/Delete Actions](images/theme_custom_3).jpg)

### How it Works

*   Default themes (`light`, `dark`, `solarized`) have their CSS variables defined directly in `src/index.css` using `[data-theme="themename"]` selectors.
*   Custom themes are stored in the browser's `localStorage`.
*   When a custom theme is selected, JavaScript dynamically generates a `<style>` tag containing CSS variable overrides based on the saved colors and injects it into the document head. The `<body>` element also gets a `data-theme="custom-theme-id"` attribute.
*   UI components should primarily use the defined CSS variables (e.g., `var(--primary-color)`, `var(--background-color)`) for styling to ensure they adapt correctly to the selected theme. 