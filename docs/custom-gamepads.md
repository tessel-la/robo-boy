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

| Component       | Primary role                                                                      |
| --------------- | --------------------------------------------------------------------------------- |
| Joystick        | Publish continuous virtual axes, including Joy, Twist, and PoseStamped mappings  |
| Physical gamepad | Read and visualize a browser-connected Xbox, PlayStation, or Logitech controller |
| Button          | Publish pressed and released values or indexed Joy buttons                        |
| D-pad           | Publish discrete directional input                                                |
| Toggle          | Maintain and publish an on/off state                                              |
| Slider          | Publish a bounded numeric value                                                   |
| Camera          | Display a proxied or ROS-delivered image stream                                   |
| Plot            | Subscribe to numeric fields and render recent samples                             |
| Heartbeat       | Monitor boolean state or recurring messages                                       |

## Physical Controllers

The physical-gamepad component uses the browser's standard Gamepad API mapping: four axes and 17 buttons. It can auto-detect Xbox/XInput, PlayStation, and Logitech IDs or use an explicitly selected visual profile. It publishes a complete `sensor_msgs/Joy` message at a configurable 1-60 Hz (20 Hz by default) while connected and immediately publishes a neutral message when the controller disappears or the component unmounts.

The responsive visualization uses the full built-in pad width on phones and works in portrait or landscape. Web, iOS, and Android use the same browser Gamepad API path; a controller must be paired with the device and a button may need to be pressed after the app gains focus. If the platform WebView does not expose the API, the pad reports that explicitly. Hiding or suspending the app publishes a neutral Joy message before polling pauses.

Each standard button—including triggers, stick clicks, D-pad directions, center buttons, and home—has independent press and release operations. Operations reuse the same topic, service, and action executor as ordinary pad buttons. Publish rate, stick deadzone, and a preferred browser controller index are saved with the layout. Non-standard browser mappings are displayed with a warning because their raw axis and button order is device- and browser-specific.

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
| Physical-controller normalization        | `src/features/customGamepad/physicalGamepad.ts`                 |
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
