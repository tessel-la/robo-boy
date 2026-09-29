# Immersive XR Workspace

Robo-Boy can present its workspace as a spatial control room on a WebXR device, in enclosed VR or in
AR passthrough. It is an additional presentation layer, not a separate application: the same ROS
connection, the same panels and the same pad definitions drive both. With no headset present nothing
changes and nothing extra is downloaded.

This document covers the architecture, how to run and test it, and what it cannot do yet.

## Entering

An "Enter XR Workspace" control appears at the bottom right of a connected session when the device
reports an immersive mode. Where a device offers both, a VR/AR toggle sits beside it.

The entry point is gated in two stages:

1. `MainControlView` checks for `navigator.xr` synchronously. Absent — every desktop browser without
   an emulator, and every Tauri webview — and the XR chunk is never even fetched.
2. `useXrSupport` then probes `immersive-vr` and `immersive-ar` **independently**, because supporting
   one implies nothing about the other. A Quest 2 is effectively VR-only, an Android handheld is
   AR-only, a Quest 3 serves both. A probe that rejects counts as unsupported, not as an error.

WebXR requires a secure context, so this works on `https://` or `localhost` only.

## Architecture

### A dedicated scene manager, not the 2D viewer

`src/xr/XrSceneManager.ts` owns its own `THREE.WebGLRenderer`, scene and session. It does **not**
extend the 2D viewer in `src/utils/ros3d.ts`, for three structural reasons:

- That viewer is invalidation-driven — `requestRender` is a single-flight `requestAnimationFrame`
  guard, and `docs/performance.md` makes "an idle 3D scene issues no draws" a regression contract.
  WebXR needs `setAnimationLoop` running continuously. One object cannot honour both.
- `OrbitControls` writes camera position, quaternion and up on every input event, while
  `renderer.xr` owns the camera during a session. They would fight every frame.
- An `XRWebGLLayer` binds to one WebGL context, but every open 3D panel builds its own renderer and
  there may be none open at all.

### What is reused

Everything below the renderer, which is most of the value:

| Reused | Where | How |
| --- | --- | --- |
| ROS connection | the session's existing `ros` | passed in; never a second connection |
| TF | `src/utils/tfStream.ts` | `subscribeToTfStream` is ref-counted per `Ros`, so XR joins the existing `/tf` + `/tf_static` pair rather than adding one |
| TF lookup | `src/utils/tfUtils.ts` | its own `CustomTFProvider`, fed from that shared stream |
| Robot geometry | `ROS3D.UrdfClient` | takes a `rootObject`, so URDF parsing, `package://` resolution, mesh loading and TF-driven link poses all run unchanged against the XR scene |
| ROS publishing | `src/utils/rosOperations.ts`, `src/features/customGamepad/rosMessageUtils.ts` | for native control surfaces, from phase 2 |

`UrdfClient`'s optional `requestRender` is deliberately left unset: the session renders continuously,
so the invalidation callback the 2D viewer needs has nothing to do here.

ROS is Z-up and a WebXR reference space is Y-up. Each 3D panel rotates one group by -90° about X
(`rosFrame`) rather than converting every transform, which keeps the ROS3D classes untouched.

### The 3D panel is a native spatial panel

The 3D panel is not mirrored from the DOM. `src/xr/panels/threeD/threeDRenderer.ts` builds it as a
small self-contained world: a floor, a backdrop, a title bar and a toolbar (`PanelFrame`), with the
robot, TF frames and every other layer parented to a `view` group standing on that floor. Because
the world is a child of the panel, moving, resizing or closing the panel carries all of it. Settings
open as a `SpatialMenu` docked beside the panel. Layers and their options are the desktop panel's own
`VisualizationPanelState`, saved under the same key, so both sides see the same configuration.

New panels are added from a wrist menu (`WristMenu`): raise the left wrist into view, choose *Add
panel*, and the panel appears in front of you. *Open* lists what is already there, with "bring to
me" and remove. The full design, the reusable pieces and how to extend it are in the
[XR handover](xr-handover.md).

### Panels

`src/xr/panels/registry.ts` maps a panel type to a spatial renderer, with a generic fallback:

```ts
registerXrPanelRenderer({ panelType: 'pad', create: context => ({ object, dispose }) });
```

Nothing in `src/xr/` imports a panel. A panel opts in by registering; anything unclaimed falls back
to `domSurfaceRenderer`, which mirrors the panel's live DOM onto an interactive quad using three's
`HTMLMesh`. External sandbox panels use `externalSurfaceRenderer` instead: the sandbox paints its own DOM
onto a flat texture and receives controller input over its existing private MessagePort. Adding a
native XR renderer for a panel therefore requires no change to the XR core.

The 2D workspace layout is preserved during this. The XR layer reads `WorkspacePanel[]` — already
a presentation-agnostic model — and locates DOM through the `data-workspace-card-id` attribute the
workspace already puts on every tile.

The 2D panels stay mounted during a session, because the mirror needs them to. Their 3D viewers are
suspended instead, through `src/xr/xrPresentationBus.ts`.

Time Series also has a native renderer. Its live plot reuses the desktop plot drawing code and
the mounted tile's engine, including replay timestamps, filters and expressions. XR offers topic
selection, signal visibility, detected fields, smoothing, plot settings, pause and zoom through the
same spatial chrome as 3D. Settings update the desktop tile immediately; acquisition stays on its
existing subscriptions and desktop canvas drawing pauses while XR presents the panel. Text editing
(labels, custom paths and expressions) and CSV export remain available on desktop.

TF tree is native as well, with a live frame graph, static/stale coloring, Fit and zoom, a paged
frame browser, transform details, diagnostics and source-to-target calculations. It shares the
mounted desktop tile's TF data, filters and replay source. The desktop graph pauses while XR is
presenting it and catches up on exit. Text filtering remains a desktop control; XR can clear it.

### Interaction

`src/xr/XrInputManager.ts` reduces controllers and tracked hands to one stream of rays. The part
worth understanding is the mode machine, which exists so that workspace manipulation can never be
mistaken for a robot command:

| Mode | Entered by | Robot commands |
| --- | --- | --- |
| `navigate` | resting state | inert |
| `manipulate` | grip / squeeze | inert |
| `control` | trigger over a control surface | live |

Grip outranks trigger. A control fires only when select *ends* on the object it *began* on, having
travelled less than 5 cm. External hold controls also receive balanced pointer-down and pointer-up/cancel
events. A ray excursion, grip from either hand, tracking loss, panel disposal or session end cancels
a hold. Sandbox input leases expire after 400 ms without updates; moving a panel cannot start a hold.

Controller models are drawn as a ray and a cursor rather than loaded through
`XRControllerModelFactory`, which fetches profile assets from a CDN at runtime. A control room that
only works with internet access would be the wrong trade for a robot interface.

### Persistence

XR placements live under `robo-boy-xr-workspace-v1`, routed through `connectionStorage` like every
other workspace key, so an XR room belongs to one robot. It is a **separate key from the 2D layout
and cannot corrupt it** — the two describe the same panels in incompatible terms. Parsing follows the
same defensive contract as `normalizeWorkspaceLayout`: version discriminant, per-field guards, silent
repair. A placement with a broken rotation is dropped rather than half-applied, because a panel at a
plausible-but-wrong pose is worse than one at a default pose.

Placements are captured on release, not per frame.

## Running and testing

### Desktop, with the WebXR emulator

The practical way to develop this without a headset.

1. Install the [WebXR API Emulator](https://chromewebstore.google.com/detail/webxr-api-emulator/mjddjgeghkdijejnciaefnkjmkafnnje)
   in Chrome.
2. Start Robo-Boy and the ROS stack as usual:

```bash
npm run dev
```

3. Open the WebXR tab in DevTools and select a device. Choose a *Quest*-class device to exercise VR
   and a *Samsung Galaxy*-class one to exercise AR — they report different modes, which is what you
   want to test.
4. The entry control appears once connected. Enter, and drive the emulated controllers from the
   DevTools panel.

Worth checking in both modes, because they differ:

- VR shows a floor grid and a background; **AR must show neither**, or it paints over passthrough.
- With the emulator reporting only one mode, the VR/AR toggle should not appear at all.

### On a headset

WebXR needs HTTPS, which the Compose stack already provides through Caddy and mkcert:

```bash
docker compose up -d --build
```

Then open the deployment's HTTPS address in Quest Browser or Wolvic, connect to the robot, and enter.

Check: controller rays highlight what they hit; grip moves a panel and the robot; two hands scale
the robot; a trigger press on a mirrored panel reaches the real control; leaving the session returns
to an intact 2D workspace with its layout unchanged.

### Automated

```bash
npm run test:run -- src/xr
```

Covers the spatial UI primitives (hit-testing, paging, wrist gesture hysteresis, panel sizing), the
3D panel's lifecycle and settings editor, the display host's layer reconciliation, view fitting,
session lifecycle (`setAnimationLoop` starts once and stops on end, teardown is idempotent,
a session that cannot bind is ended rather than left blank), per-mode feature descriptors and
reference-space fallback, the VR/AR probe, placement normalization and round-trip, the renderer
registry's fallback behaviour, and the grab maths including two-hand scale.

The perf contract is unchanged and still checked the same way:

```bash
ROBOBOY_PROFILE=1 npm run profile:frontend
```

An idle 3D panel must still show zero animation-frame callbacks and zero WebGL draws when no session
is running.

## Limitations

These are real and currently unsolved. None is hidden behind a silent failure.

- **Video and nested frames still need native renderers.** Ordinary external panel DOM now has an
  immersive fallback, including Microduck. Camera/video and nested iframe content display an explicit
  limitation. Arbitrary WebGL content is not guaranteed to be capturable.
- **External fallback is a low-rate 2D surface.** Capture runs at most twice a second; controller input
  runs independently. Pointer buttons, holds and scrolling work, but text entry, native select menus,
  file/permission dialogs and arbitrary drag controls do not have full XR parity. Some CSS effects
  (including shadows) are omitted. It is a backup for panels such as Microduck, not a full browser.
- **Mirrored canvas content updates only on DOM mutation.** Native Time Series plots update directly.
  The mirror re-rasterises on a `MutationObserver`,
  not per frame — deliberately, since rebuilding panel textures every frame would not hold a
  headset's refresh rate. A canvas whose pixels change without a DOM mutation appears frozen.
- **`dom-overlay` is AR-only** and optional even there, so it can never be the general fallback. In
  `immersive-vr` the 2D UI structurally cannot be shown as DOM at all.
- **No depth occlusion in AR.** Without `depth-sensing`, virtual geometry draws over real objects
  regardless of physical distance.
- **Additive blend displays black as transparent** (HoloLens-class hardware), so dark affordances
  disappear. This phase targets `alpha-blend` passthrough.
- **No WebXR in Tauri webviews**, so the desktop and mobile apps never show the entry point.
- **Each XR 3D panel builds its own URDF scene graph**, as each 2D 3D panel already does. Several
  views of a large robot cost proportionally more memory.
- **XR settings reach 2D panels only on remount.** The 2D 3D panel reads its saved state once, at
  mount, so a layer added in XR shows up in 2D the next time that panel mounts.
- **Hand tracking is requested but not yet modelled.** A tracked hand currently reports through the
  controller slot and produces a ray; there is no pinch-specific affordance yet.

## Adding a native XR renderer for a panel

Register one at module load. The XR core needs no change.

```ts
import { registerXrPanelRenderer } from '../xr/panels/registry';

registerXrPanelRenderer({
  panelType: 'pad',
  create: context => {
    const object = new THREE.Group();
    object.userData = { xrGrabbable: true, placementId: context.panelId, allowScale: true };
    // build controls from context.panelType/context.ros …
    return {
      object,
      onActivate: target => { /* publish via executeRosOperation */ },
      dispose: () => { /* remove listeners, geometries, ROS clients */ },
    };
  },
});
```

`dispose` is mandatory and must release everything the instance created — the same discipline the
external panel SDK requires of `unmount`.

## Roadmap

This branch delivers detection, both session modes, the scene and input managers, mirrored DOM panels
with persisted placement, and a native 3D panel with a wrist menu for adding and removing panels.

Next, roughly in order: native XR versions of the other panels on the same frame and menu; pinning
and viewer-attached placement; a native XR control pad rendering the existing grid-cell `CustomGamepadLayout` schema as a
spatial desk; hand-tracking affordances; an SDK extension letting external panels ship their own XR
renderer; AR `hit-test` placement of the robot on a real surface; and control-room presets.


### External panel fallback

The existing SDK, ROS broker and sandbox permissions remain unchanged. `ExternalPanelHost` registers a
connection-scoped `ExternalPanelSurface`; while presented it keeps the panel active and gives its
iframe a 720 × 500 CSS viewport. On exit the desktop dimensions and activity rules are restored.
`createSandboxSurface` captures inside the opaque-origin document and transfers one bounded
ImageBitmap plus control rectangles. Host validation rejects malformed frames; request IDs reject
late/unsolicited frames, and every discarded bitmap is closed. XR reuses `PanelFrame`, including
resize, grip movement, close and scroll buttons.

`html2canvas` is pinned to 1.4.1. Its public cloning API cannot operate inside an opaque-origin iframe,
so `capturePanelSurface` uses its internal parser and canvas renderer in the existing document.
Temporary style changes are restored synchronously before yielding. Keep the sandbox browser test
passing before updating this dependency; do not add `allow-same-origin` to work around capture.

The self-contained `e2e/xr-sandbox-surface.spec.ts` covers capture, scroll, sandbox flags and desktop
restoration. `e2e/xr-external-panel.spec.ts` uses the actual unmodified Microduck artifact, mocked ROS,
and emulated controllers in VR and AR. Set `MICRODUCK_PANEL_DIR` to its built repository (defaults to
the sibling `robo-boy-microduck-control-panel`); that integration test skips if it is unavailable.
