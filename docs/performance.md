# Performance Evaluation

Use this guide to reproduce frontend performance checks and review changes that affect panel,
rendering, or ROS-resource lifecycles. The automated profile lives in
`e2e/performance-profile.spec.ts` and is skipped during ordinary end-to-end runs.

## Run The Profile

From the repository root:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
ROBOBOY_PROFILE_SAMPLE_MS=3000 \
npm run profile:frontend
```

Omit `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when the Playwright Chromium installation works on the
host. If a development server is already running on port 5173, add
`PLAYWRIGHT_SKIP_WEB_SERVER=1`; otherwise Playwright starts and stops one automatically.

The suite uses a deterministic rosbridge mock and records:

- Chrome renderer task and script time;
- animation-frame requests and callbacks;
- WebGL draw calls;
- intervals, DOM nodes, canvases, and collected JavaScript heap;
- active and cumulative ROS subscription counts.

Renderer-main-thread percentages are not whole-machine CPU percentages. A rendered frame can also
contain several WebGL draw calls.

## Regression Expectations

Changes to the 3D panel must preserve these properties:

- An idle 3D scene has no pending animation frame and issues no WebGL draws.
- Scene, camera, ROS visualization, URDF pose/resource, and resize changes request a coalesced frame.
- All 3D panels and TF tree panels on one live `ROSLIB.Ros` identity share one `/tf` and one
  `/tf_static` subscription; removing the final consumer releases both. A second rosbridge client
  on `/tf_static` would receive only part of the latched static set, so the TF tree's refresh
  resets this shared stream instead of subscribing on its own.
- A panel or visualizer mounted after TF arrives starts from the current TF snapshot.
- Reconnects using a new ROS object do not inherit dynamic TF or URDF data from the old connection.
- Panel teardown releases topics, TF callbacks, timers, observers, scene resources, canvases, and
  the WebGL context.
- Repeated panel creation/removal returns to the original DOM and canvas count without accumulating
  callbacks or large immediate heap growth.

The relevant owners are:

- `src/utils/tfStream.ts`: shared TF topics and snapshots;
- `src/hooks/useTfProvider.ts`: panel-local provider and viewer synchronization;
- `src/utils/tfUtils.ts`: TF lookup and changed-path propagation;
- `src/utils/ros3d.ts`: viewer invalidation, URDF models, loaders, and rendering resources.

Each panel intentionally owns an independent URDF scene graph. This prevents stale poses and
Three.js reparenting between panels, but several panels displaying the same large robot consume
proportionally more model and GPU memory. The description string is shared for the lifetime of the
ROS connection.

## Reference Results

The following one-second Chrome samples were recorded on 2026-09-15. Treat them as behavioral
reference points, not portable performance budgets.

| Scenario | Renderer main thread | RAF callbacks/s | WebGL draws/s |
| --- | ---: | ---: | ---: |
| One empty 3D panel | 0.04% | 0 | 0 |
| Two empty 3D panels | 0.05% | 0 | 0 |
| 40 Hz TF, no displayed axes | 0.42% | 0 | 0 |
| Displayed moving TF at 40 Hz | 4.34% | 4.99 | 14.97 |
| Moving primitive URDF at 40 Hz | 18.09% | 38.93 | 77.86 |
| URDF after TF stops | 0.04% | 0 | 0 |

Two simultaneous panels used one active TF topic pair, and removing the final panel returned both
active subscription counts to zero. Five warm mount/remove cycles returned to zero canvases and
pending frames with a collected heap increase of 0.72 MiB.

## Measurement Limits

- Synthetic ROS traffic excludes rosbridge, DDS, robot-computer, and network costs.
- WebGL calls and canvas pixels are GPU-work proxies; the suite does not read GPU power or memory.
- Camera checks do not represent real stream transfer, decoding, or composition.
- Tauri runs the same React and Three.js code, but its platform webview is not measured by Chrome's
  profiling API.
- Short lifecycle tests do not replace a real-robot soak with large meshes, point clouds, reconnects,
  and lossy networking.
