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

ROS is Z-up and a WebXR reference space is Y-up. `RobotWorld` rotates one group by -90° about X
rather than converting every transform, which keeps the ROS3D classes untouched.

### Panels

`src/xr/panels/registry.ts` maps a panel type to a spatial renderer, with a generic fallback:

```ts
registerXrPanelRenderer({ panelType: 'pad', create: context => ({ object, dispose }) });
```

Nothing in `src/xr/` imports a panel. A panel opts in by registering; anything unclaimed falls back
to `domSurfaceRenderer`, which mirrors the panel's live DOM onto an interactive quad using three's
`HTMLMesh`. Adding a native XR renderer for a panel therefore requires no change to the XR core.

The 2D workspace is **not** modified to support this. The XR layer reads `WorkspacePanel[]` — already
a presentation-agnostic model — and locates DOM through the `data-workspace-card-id` attribute the
workspace already puts on every tile.

The 2D panels stay mounted during a session, because the mirror needs them to. Their 3D viewers are
suspended instead, through `src/xr/xrPresentationBus.ts`.

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
travelled less than 5 cm — so dragging a panel across a joystick cannot drive the robot.

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

Covers session lifecycle (`setAnimationLoop` starts once and stops on end, teardown is idempotent,
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

- **Video and iframes cannot be mirrored.** Three's rasteriser draws text, boxes, images, canvases
  and form controls, but has no `<video>` or `<iframe>` path. The Camera panel and external panels
  therefore show a labelled placeholder rather than a black quad. They need native XR renderers.
- **Canvas content updates only on DOM mutation.** The mirror re-rasterises on a `MutationObserver`,
  not per frame — deliberately, since rebuilding panel textures every frame would not hold a
  headset's refresh rate. A canvas whose pixels change without a DOM mutation appears frozen.
- **`dom-overlay` is AR-only** and optional even there, so it can never be the general fallback. In
  `immersive-vr` the 2D UI structurally cannot be shown as DOM at all.
- **No depth occlusion in AR.** Without `depth-sensing`, virtual geometry draws over real objects
  regardless of physical distance.
- **Additive blend displays black as transparent** (HoloLens-class hardware), so dark affordances
  disappear. This phase targets `alpha-blend` passthrough.
- **No WebXR in Tauri webviews**, so the desktop and mobile apps never show the entry point.
- **The XR world builds its own URDF scene graph**, as each 3D panel already does. Several views of a
  large robot cost proportionally more memory.
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

Phase 1, in this branch, is the vertical slice: detection, both session modes, the scene and input
managers, one grabbable mirrored panel, the robot as true 3D geometry, and clean teardown.

Next, roughly in order: multiple panels with full placement persistence; pinning and viewer-attached
placement; a native XR control pad rendering the existing grid-cell `CustomGamepadLayout` schema as a
spatial desk; hand-tracking affordances; an SDK extension letting external panels ship their own XR
renderer; AR `hit-test` placement of the robot on a real surface; and control-room presets.
