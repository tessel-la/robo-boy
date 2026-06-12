# Gamepad Runtime

The control-panel runtime only mounts user-created gamepads through `custom/CustomGamepadWrapper.tsx`.

Pad definitions, starter templates, storage, editing, and generic ROS-aware components live in `src/features/customGamepad/`. Add new reusable controls there instead of adding a hardcoded panel type to `MainControlView`.

The `standard`, `gameboy`, and `voice` directories are older standalone implementations kept outside the active panel registry. Their reusable layouts are represented by templates in `src/features/customGamepad/defaultLayouts.ts`.
