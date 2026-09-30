# Spatial Pad designer

The XR Pad is a set of tangible controls inside the standard Robo Boy panel frame. Buttons have
raised caps, the joystick has a shaft and tilting grip, the D-pad has four caps, and switches/sliders
have moving handles. Physical gamepads have a sculpted body; their input still comes from the
connected hardware. Readouts, plots and setpoints keep their existing display on a block face.

## Use

1. Open **Edit**, or **New** for an empty Pad. Robot and hardware commands are disabled while editing.
2. Select **Add component** to choose from the existing component library. Select an object to edit
   its label, ROS topic/type/field, settings, colors, event operations or gamepad button bindings.
   Text fields open an immersive keyboard. Apply commits the field to the draft; Cancel closes it.
   Arrays/mappings and message payloads use JSON; parsing errors keep the input open.
3. Grip an object to carry and rotate it. Two grips scale it. Objects can float ahead of the panel;
   they are kept within 1.5 m of its content origin, with a scale of 0.4–2. Grip the frame to move
   the entire Pad. **Reset spatial placement** puts the selected object back at its grid position.
4. **Save** updates the Pad library and saves XR positions. Built-in templates become custom copies.
   **Cancel** discards the draft. Leaving XR also discards an unsaved draft.

XR placements belong to the saved Pad and current connection. Desktop grid positions remain
unchanged by spatial movement/rotation/scaling. Explicit additions, removals, configuration and
2D-grid size changes become shared edits only on Save. Library/export behavior stays the same;
XR positions are stored separately and are not part of desktop Pad exports.

## Ownership

- `padRenderer.ts`: frame, reconciliation, input ownership, capture of data faces and teardown.
- `PadControl.ts`: meshes, stationary ray targets, labels and visual control feedback.
- `XrPadEditor.ts`: draft, component/settings menus, local keyboard, Save/Cancel.
- `padSpatialLayout.ts`: initial grid-to-scene placement and validated connection-scoped XR poses.
- `features/customGamepad/presentation.ts`: narrow bridge to the mounted Pad and its workspace save
  callback. The mounted components keep ownership of ROS subscriptions, publishers and hardware input.

There is no new command engine, input framework or desktop editor. Editing passes `isEditing` to
existing mounted controls, including physical-gamepad polling. Holds release before edits, layout
changes and grips; disconnected/replaced controls and XR teardown release through the original
handler. Each held command has one XR pointer owner.

A Save failure leaves the draft open, reports the error and restores previous XR storage. If the
source layout changes elsewhere, the draft remains open but cannot overwrite that change; cancel
and reopen it. Malformed or out-of-range stored poses are ignored. Data faces report unavailable
capture and reject input until a valid image matches the mounted dimensions.

## Validation

Unit tests cover real volume construction, directional mapping, single-pointer ownership,
cancellation, source changes, Save failure, template cloning, keyboard edits, pose validation,
connection isolation and cleanup. Browser tests exercise real emulated controller grips, VR/AR
commands, editing, persistence, Cancel and returning to desktop controls. Existing custom-Pad and
2D editor tests cover the shared behavior. Physical headset comfort and hand tracking remain to be
verified on hardware.

Verified in this implementation: 411 targeted unit tests passed (8 existing tests skipped), four
unchanged desktop-editor browser scenarios passed, and both VR/AR scenarios passed with the new
object-grab/edit/save/cancel flow. TypeScript, ESLint and the production build passed.
