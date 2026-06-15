# Custom Gamepads

Custom gamepads are JSON-defined control surfaces created and rendered by the same feature module. Users normally manage them through the application; developers can extend the component system when a robot needs a new interaction.

## User Workflow

1. Open the `+` menu in the control-panel tabs.
2. Create an empty layout or clone a starter template.
3. Place and resize components on the grid.
4. Configure ROS topics, message types, field mappings, and display options.
5. Preview and save the layout.

Layouts are stored in `localStorage` under `robo-boy-custom-gamepads`. Exported JSON is versioned and can be imported into another browser.

## Supported Components

| Component | Primary role                                                            |
| --------- | ----------------------------------------------------------------------- |
| Joystick  | Publish continuous axes, including Joy, Twist, and PoseStamped mappings |
| Button    | Publish pressed and released values or indexed Joy buttons              |
| D-pad     | Publish discrete directional input                                      |
| Toggle    | Maintain and publish an on/off state                                    |
| Slider    | Publish a bounded numeric value                                         |
| Camera    | Display a proxied or ROS-delivered image stream                         |
| Plot      | Subscribe to numeric fields and render recent samples                   |
| Heartbeat | Monitor boolean state or recurring messages                             |

## Runtime Flow

1. `AddPanelMenu` loads built-in templates and saved layouts.
2. `GamepadEditor` edits a `CustomGamepadLayout`.
3. `gamepadStorage.ts` validates and persists the layout.
4. `MainControlView` creates a panel referencing the layout ID.
5. `CustomGamepadWrapper` loads the saved definition.
6. `CustomGamepadLayout` and `GamepadComponent` render the grid and component implementation.
7. Components publish or subscribe through the shared `ROSLIB.Ros` connection.

## Important Files

| Responsibility                           | File                                                            |
| ---------------------------------------- | --------------------------------------------------------------- |
| Layout and component types               | `src/features/customGamepad/types.ts`                           |
| Built-in templates and palette           | `src/features/customGamepad/defaultLayouts.ts`                  |
| Import, export, and persistence          | `src/features/customGamepad/gamepadStorage.ts`                  |
| ROS message conversion and introspection | `src/features/customGamepad/rosMessageUtils.ts`                 |
| Editor                                   | `src/features/customGamepad/components/GamepadEditor.tsx`       |
| Runtime renderer                         | `src/features/customGamepad/components/CustomGamepadLayout.tsx` |
| Component dispatch and editor shell      | `src/features/customGamepad/components/GamepadComponent.tsx`    |
| Main-view adapter                        | `src/components/gamepads/custom/CustomGamepadWrapper.tsx`       |

The `standard`, `gameboy`, and `voice` directories under `src/components/gamepads/` are legacy standalone implementations. New runtime controls belong in the configurable custom-gamepad system.

## Adding A Component Type

1. Add the type and its configuration fields to `GamepadComponentConfig` in `types.ts`.
2. Add palette metadata and a default size to `componentLibrary` in `defaultLayouts.ts`.
3. Implement the component under `src/features/customGamepad/components/`.
4. Register it in the runtime dispatch used by `CustomGamepadLayout` or `GamepadComponent`.
5. Add settings controls to `ComponentSettingsModal` when configuration is user-editable.
6. Put reusable ROS message construction or schema discovery in `rosMessageUtils.ts` rather than in the visual component.
7. Add focused tests for rendering, publishing/subscribing, storage compatibility, and cleanup.

Keep saved layouts backward compatible. New configuration fields should be optional or normalized during load so older exports continue to work.

## Adding ROS Message Support

- Accept both ROS 1-style (`sensor_msgs/Joy`) and ROS 2-style (`sensor_msgs/msg/Joy`) names when practical.
- Keep message construction pure and testable in `rosMessageUtils.ts`.
- Discover schemas through rosapi when the message structure is not fixed.
- Create ROS publishers and subscribers in effects or component lifecycle code, and always unadvertise or unsubscribe during cleanup.
- Reuse a shared publisher when several components write different fields of the same Joy message.
