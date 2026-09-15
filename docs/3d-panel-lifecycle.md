# 3D Panel Lifecycle Investigation

This document records the 3D panel lifecycle as it existed on `dev` at commit `46b7c4b`, the
failure modes found during the September 2026 investigation, and the implementation plan recorded
before runtime changes were made.

## Current Lifecycle

### Creation and switching

- `App` keeps one `MainControlView` mounted for every open ROS connection. An inactive connection
  keeps its `useRos` owner but returns no panel subtree, so its 3D panels unmount.
- The standard 3D view is conditionally mounted when `viewMode === '3d'` and unmounted when the user
  switches to camera, TF tree, or behavior tree.
- Desktop workspace 3D tiles remain mounted while their tile exists. More than one tile can use the
  same ROS connection concurrently.
- Mobile camera and 3D panels mount only while visible. Switching or replacing a mobile panel
  unmounts the heavy panel while preserving its serializable settings.
- Removing a workspace tile or closing its connection unmounts `VisualizationPanel` and all of its
  visualizer adapters.

### Mount and initialization

1. `VisualizationPanel` restores its fixed frame, selected visualizers, and display settings from
   local storage.
2. `useRos3dViewer` installs a `ResizeObserver`. It creates the viewer only after the panel has a
   non-zero size, then adds the grid and orbit controls and increments `viewerGeneration`.
3. `useTfProvider` currently waits for both the ROS connection and the viewer. It then creates a
   panel-local `CustomTFProvider` and two panel-local ROS subscriptions, `/tf` and `/tf_static`.
4. `VisualizationPanel` stores the complete TF tree in React state. Every accepted TF batch copies
   that store, updates the provider, updates the frame list, and can rerender the panel.
5. Restored visualizer adapters mount only after the viewer and provider report ready. `UrdfViz`
   creates an `UrdfClient`, which either reuses the cached Three.js model or obtains the latched
   robot description and constructs a model.
6. `UrdfClient` subscribes every link to direct and inferred namespaced TF frame candidates. The
   provider immediately calls each new subscriber with any transform it already has.

This ordering prevents visualizers from binding to a missing viewer, but it also delays all TF
ingestion until layout has produced a usable canvas. A panel that spends time at `0x0` has no TF
subscription during that interval.

### Updates and rendering

- `/tf` is throttled to 40 Hz with a queue length of one; `/tf_static` is unthrottled and also uses
  a queue length of one.
- `CustomTFProvider` compares the old and new store and calls subscribers whose transform path is
  believed to have changed.
- TF axes are updated from React TF state. Point clouds, LaserScan, CameraInfo, and PoseStamped
  request frames after their visible data or pose changes.
- `Viewer` is invalidation-driven: `requestRender()` coalesces changes into one animation frame and
  no longer redraws continuously.
- URDF completion requests one frame through `useUrdfClient`, but URDF link TF callbacks and
  asynchronous mesh-loader callbacks do not request frames.

### Reconnection and teardown

- `useRos` closes a failed ROS instance and rejects connection events from stale instances. The UI
  offers a manual reconnect; returning from page suspension or an `online` event also recreates the
  connection.
- A disconnect removes `VisualizationPanel` from the rendered subtree. Reconnect creates a new
  `ROSLIB.Ros` instance and remounts the panel from persisted configuration.
- Viewer teardown detaches the resize observer, cancels its pending resize/render frame, disposes
  orbit controls, removes the canvas, walks remaining scene resources, and disposes the renderer.
- Point-cloud, LaserScan, CameraInfo, PoseStamped, TF-axis, and URDF owners have cleanup paths for
  their topics and most local rendering resources.
- `useTfProvider` unsubscribes its ROS topics, but its provider effect has no unmount cleanup. The
  provider is disposed when prerequisites are lost during a render, not when the panel unmounts
  directly.
- `UrdfClient` removes itself and its TF callbacks, but intentionally preserves its model resources
  because the cache owns the same mutable model.

## Findings and Root Cause

### Primary cause: URDF changes do not invalidate the demand-driven viewer

The renderer changed from a permanent animation loop to demand-driven rendering in commit
`2d34e6e`. URDF TF callbacks still update link positions and quaternions without calling
`requestRender()`. The in-memory scene is current, but the canvas remains on the frame drawn at
URDF completion until resize, camera input, another visualizer, or another unrelated invalidation
causes a draw. This makes motion appear intermittent and explains why the model can load correctly
but remain frozen.

Asynchronous DAE, OBJ, STL, MTL, and texture completion has the same missing invalidation. A render
requested when the XML structure completes can happen before mesh resources are attached.

### TF change detection can suppress live transforms

For trees over 100 stored frames, `CustomTFProvider.updateTransforms()` samples only the first five
frame keys. If the frame count is unchanged and motion occurs outside that sample, no subscriber is
called. This is a correctness-breaking heuristic: a large robot or multi-robot graph can leave the
URDF frozen indefinitely even when TF batches continue arriving.

### Cached URDF models have shared mutable ownership

The cache stores the constructed `Object3D` and link map by ROS URL and topic. Opening a second 3D
panel reuses that exact model instance. A Three.js object can have only one parent, so adding it to
the new panel transfers it out of the previous scene. The cache also retains its last transformed
pose and survives a reconnect to the same URL. Cleanup cannot dispose these resources without
breaking a future cache user, which makes ownership and lifetime ambiguous.

### Subscription and cleanup risks

- Every concurrent 3D panel creates another `/tf` and `/tf_static` subscription and repeats the
  same decoding and store merge work.
- URDF links keep subscriptions to every candidate frame even after one candidate wins. Missing
  candidate frames can therefore cause repeated null lookups and callbacks.
- The provider itself is not explicitly disposed on direct unmount.
- Point-cloud setup uses an uncancelled delayed callback, and several visualization hooks recreate
  clients when fresh option-object identities appear. These are secondary lifecycle/performance
  concerns rather than the reported URDF freeze.

## Proposed Solution and Invariants

1. Introduce one reference-counted TF stream per live `ROSLIB.Ros` object. It owns exactly one
   `/tf` and one `/tf_static` topic while at least one 3D panel consumes it, keeps the latest
   immutable snapshot, and fans updates out to panel-local providers. The last panel unsubscribes
   both topics. A new ROS object always gets a fresh source, so reconnects cannot inherit another
   connection's dynamic state.
2. Create the panel-local TF provider as soon as ROS is connected, independently of viewer size.
   A delayed viewer then starts from the source's current snapshot instead of losing TF received
   while layout settles. Visualizers still wait for both provider and viewer readiness.
3. Replace sampled TF detection with exact changed-frame propagation. Work remains bounded to
   changed frames and subscribed paths; tree size must never change correctness.
4. Give every `UrdfClient` its own scene graph. Cache only the robot-description string within the
   identity of the live ROS object, never mutable transforms or Three.js parents.
5. Pass the viewer's coalescing `requestRender()` callback into `UrdfClient`. Request a frame only
   after an actual link pose/parent change or an asynchronous visual resource is attached. Many
   link updates in one TF batch still produce one WebGL frame.
6. Make teardown instance-specific and idempotent: unsubscribe local topic callbacks, release TF
   listeners, cancel timers/animation frames, detach scene nodes, dispose owned GPU resources, and
   ignore late loader or connection callbacks.
7. Keep reconnection at the existing `useRos` boundary. The 3D lifecycle must fully tear down on
   disconnect and rebuild from persisted serializable settings against the new ROS identity.

The required invariants are:

- One live TF topic pair per ROS connection regardless of the number of concurrent 3D panels.
- No TF source topics after its final 3D consumer is removed.
- No provider, visualizer callback, animation loop, timer, observer, or renderer owned by an
  unmounted panel remains active.
- A viewer may be created after TF data arrives and still initializes visualizers from the latest
  snapshot.
- Every accepted URDF pose or resource change invalidates exactly the necessary viewer frame.
- Two panels may display the same robot description without sharing mutable Three.js objects.
- A reconnect never reuses TF or URDF data owned by the previous `ROSLIB.Ros` instance.

## Verification Plan

- Unit-test delayed viewer creation, provider teardown, shared subscription reference counting,
  reconnect isolation, large-tree updates, immediate snapshot delivery, URDF render invalidation,
  independent cached models, alternative-frame cleanup, and late loader safety.
- Run the focused 3D/TF/URDF hook and utility suites, then the full unit suite, TypeScript build,
  and lint.
- Re-run the existing gated performance profile for empty, multi-panel, active TF, URDF motion,
  switching, and repeated add/remove scenarios. Confirm that idle WebGL work remains zero and that
  active motion draws only coalesced invalidated frames.

## Implemented And Verified Outcome

The implementation follows the invariants above:

- `tfStream` owns one reference-counted topic pair per live ROS identity and synchronously replays
  its snapshot to each joining panel-local provider.
- `CustomTFProvider` uses exact changed-path propagation for trees of every size and has idempotent
  disposal that rejects late work.
- `UrdfClient` caches only description strings per ROS identity. Each panel owns its own scene graph,
  TF callbacks invalidate the viewer, alternative frame listeners are released after a winner is
  found, and teardown disposes subscriptions and GPU resources.
- CameraInfo is provider-driven, PoseStamped reuses geometry, point-cloud delayed initialization is
  cancelable, and viewer teardown disconnects its observer and explicitly releases the WebGL
  context.

The complete unit suite, lint, production build, and the 12-scenario Chrome profile pass. The
profile specifically verifies late URDF mount after TF arrival, live URDF motion and idle settling,
one shared topic pair across two panels, zero topics after the last panel closes, connection-session
switching, and repeated mount/unmount cleanup. Detailed measurements are recorded in
[`performance.md`](performance.md#3d-lifecycle-follow-up).
