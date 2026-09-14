# Frontend Performance Analysis

This document records the September 2026 frontend and Tauri performance investigation. It is a
baseline for future profiling, not a promise that the same absolute numbers will appear on every
machine.

## Outcome

The main idle bottleneck was the 3D viewer. Every mounted viewer rendered its complete Three.js
scene on every display frame, even when the grid, camera, and ROS data were unchanged. A single
empty 3D panel used about 22% of Chrome's renderer main-thread time and rendered at 60 frames per
second. Two panels issued twice as many WebGL draw calls. This continuous CPU and GPU wake-up is a
credible explanation for a faster fan without visible UI slowdown.

The viewer is now invalidation-driven. Scene changes, ROS visualization messages, material changes,
resizes, and camera interaction request a frame; requests in the same display interval are
coalesced. An idle scene does no animation-frame or WebGL work. TF axes use the same model instead
of polling and redrawing a stationary transform at 30 frames per second.

No connection, UX, data-rate, or visualization feature was removed. Active orbit, TF, and
PoseStamped scenarios confirm that frames are produced while the scene is changing and stop after
it settles.

## Method

Measurements were collected on Linux 7.0.0 with Google Chrome 151, Node 22, and a 1280 by 720 test
viewport. `e2e/performance-profile.spec.ts` installs a deterministic rosbridge mock and instruments:

- Chrome DevTools Protocol `TaskDuration`, `ScriptDuration`, layout, style, and JS heap metrics.
- `requestAnimationFrame` requests and callbacks.
- WebGL `drawArrays` and `drawElements` calls.
- Intervals, DOM nodes, canvas backing pixels, images, videos, and running CSS animations.

Each steady-state sample below lasted three seconds after a garbage collection and a 500 ms
settling delay. Renderer-main-thread percentages are the fraction of elapsed time reported as
Chrome renderer tasks; they are not whole-machine CPU percentages. A WebGL draw call is also not a
frame: a scene with several drawable objects issues several calls per rendered frame.

Run the repeatable profile explicitly; it is skipped during ordinary end-to-end runs:

```bash
VITE_PWA_DEV=false npm run dev -- --host 127.0.0.1

PLAYWRIGHT_SKIP_WEB_SERVER=1 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
ROBOBOY_PROFILE_SAMPLE_MS=3000 \
npm run profile:frontend
```

Playwright's downloaded Chromium does not run on the profiling host, so the executable override is
required there.

### Limits

- The ROS source is synthetic. It isolates frontend work but does not include rosbridge, DDS,
  network, serialization, or robot-computer load.
- Camera idle used a one-pixel static image. It measures panel overhead, not MJPEG/H.264 transfer,
  decode, scaling, or composition. Real camera cost depends on resolution, frame rate, codec, and
  the web engine's hardware-decode path.
- GPU utilization and power counters were unavailable because the host's NVIDIA management tool
  could not communicate with a driver. WebGL call frequency and canvas pixels are used as GPU-work
  proxies.
- JS heap is not browser-process RSS or GPU memory. The Tauri sample below reports process RSS
  separately.
- Short lifecycle checks can catch retained canvases, callbacks, DOM, and large immediate leaks;
  they do not replace a multi-hour production soak with real ROS payloads.

## Architecture And Lifecycle

| Area | Owner and lifecycle | Performance behavior |
| --- | --- | --- |
| Connections | `App` retains one `MainControlView` owner per connection; `useRos` owns its `ROSLIB.Ros` object. An inactive session returns no panel subtree while preserving connection ownership. | An empty connected workspace was effectively quiescent. Connection lifetime and retry behavior were not changed. |
| Workspace panels | `MainControlView` owns the split tree and panel instances. Desktop tiles mount only when present. On mobile, heavy camera and 3D panels are unmounted when hidden; TF and behavior-tree panels receive activity state and pause work where required. | Removing a panel tears down subscriptions, observers, controls, renderer resources, and canvases. Five warm mount/remove cycles returned to zero canvases, zero pending frames, and the original DOM count. |
| 3D viewer | `VisualizationPanel` owns configuration and React adapters. Live imports of `../utils/ros3d` resolve to the monolithic `src/utils/ros3d.ts`; it owns `Viewer`, `PointCloud2`, `OrbitControls`, and URDF. The modular `LaserScan` is re-exported from that entry point. | Rendering is invalidation-driven. The viewer waits for its first non-zero layout size, coalesces requests, and visualizers request frames only after data, pose, visibility, settings, resize, or camera changes. |
| TF | `useTfProvider` owns one bounded `/tf` and `/tf_static` subscription per 3D panel. Dynamic TF is capped at 40 Hz with queue length 1 and CBOR. `useTfVisualizer` owns axes and edge objects. | No displayed frames means no TF rendering. Displayed axes update when transform state changes, not through a permanent polling loop. |
| Point clouds and LaserScan | Visualization hooks/classes own topic clients, bounded queues, typed buffers, TF pose checks, and Three.js resources. | Incoming data invalidates a frame. TF polling can remain active while the visualization exists, but it requests rendering only after a pose or visibility change. Point-cloud data is capped near 30 Hz and stale messages are dropped. |
| Camera | `CameraView` gives the browser/webview an MJPEG URL through an `<img>`. CameraInfo is a 3D frustum and is separate from video decode. | A static camera panel has negligible JS cost. Video decode and composition are browser/webview workloads and are expected while a visible stream is active. Hidden mobile camera panels are unmounted. |
| UI animation | `EntrySection` owns the visible animated dash. Other transitions are CSS or bounded interaction callbacks. | The entry dash intentionally keeps one animation frame pending at about 60 callbacks/s. It costs about 2% renderer-main-thread time and was retained because it is visible, deliberate, and much smaller than the former 3D cost. |
| TF tree | `TfTreePanel` subscribes only while active and uses a one-second clock for relative timestamps. React Flow renders graph changes. | Idle cost is about 0.2%. Synthetic 40 Hz TF updates cost about 5%, including React/graph animation work; no WebGL is involved. |
| Other timers/listeners | Point-cloud setup/range intervals are bounded and cleared; joystick hold and physical-gamepad polling exist only while those controls are active. Resize, pointer, key, and connection listeners have matching cleanup. | The connected baseline had no recurring instrumented callback activity apart from one library/runtime interval. No duplicate TF subscriptions or growing callback count was observed in the exercised lifecycles. |

## Measurements

### Idle and high-frequency baselines

| Scenario | Renderer main thread before | After | RAF callbacks/s before | After | WebGL draws/s before | After | JS heap after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Entry screen idle | 2.07% | 1.09% | 60.33 | 60.31 | 0 | 0 | 3.60 MiB |
| Connected empty workspace | 0.02% | 0.01% | 0 | 0 | 0 | 0 | 12.73 MiB |
| One empty 3D panel | 21.90% | 0.02% | about 120 | 0 | about 60 | 0 | 13.92 MiB |
| Two empty 3D panels | 25.21% | 0.02% | 239.90 | 0 | 119.95 | 0 | 14.20 MiB |
| Empty 3D panel, TF at 40 Hz, no displayed frames | 24.19% | 1.18% | 120.58 | 0 | 60.29 | 0 | 14.58 MiB |
| TF tree idle | 0.20% | 0.22% | 0 | 0 | 0 | 0 | 14.17 MiB |
| TF tree, TF at 40 Hz | 5.19% | 4.31% | 0 | 0 | 0 | 0 | 15.17 MiB |
| Camera panel, static image/no decode | 0.02% | 0.02% | 0 | 0 | 0 | 0 | 13.68 MiB |

The old single-viewer RAF count includes both the permanent viewer loop and related visualization
callbacks; its approximately 60 WebGL calls/s correspond to one unchanged grid render per display
frame. The two-viewer result shows the key scaling problem: independent panels doubled draw
frequency even though neither scene changed.

### Displayed TF follow-up

A selected but stationary `base_link` exposed a second continuous-render path after the main viewer
loop was removed.

| Scenario | Renderer main thread | RAF callbacks/s | WebGL draws/s |
| --- | ---: | ---: | ---: |
| Stationary displayed TF, before TF-loop change | 10.96% | 90.00 | 90.00 |
| Stationary displayed TF, after | 0.02% | 0 | 0 |
| Displayed TF moving at 40 Hz, after | 3.83% | 5.00 | 14.99 |
| Same TF after updates stop, after | 0.01% | 0 | 0 |

The moving fixture advances by one millimetre per message. Existing pose thresholds suppress
sub-threshold visual changes, so approximately five rendered frames/s is expected; each frame draws
the grid and axes in about three WebGL calls. The optimization did not reduce the frequency of
meaningful pose updates.

### Active rendering and settling

| Scenario | Renderer main thread | Script | RAF callbacks/s | WebGL draws/s | Result after settling |
| --- | ---: | ---: | ---: | ---: | --- |
| Continuous orbit input | 18.79% | 1.35% | 80.05 | 39.86 | 0 draws/s, 0.01% main thread |
| PoseStamped at 40 Hz | 19.22% | 2.33% | 39.98 | 119.93 | 0 draws/s, 0.01% main thread |

PoseStamped recreates an arrow containing several drawable meshes, so its draw-call count is higher
than its render frequency. That work is expected while new poses arrive. Rebuilding this geometry
could be investigated separately with real high-rate workloads, but it was not changed here because
the measured problem was idle work and the active scenario remained responsive.

LaserScan keeps a lightweight TF pose check alive while its visualization exists: before data and
after data stops it produced about 60 RAF callbacks/s but no WebGL draws, using 0.33–0.34% renderer
main-thread time and 0.06–0.09% script time. At 20 Hz with 360 ranges, it used 9.23% main-thread
time and about 39 WebGL draw calls/s, then returned to the low polling baseline. The polling was not
changed because its measured cost is small, it never wakes the GPU while stationary, and replacing
it would add lifecycle risk to TF recovery for little benefit.

### Lifecycle and memory

After warming the lazy 3D bundle, five add/remove cycles returned from 108 to 108 DOM elements, zero
canvases, zero animation callbacks, and zero WebGL draws. Collected JS heap moved from 13.73 MiB to
14.36 MiB (+0.63 MiB). This small bounded increase can include initialized module/engine caches; it
is not evidence of a retained renderer. A longer real-data soak is still appropriate for large
point-cloud and URDF deployments.

## Web Versus Tauri

Tauri packages the same React, ROSLIB, and Three.js code. The optimization therefore removes the
same JavaScript render loops in Chrome and in the native webview. Platform differences are at the
engine and endpoint boundaries:

- Linux uses the system WebKitGTK and its accelerated DMABUF renderer by default. Compatibility
  mode intentionally disables that path and can use more CPU.
- Windows uses WebView2 with GPU rasterization and zero-copy hints.
- Desktop 3D caps device pixel ratio at 1, disables antialiasing and shadows, and keeps WebGL's
  high-performance preference. The web version uses the browser DPR and requested antialiasing, so
  a high-DPI web canvas can allocate and shade more pixels.
- Tauri omits the PWA service worker and uses direct ROS/video/mesh endpoints. Its small native HTTP
  and window integrations do not create a second application renderer.

The Linux Tauri debug build was launched successfully in desktop mode with WebKitGTK 2.52.6. A
10-second entry-idle `pidstat` sample reported:

| Process | Average host CPU | RSS |
| --- | ---: | ---: |
| Tauri shell (`robo-boy`) | 1.20% | 195.3 MiB |
| WebKit content process | 1.40% | 243.7 MiB |
| WebKit network process | 0.00% | 59.5 MiB |
| Combined | 2.60% | 498.5 MiB |

This is an unoptimized debug process using a Vite development server, so it is an upper-bound
development baseline, not a packaged-release comparison. WebKit does not expose Chrome's CDP
metrics, and this environment could not automate active Tauri panels or read GPU counters. A fair
production comparison should repeat the same idle, orbit, camera, and ROS scenarios in a release
bundle with OS process and GPU tooling on the target hardware.

## Changes And Rationale

- Replaced the permanent `Viewer` render loop with a coalescing `requestRender()` boundary.
- Connected orbit controls, resize, scene additions/removals, fixed-frame changes, visualization
  messages, TF pose/visibility changes, settings, and asynchronous URDF completion to that boundary.
- Replaced displayed-TF RAF polling with updates driven by React's already-bounded transform state.
- Avoided starting any TF visualization work when no TF frames are displayed.
- Removed fresh-mount and environment-switch races by observing panel size before viewer creation,
  signaling each successful viewer generation, and mounting restored visualizers only after both
  the viewer and TF provider are ready.
- Consolidated point-cloud forced immediate/next-frame draws into one invalidation and routed
  cleanup/settings paths through the same owner.
- Added a gated, reproducible profile covering idle, active, high-frequency ROS, camera-static,
  multi-viewer, settling, and repeated panel lifecycle scenarios.

No optimization was made to connection management, the entry animation, TF-tree React rendering,
camera decode, or active visualization geometry because the measurements did not justify added
complexity or those costs are inherent to visible/current data. The remaining approximately 1.2%
main-thread cost for an empty 3D panel receiving 40 Hz TF is transform parsing, provider update, and
React state propagation; it performs no rendering and is retained to preserve frame discovery and
connection reliability.
