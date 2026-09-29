# XR Workspace Handover

This is the working guide for whoever continues the XR workspace. [`xr.md`](xr.md) explains what the
feature is and how to run it; this document explains how the spatial layer is built, why, and how to
extend it. Read `xr.md` first for entry, session modes and the reuse table.

State at handover: the **3D panel is native and complete**; every other panel type still uses the DOM
mirror. Panels can be added, positioned, resized, configured, moved, summoned and removed entirely in
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
    domSurfaceRenderer.ts  fallback: mirror the DOM panel onto a quad (HTMLMesh)
    threeD/                the native 3D panel (renderer + settings editor)
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
| Add a panel | Raise the left wrist into view, *Add panel* tab, pick a type |
| Find / bring back / remove a panel | Wrist menu *Open (N)*: "Bring to me", or ×  |
| Close a panel | Title bar × |

The scene view is constrained to **yaw only, standing on the floor, within 1.6 × the floor radius**
(`constrainView`). Tilting a robot off its floor makes it look broken and is never what someone
wants.

### Wrist gesture

`shouldShowWristMenu` shows the menu when the wrist is 0.15–0.75 m from the head and within 42° of
the gaze direction, and keeps it visible out to 62° (hysteresis, so a hand reaching for a button on
the menu does not flicker it away). It uses only wrist *position* against head *gaze*, not palm
orientation, because controller grips and tracked-hand grips disagree about "palm up"; a gesture that
works only on one of them is worse than one that works on both. The menu hovers 0.17 m above the wrist
and yaws to face the head.

## 4. Reusable components

All of these are panel-agnostic and independent of ROS.

| Component | Use it for |
| --- | --- |
| `SpatialSurface` | The primitive. One canvas-textured quad hosting pressable rectangles. Owns hit-testing (`itemAt`), per-pointer hover, on-demand redraw. Everything below is built on it. |
| `SurfaceInteraction` | Bridges ray hits to surface items: `getActivationTarget`, `activate`, `hover`. One instance per workspace. |
| `SpatialToolbar` | A row of icon buttons on one surface (`id`, `icon`, `label`, `active`, `danger`, `disabled`). |
| `SpatialMenu` | Paged, stack-navigated menu (`open`, `push`, `pop`, `close`, `refresh`). Row kinds: `header`, `button` (detail, trailing chevron/check, secondary target), `toggle`, `stepper`. Pages are **factories**, so a refresh always reads current state. Fixed size for a given `pageSize`; depth is hidden behind pages, never by growing. |
| `PanelFrame` | Standard panel chrome: backdrop, floor, title bar with ×, toolbar (frame adds Smaller/Larger), menu dock, scale limits. A panel hands it buttons and a menu and gets movement, sizing and closing for free. |
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
  iframes and only refreshes on DOM mutation. A native panel is the only way to get a real 3D scene.
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

- **Non-3D panels are still DOM mirrors.** Video, iframes and WebGL content show placeholders.
- **2D does not live-update from XR.** The 2D 3D panel reads its saved state only at mount, so a layer
  added in XR appears in 2D after that panel remounts.
- **Settings dock to the right of the panel, not below it.** Below the panel puts a tall menu at knee
  height; the toolbar is below, the menu beside. Revisit if user testing prefers otherwise
  (`PanelFrame`: the `menuDock` group's position and rotation).
- **The wrist gesture is gaze-based**, so the wrist must be raised into view; it cannot be opened
  with the arm resting at the side.
- **`hitTest` calls `updateWorldMatrix(true, true)` per pointer per frame.** Fine at a handful of
  panels; if panel counts grow, cache and invalidate.
- **Placement conversion assumes `rootGroup` is translation-only.**
- **`pinned` / `attach: 'viewer'` are stored but not yet applied**; there is no head-locked mode.
- **The desk pose (`desk`, `XR_DESK_PLACEMENT_ID`) is reserved** for the native control pad and unused.
- **Each panel builds its own URDF scene graph**; several large robots cost proportionally more.
- **Not verified on hardware.** Behaviour was verified through unit tests and reasoning about the
  session; XR cannot be driven from an automated browser. First on-device pass should check comfort
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
2. Native XR pad (uses `desk`), then Time Series and Log panels, on `PanelFrame` + `SpatialMenu`.
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
