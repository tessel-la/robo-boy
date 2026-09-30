# XR Workspace Handover

This is the working guide for whoever continues the XR workspace. [`xr.md`](xr.md) explains what the
feature is and how to run it; this document explains how the spatial layer is built, why, and how to
extend it. Read `xr.md` first for entry, session modes and the reuse table.

Current state: **all built-in panel types have dedicated XR presentations**. Pad uses tangible controls and an immersive draft editor; external panels use captured surfaces. Panels can be added, positioned, resized, configured, moved, summoned and removed entirely in
XR. The interaction model was designed to be reused, not to be specific to 3D.

## 1. What exists

```
src/xr/
  XrSceneManager.ts        renderer, scene, session, render loop (owns rootGroup > uiGroup)
  XrInputManager.ts        controllers/hands -> rays, grab/select events, wrist pose
  grabbable.ts             one- and two-hand grab maths, pose helpers
  XrWorkspace.tsx          React glue: panel lifecycle, wrist menu, placement persistence
  types.ts, xrWorkspaceStorage.ts   persisted placements (robo-boy-xr-workspace-v1)
  panels/
    registry.ts            panel type -> renderer; XrPanelContext / XrPanelInstance contracts
    domSurfaceRenderer.ts  fallback: built-in DOM mirror (HTMLMesh), routes external panels below
    externalSurfaceRenderer.ts  sandbox-rendered 2D texture and balanced controller holds
    threeD/                the native 3D panel (renderer + settings editor)
    timeSeries/            native plot and settings, sharing the desktop tile's engine
    tfTree/                native graph, frame details, diagnostics and transform calculator
    camera/                live and recorded frames from the mounted camera tile
    pad/                   3D controls + immersive draft editor + shared mounted control handlers
    behaviorTree/          fitted graph + shared editor executor and saved-tree menu
    recordReplay/          native transport, recorder controls and remote file browser
  ui/                      reusable spatial UI kit (see section 4)
  world/
    fit.ts                 fit a model to a circular stage
    displays/              DisplayHost + one class per 3D layer type
```

## 2. Architecture

### Scene graph

```
scene
└─ rootGroup            floor offset only (translation)
   └─ uiGroup           everything the user interacts with
      ├─ panel frame    (PanelFrame.object)        <- grabbable, scalable, persisted
      │  ├─ backdrop, floor disc, title bar, toolbar, menu dock
      │  └─ viewRoot    origin at the floor centre, Y-up
      │     ├─ view     (grabbable, persisted separately)
      │     │  └─ rosFrame   rotated -90° about X: ROS Z-up -> WebXR Y-up
      │     │     └─ robot, TF, point clouds, ...   (DisplayHost owns these)
      │     └─ proxy    invisible cylinder over the floor (see "Pick proxy")
      ├─ wrist menu     (WristMenu.object)
      └─ hint board     (HintBoard.object, only while no panel is open)
```

The rule that makes the 3D panel behave like a small world: **a panel's content is parented to its
frame, never to the room.** There is no world-space robot. Moving a frame moves everything in it, with
no bookkeeping, and the persisted pose of a panel is only the frame's pose.

`rootGroup` is a private floor offset in `XrSceneManager`. `uiGroup` is what everything else uses.
Placement conversion assumes `rootGroup` is translation-only.

### Panel lifecycle

`XrWorkspace.tsx` reconciles `WorkspacePanel[]` against mounted XR panels while a session is running:

1. **Spawn** — `mountPanel` resolves the renderer (`resolveXrPanelRenderer`), builds an
   `XrPanelContext`, calls `create`, and adds `instance.object` to `uiGroup`. If a native `create`
   throws, it falls back to `domSurfaceRenderer` rather than leaving a hole.
2. **Position** — stored pose if there is one; otherwise the default arc when several panels mount at
   once (session start); otherwise `frontOfViewerPose` (a panel added mid-session lands in front of
   the user, below eye level, facing them). A new placement is saved immediately.
3. **Move / resize** — squeeze (grip) grabs the nearest ancestor with `userData.xrGrabbable`.
   One hand carries; two hands scale and twist. `onGrabEnd` persists. The frame's `constrain` hook
   clamps scale to `FRAME_SCALE_LIMITS` for grabs as well as for the size buttons.
4. **Configure** — the toolbar's gear opens a `SpatialMenu` docked to the panel.
5. **Manipulate the scene** — grab the world (through the proxy) to turn, slide and scale it on the
   floor; toolbar Fit / Reset / zoom buttons do the same precisely. The result is saved as the
   panel's `view` pose.
6. **Close** — the title bar's × calls `ctx.requestClose()`, the wrist menu's × calls `onRemovePanel`.
   Both go through the same 2D workspace handler, so XR and 2D never disagree about what is open.
   `dispose()` is idempotent and releases all GPU resources, timers and ROS subscriptions.

Panels are added and removed through props (`onAddPanel`, `onRemovePanel`) wired in
`MainControlView`. **XR never owns the panel list**; it renders `panels` and asks for changes.

### The contract a panel implements

```ts
// src/xr/panels/registry.ts
interface XrPanelContext {
  panelId; panelType; title; ros; isPassthrough; storageScope; meshResourcesBaseUrl;
  initialView?: XrPose;      // last saved inner view pose
  requestClose(): void;      // ask the workspace to remove this panel
  savePlacement(): void;     // frame pose/scale changed by the panel itself
  saveView(pose: XrPose): void;
}
interface XrPanelInstance {
  object: THREE.Object3D;    // add to the scene; make it xrGrabbable to move it
  update?(frame): void;      // per rendered frame
  getActivationTarget?, onActivate?, onHover?   // for panels that own surfaces
  onPressStart?, onPressMove?, onPressEnd?       // balanced holds; release handles cancellation
  setActive?, dispose(): void;
}
```

A renderer opts in with `registerXrPanelRenderer(...)` at module load (see the bottom of
`XrWorkspace.tsx`). Nothing under `src/xr/` other than that line imports a panel.

### Input

`XrInputManager` turns controllers and hands into pointers. Facts you need:

- **Squeeze** grabs; the target is the nearest ancestor with `userData.xrGrabbable`, or whatever an
  object redirects to through `userData.xrGrabTarget`.
- **Select** activates. It only fires if the select *ends* on the same object with the same
  non-null activation target as where it started. That is what stops a drag or a brush past a
  button from pressing it, and it is why surfaces report an *item identity*, not just a mesh
  (`SurfaceInteraction.getActivationTarget` returns `"<surfaceUid>:<itemId>"`, or null over a margin).
- External controls opt into `onPressStart` / `onPressMove` / `onPressEnd`. Holds cancel before any
  grip manipulation, on >5 cm travel, target change, tracking loss, disconnect or disposal. The
  sandbox adds a 400 ms input lease so a stopped XR frame loop cannot leave a drive hold active.
- Hit testing considers **meshes only**; it skips hidden objects, subtrees marked `userData.xrPickable === false`, and objects marked
  `userData.xrExcludeHandedness === '<hand>'` for that hand's pointer (the wrist menu excludes the
  hand it hangs from so that hand cannot press its own wrist).
- `getWristPose(handedness)` returns the grip pose if visible, else the ray-space pose, else null when the hand is not tracked.

### Pick proxy

Robot meshes are deliberately not pickable — a robot can be tens of thousands of triangles and the
hit test runs per pointer per frame. Instead an invisible cylinder over the floor carries
`userData.xrGrabTarget = view`, so grabbing anywhere over the robot grabs the *view*, not the panel.
Grabbing the backdrop, floor rim or title grabs the panel. This is how "move the panel" and "turn the
scene" coexist without a mode switch.

## 3. Interaction model

| Intent | Gesture |
| --- | --- |
| Press a control | Point and select (trigger/pinch) — begin and end on the same control |
| Move a panel | Squeeze its frame (backdrop, floor rim, title) and carry |
| Resize a panel | Squeeze with both hands and spread/close, or toolbar Smaller / Larger |
| Turn / slide / scale the scene inside a panel | Squeeze the robot area; one hand slides + yaws, two hands scale |
| Fit, reset, zoom the scene | Toolbar buttons |
| Open settings | Toolbar gear; the menu docks beside the panel (toggle closes it) |
| Add a panel | Left controller X, or wrist **Panels** button; *Add panel* tab, pick a type |
| Find / bring back / remove a panel | Wrist menu *Open (N)*: "Bring to me", or ×  |
| Close a panel | Title bar × |

The scene view is constrained to **yaw only, standing on the floor, within 1.6 × the floor radius**
(`constrainView`). Tilting a robot off its floor makes it look broken and is never what someone
wants.

### Wrist launcher and controller button

The full menu opens only through **left X** or the small wrist **Panels** button. X toggles once
per press; the menu's × also closes it. `XrInputManager` reads the left `xr-standard` controller's
first face button (index 4), ignoring touch, holds, right-controller buttons and unknown mappings.
Buttons held at connection or pressed while tracking is lost require a fresh press. Toggling
releases robot holds on both controllers first. The headset's reserved system-menu button is not used.

`shouldShowWristLauncher` shows only the launcher when the wrist is 0.15–0.75 m from the head and
within 42° of gaze, retaining it out to 62° to avoid flicker. It uses wrist position rather than
palm orientation, so the clickable launcher also works for tracked hands and controllers without
an X button. The open menu follows the wrist regardless of this gaze gate, 0.17 m above it and
yawing to face the head. Tracking loss closes it; returning tracking does not reopen it.

## 4. Reusable components

All of these are panel-agnostic and independent of ROS.

| Component | Use it for |
| --- | --- |
| `SpatialSurface` | The primitive. One canvas-textured quad hosting pressable rectangles. Owns hit-testing (`itemAt`), per-pointer hover, on-demand redraw. Everything below is built on it. |
| `SurfaceInteraction` | Bridges ray hits to surface items: `getActivationTarget`, `activate`, `hover`. One instance per workspace. |
| `SpatialToolbar` | A row of icon buttons on one surface (`id`, `icon`, `label`, `active`, `danger`, `disabled`). |
| `SpatialMenu` | Paged, stack-navigated menu (`open`, `push`, `pop`, `close`, `refresh`). Row kinds: `header`, `button` (detail, trailing chevron/check, secondary target), `toggle`, `stepper`. Pages are **factories**, so a refresh always reads current state. Fixed size for a given `pageSize`; depth is hidden behind pages, never by growing. |
| `PanelFrame` | Standard panel chrome: backdrop, floor, title bar with ×, toolbar (frame adds Smaller/Larger), menu dock, scale limits. `layout: 'surface'` omits the floor and places content and toolbar against the backdrop for flat data panels. |
| `WristMenu` | Catalogue + open-panels menu on the wrist. Owns no workspace state; takes callbacks. |
| `HintBoard` | Non-interactive floating note. |
| `DisplayHost` | Reconciles a `VisualizationPanelState` into live displays (layers by id + options signature; point layers rebuilt on fixed-frame change). Holds the single shared TF subscription. |
| `fit.ts` | `computeMeshBounds` and `fitBoundsToStage` — stand any model on a circular stage. |
| `grabbable.ts` | `XrGrabController`, `toXrPose` / `applyXrPose`, `defaultPanelPose`, `frontOfViewerPose`. |
| `canvasKit.ts` | Theme (`XR_THEME`), icons, text and rounded-rect drawing. |

Drawing is on demand (items changed or hover changed), never per frame. A menu costs nothing while
untouched.

### Conventions worth keeping

- **Pages are factories; actions compute next state and commit.** `Xr3dSettings` never mutates
  anything: every action builds the next `VisualizationPanelState` and calls `commit`. That keeps the
  menu a pure editor of state and the scene, storage and menu incapable of disagreeing.
- **Menus update at once, heavy work is debounced.** `commit` saves and refreshes the menu
  immediately; the display rebuild follows 250 ms later, so a burst of stepper presses rebuilds once.
- **Item ids are stable strings** (`row-<n>`, `row-<n>:secondary`, `row-<n>:dec|inc`, `tab-<id>`,
  `prev`, `next`, `back`, `close`, `header`, `empty`). Tests and activation identity depend on them.
- **Panels own their cleanup.** `dispose` must be idempotent and release timers, geometries,
  materials, textures and ROS subscriptions.

## 5. Decisions and why

- **Native panels instead of mirroring the DOM.** The mirror cannot rasterise WebGL, video or
  nested iframes and only refreshes on DOM mutation. External sandbox DOM now has its own low-rate
  capture path. A native panel is the way to get a real 3D scene.
- **A dedicated scene manager, not the 2D viewer.** Covered in `xr.md`. Do not revisit.
- **XR is a consumer of ROS.** No second connection stack; one `/tf` + `/tf_static` pair, shared.
- **The robot is anchored to the panel, not the room.** Simpler than syncing a world pose, and it
  is what makes several 3D panels (different robots or fixed frames) possible.
- **Desktop and XR share visualization state.** Same storage key as the 2D panel
  (`roboboy_3d_visualization_state_<panelId>`), same types. A fresh XR panel with nothing configured
  seeds a robot-model layer, since that is what nearly everyone wants first; a panel whose layers
  were removed on purpose is *not* re-seeded (presence of stored state distinguishes the two).
- **Controllers are drawn as a ray and cursor**, not loaded from a CDN profile — offline operation.
- **Wrist gesture is gaze-based** (see above) so it works on controllers and hands alike.
- **Canvas-textured UI, not HTMLMesh, for XR-native UI.** Sharper, deterministic layout, and full
  control over hover and disabled states; HTMLMesh stays as the fallback for unported panels.
- **Placement persistence:** a panel stores `{ pose, pinned, attach, view? }`. `view` is the inner
  scene pose; it is separate so resetting the scene never moves the panel.

## 6. Current limitations

- **External panels use flat fallbacks.** All built-ins now have dedicated presentations. External panel DOM renders
  inside its own sandbox; Microduck holds and actions work in immersive XR. Video/nested frames need
  native rendering. Text entry, browser dialogs and arbitrary drag controls still lack XR parity.
- **Time Series text editing stays on desktop.** Labels, custom field paths, expressions and CSV export remain desktop controls. Existing math, units and labels are preserved and used in XR.
- **2D does not live-update from XR.** The 2D 3D panel reads its saved state only at mount, so a layer
  added in XR appears in 2D after that panel remounts.
- **Settings dock to the right of the panel, not below it.** Below the panel puts a tall menu at knee
  height; the toolbar is below, the menu beside. Revisit if user testing prefers otherwise
  (`PanelFrame`: the `menuDock` group's position and rotation).
- **The launcher is gaze-based; the full menu opens explicitly.** Left X can toggle it with the
  arm at the side, but the menu still follows the wrist.
- **`hitTest` calls `updateWorldMatrix(true, true)` per pointer per frame.** Fine at a handful of
  panels; if panel counts grow, cache and invalidate.
- **Placement conversion assumes `rootGroup` is translation-only.**
- **`pinned` / `attach: 'viewer'` are stored but not yet applied**; there is no head-locked mode.
- **The desk pose (`desk`, `XR_DESK_PLACEMENT_ID`) is reserved** for the native control pad and unused.
- **Each panel builds its own URDF scene graph**; several large robots cost proportionally more.
- **Not verified on hardware.** Unit tests and the WebXR emulator verify behaviour; the native
  Time Series browser test covers settings, subscription reuse and return to 2D. First on-device pass should check comfort
  (panel distance and drop of 1.1 m / 0.25 m), wrist menu reach, and grab feel.
- **The auto-fit window** (first 6 s after a model appears) can rescale a robot whose meshes stream
  in slowly; any manual grab or zoom cancels it.

## 7. Continuing the work

### Port another panel

1. Create `src/xr/panels/<name>/<name>Renderer.ts` exporting an `XrPanelRenderer`.
2. In `create(ctx)`: build a `PanelFrame`, attach content under `frame.viewRoot`, set toolbar
   buttons with `frame.setToolbar([...])`, and attach a `SpatialMenu` with `frame.attachMenu(menu)` if
   the panel has settings. Return `{ object: frame.object, update?, dispose }`.
3. Pass `onClose: () => ctx.requestClose()` and `onPlacementChange: () => ctx.savePlacement()`.
4. Register it next to `registerXrPanelRenderer(threeDPanelRenderer)` in `XrWorkspace.tsx`.
5. If the panel owns surfaces of its own, expose them through `getActivationTarget` / `onActivate` /
   `onHover` using a `SurfaceInteraction` (see how `XrWorkspace` routes it for frames and menus).
6. Write tests next to it; `threeDRenderer.test.ts` shows how to mock ROS and drive the toolbar.

`ThreeDPanel` is the reference implementation. It is intentionally free of anything that only a 3D
panel needs in `PanelFrame`, `SpatialMenu` and `WristMenu`.

### Suggested next steps

1. Headset pass on the 3D panel: comfort distances, wrist reach, grab feel, menu legibility.
2. Headset comfort/legibility pass on Pad, Behavior Tree and Record & Replay. Pad uses movable 3D controls and an immersive editor; verify grip, two-hand sizing and keyboard reach. The earlier Log suggestion does not correspond to a built-in panel in this checkout.
3. Apply `pinned` and `attach: 'viewer'` (a head-locked group, with a pin toggle in the toolbar).
4. Make 2D panels observe visualization state changes so XR edits show in 2D live.
5. Hand-tracking affordances (pinch-specific rays, poke buttons).
6. Consider a shared `Fixed frame` / `Layers` model between 2D and XR settings so a new layer type
   only needs adding in one place (`LAYER_OPTION_SPECS` in `Xr3dSettings.ts` is the XR half).

### Verification checklist

```bash
npx tsc --noEmit -p .
npm run lint
npm run test:run -- src/xr
npm run profile:frontend   # perf contract: idle 3D panel, 0 draws outside XR
```

Tests need `canvasStub.ts` (jsdom has no 2D canvas): call `stubCanvasContext()` in `beforeAll`.

## Time Series continuation

`timeSeriesRenderer.ts` uses the shared flat `PanelFrame`, a `SpatialSurface` plot and paged legend,
and `XrTimeSeriesSettings`. The toolbar provides Signals, Pause/Resume, Live and zoom; the settings
menu offers ROS topic discovery, signal visibility/removal, detected field selection, colors,
smoothing, history clearing and plot/performance controls. Drawing reuses `drawPlotContent` from
the desktop plot and only uploads a texture when data or controls change, capped by `renderFps`.

The desktop tile remains the owner of acquisition. `features/timeSeries/presentation.ts` exposes
its engine and settings callback, keyed by panel id **and connection storage scope**. XR attaches to
that presentation, retaining history, assistant edits, replay clocks and the existing subscription
controller. While attached, acquisition continues even if the desktop surface is hidden, and its
canvas loop is suspended. Settings persist through the workspace's existing callback and appear in
2D immediately. No second ROS subscription or new storage schema is introduced.

The renderer follows late registration and replay remounts during its frame update; disposing it
releases presentation ownership, discovery timeouts and GPU resources without clearing history.
If the desktop tile is absent it displays a waiting state. Do not create a second engine to mask
that lifecycle state. The connection scope must be passed by any new tile host.

Targeted verification: `npm run test:run -- src/xr src/features/timeSeries` and
`npx playwright test e2e/xr-time-series.spec.ts --config config/playwright.config.ts --project chromium`.
Physical headset comfort and legibility still need an on-device pass.

## TF tree continuation

`tfTreeRenderer.ts` consumes the mounted desktop tile through `features/tfTree/presentation.ts`,
using the same connection-scoped registry as Time Series. The tile retains ownership of the TF
subscription and replay source. XR keeps acquisition active, suspends desktop edge animation and
graph rebuilding, and releases that ownership on exit without resetting the shared stream.

`TfTreeSurface` reuses `layoutTfTree` and the shared `filterTfTree` rules. Its flat frame has Fit,
zoom and a paged frame browser; selecting a frame opens details in the dock. Large trees can be
navigated through the browser and Focus in graph. Transform values, parent/children, static/dynamic
source and age are available alongside cycle/multiple-parent diagnostics and the existing
`calculateTfBetweenFrames` calculator. Refresh explicitly describes its connection-wide effect
before invoking the desktop refresh action. Filter text is edited on desktop; XR can clear it.
Settings are shared with the mounted tile, matching its existing session-only lifetime.

State processing is capped at 10 Hz. Layout only changes with topology, and graph texture updates
only follow changes in topology, transform source, stale status or user interaction. Stale status
advances even when no new messages arrive. Frame hit regions are clipped with the drawing, so zoom
cannot produce invisible targets over chrome. Menus use the shared non-interactive `value` row for
readable telemetry and paged numeric results.

Verification includes `npm run test:run -- src/features/tfTree src/xr src/features/timeSeries` and
the VR/AR tests in `e2e/xr-tf-tree.spec.ts`; both modes verify one shared TF subscription pair,
updates during XR, filter changes and restoration of the desktop graph.


## External fallback continuation

Microduck now uses its actual 2D UI and ROS logic inside VR/AR, in the shared flat `PanelFrame`.
Capture stays within its opaque-origin sandbox. `src/panels/capturePanelSurface.ts` adapts pinned
html2canvas internals because the public iframe-cloning API is blocked by that origin boundary.
Do not weaken the sandbox. `sandboxSurface.ts` owns target validation, DOM input and the hold lease;
`externalPanelSurface.ts` owns request correlation and bitmap lifetime. Captures run at 2 Hz, while
input leases renew every 100 ms. Inactive/disposed surfaces cancel input and release their images.
The host temporarily uses a 720 × 500 iframe viewport for readable controls, restored on exit.

Checks: unit coverage for balanced holds, stale targets, watchdog expiry and protocol validation;
self-contained Chromium capture/scroll/style-restoration regression; actual Microduck integration in
VR/AR with emulated controllers and mocked ROS. Native TF and Time Series browser tests also pass.
Hardware headset validation remains outstanding. See `docs/xr.md` for running the optional real
Microduck integration and the fallback's browser-control/CSS limitations.


## Camera continuation

`src/xr/panels/camera/cameraRenderer.ts` presents the built-in Camera on the shared flat `PanelFrame`
with a paged Topics menu and Retry. Live and recorded tiles register through
`features/camera/presentation.ts`, keyed by panel id and connection scope. The renderer reads the
same image/canvas and topic selection callbacks as the mounted tile; it creates no stream,
subscription, decoder or independent settings state. Missing camera topics now still mount a tile
presentation, so XR can show its availability status and follow late discovery.

Live MJPEG pixels change without DOM mutations. XR copies them at most 30 times per second to a
bounded canvas texture, preserving aspect ratio with letterboxing. Recorded frames expose a
revision counter; a paused recording uploads nothing until its frame or status changes. Topic
changes and live/replay remounts replace the source, and disposal releases XR textures and tile
presentation ownership. Desktop source cleanup remains responsible for closing the MJPEG response.

Cross-origin image servers must allow CORS for WebGL texture use. The tile requests anonymous CORS
only while XR presents an absolute cross-origin stream, restoring its desktop behavior on exit.
The same-origin video proxy needs no reload on XR entry. A tainted canvas is cleared before error
text is uploaded; it cannot reach WebGL. Retry uses the tile's existing stream/replay pipeline.

Verification: camera renderer and tile tests cover shared frames, scope isolation, throttling,
paused replay, aspect ratio, taint rejection and cleanup. `e2e/xr-camera.spec.ts` exercises real
changing multipart MJPEG in VR/AR with one stream, topic switching, retry and removal; it also runs
real ROS 2 CDR images through the MCAP replay worker and verifies paused seek and topic changes.
Screenshots were reviewed. Physical headset validation remains outstanding. The external WebRTC
panel still needs a separate video renderer; this native implementation covers the built-in Camera.


## Missing-panel continuation (2026-09-30)

- Pad (superseded by the spatial designer below): the first renderer captured the configured grid
  with the pinned html2canvas parser/renderer, preserving readouts, plots and physical-pad visuals. The capture helper
  now accounts for the subtree's document offset, also retaining external sandbox capture behavior.
  The `spatialControl` WeakMap registers existing control callbacks on their own elements. XR chooses
  targets within that subtree even when an XR DOM overlay covers it. One pointer owns each hold;
  configuration replacement releases through the original handler before unregistering it.
- `XrInputManager.allowsPressDrag` permits motion only inside the original joystick, slider or replay
  timeline. It never permits crossing controls on a shared mesh. Ordinary clicks and Microduck holds
  retain their existing excursion cancellation. Momentary button and D-pad release now cancel pending
  throttled messages and publish the release immediately.
- Behavior Tree: native canvas graph/status, paged node details, subtree/parent navigation, saved trees,
  execution controls and blackboard inspection. The connection-scoped presentation uses the mounted
  editor's handlers and executor. A synchronous execution guard rejects a second Run before React
  renders the executing state. Local/persistent execution lifetimes remain owned by the editor/ROS.
- Record & Replay: native dashboard with a balanced timeline drag, shared desktop seek debounce,
  speed/loop/topics, ROS-host file browsing and the existing recorder hook. No worker, subscription,
  publisher or recording session is duplicated. Pending acknowledgements disable recorder controls.
- Tree authoring and native file/save dialogs remain desktop workflows. Pad video or nested-frame
  content still needs a dedicated renderer. Pad authoring and text entry now have the immersive
  designer described below. The reserved `desk` placement remains unused.

Verification uses emulated VR and AR with mock ROS, real indexed MCAP replay, and the unmodified
Microduck bundle. Unit checks include control replacement/unmount releases and drag target isolation.
Physical headset comfort, capture cost, readout legibility and hand tracking remain unverified.

Checks passed: 727 unit tests across the affected features and XR, TypeScript, ESLint, and the
production build. Eight VR/AR browser scenarios cover Pad, Behavior Tree, Record & Replay, and
Microduck; the sandbox is rebuilt before its regression check.


## Spatial Pad designer (2026-09-30)

`pad/padRenderer.ts` now composes native `PadControl` meshes and `XrPadEditor`; the implementation
stays entirely in the XR Pad folder. It uses the shared frame and spatial menu, plus a Pad-local
keyboard. `padSpatialLayout.ts` validates and scopes poses separately from the desktop grid.

The existing Pad presentation exposes its active layout and two callbacks: `setEditing` disables
mounted publishers during authoring, and `saveLayout` uses the workspace's existing storage/library
refresh path. XR holds continue to call `spatialControl` handlers, with one pointer per control and
balanced cancellation. Data blocks keep cropped faces from the existing capture helper.

Edits are drafts. Grips carry objects; two grips scale, clamped to 0.4–2 and the board dimensions.
Drops snap to the visible Pad grid and reset depth/rotation. A green/red footprint previews free/
occupied cells; occupied drops return to the last completed placement. Save persists poses and the configured layout, cloning templates;
Cancel/XR teardown restores play mode without saving. A failed save retains the draft and restores
previous poses. A changed source layout blocks saving rather than overwriting another edit.

Desktop editor code and component command semantics are unchanged. The small presentation bridge
and workspace save callback let saved labels/configuration appear in 2D immediately. Spatial poses
are not included in desktop Pad JSON export. Physical gamepad objects still represent hardware
input, matching the desktop component; trigger interaction does not synthesize hardware buttons.

See [`xr-pad.md`](xr-pad.md) and the renderer unit / VR–AR browser tests. Physical headset grab feel,
small-control legibility and keyboard comfort still need on-device validation.

## Replay sources and Pad grid (2026-09-30)

`MainControlView` passes its existing live/replay visualization source to `XrWorkspace`. Native
3D, TF tree, Camera and Time Series use that source. Opening a recording, backward seeking or
returning to live data recreates affected visual instances while retaining their panel placements.
Pad, recorder and other command panels keep the live ROS connection. The immersive session stays open.

Pad XR poses stay separate from desktop positions. Stored free placements are aligned on load;
conflicts fall back to original positions. New controls fit both grids, and resizing/reset reject
occupied destinations. Saving during a grab uses the last completed drop; only the final hand
release snaps a two-handed grab. Grid and preview meshes are non-pickable and disposed with the Pad.

Browser replay fixtures include a recording-only robot-description topic, verify native discovery
and actual geometry, backward seeking, return to live topics, and live recorder commands in VR/AR.
Pad browser tests cover grid alignment, occupied-drop rollback, two-handed release and unchanged
desktop positions. Physical headset feedback still needs verification.

Validation: 496 tests passed in the broad affected unit suite (8 existing skips), followed by
16 passing Pad unit tests after the final authoring safeguards. Eight VR/AR browser scenarios,
TypeScript, ESLint and the production build passed. The real-simulator scenario is opt-in and
was skipped without its stack flag.
