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
- All 3D panels and TF tree panels on one live `ROSLIB.Ros` identity share one dynamic TF
  subscription and one `/tf_static` subscription; removing the final consumer releases both. The
  dynamic topic is the ROS stack's coalesced `/roboboy/tf` when the robot has it, else `/tf`; see
  [rosbridge load](#rosbridge-load). A second rosbridge client
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

## rosbridge Load

rosbridge is one Python process. Every outgoing message is serialized on a single core, and each
client has a bounded write queue (`write_queue_size`, default 1000). When a client drains slower
than messages arrive, rosbridge logs `Write queue full, dropping outgoing message` and discards new
messages of any kind, service responses included.

The discarded service responses are why the behavior-tree palette could hang on a busy cell. The
panel discovered call by call, one rosapi request per service, and a dropped reply was never
retried.

The typical cause is a kHz `/tf`. On a production two-arm cell (measured 2026-09-30):
- **`/tf`:** about 1500 Hz from four publishers.
- **Graph size:** about 330 topics, 540 services and 10 actions.
- **rosbridge CPU:** close to a full core with one browser connected.
- **Link from a remote workstation:** 6–16 Mbit/s over the VPN, 60 ms RTT.

Forwarded one message per TF message, `/tf` alone needs about 8 Mbit/s.

The ROS stack now handles this in three ways:

| Change | Where | Default |
| --- | --- | --- |
| Coalesces `/tf` into `/roboboy/tf`: the newest transform per child frame, at a fixed rate, only frames that changed. It follows `/tf` only while someone reads the relay. | `infra/ros/tf_relay.py`; `src/utils/tfStream.ts` picks it up. | `ROBOBOY_TF_RELAY_HZ=60` |
| Runs rosbridge on rclpy's C++ events executor. | `infra/ros/rosbridge_launch.xml` | `ROSBRIDGE_USE_EVENTS_EXECUTOR=true` |
| Enables permessage-deflate for clients that offer it. All browsers do; Caddy passes it through. | `infra/ros/rosbridge_launch.xml` | `ROSBRIDGE_USE_COMPRESSION=true` |

Behavior-tree and assistant discovery also read one graph snapshot from the inspector. Without an
inspector they discover call by call, with a 10 s timeout on every call.

### Results

Measured with `scripts/rosbridge-bench` against a synthetic graph shaped like that cell. The
client subscribes to TF like the app, runs discovery, sends 10 action goals, and probes rosapi
every 250 ms.

| Configuration | Link | rosbridge CPU | Downstream | TF age p50 | Lost probe calls | Discovery |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Previous defaults | local | 46% | 8.0 Mbit/s | 1 ms | 0/159 | 1.8 s |
| Previous defaults | 16 Mbit/s, 60 ms | 44% | 8.0 Mbit/s | 31 ms | 0/159 | 15.6 s |
| Previous defaults | 6 Mbit/s, 60 ms | 42% | 5.1 Mbit/s | 7.8 s | 56/160 | did not finish |
| Previous defaults | 3 Mbit/s, 60 ms | 51% | 2.7 Mbit/s | 10.5 s | 101/160 | did not finish |
| Events executor only | local | 27% | 8.0 Mbit/s | 1 ms | 0/159 | 1.8 s |
| All changes | local | 6% | 0.24 Mbit/s | 4 ms | 0/159 | 0.30 s |
| All changes | 6 Mbit/s, 60 ms | 6% | 0.24 Mbit/s | 34 ms | 0/159 | 0.29 s |
| All changes | 3 Mbit/s, 60 ms | 6% | 0.24 Mbit/s | 35 ms | 0/159 | 0.31 s |

- **Previous defaults on a slow link:** TF on screen falls seconds behind, and the write queue
  starts dropping. With 3 Mbit/s, rosbridge dropped messages in 30 of 40 seconds.
- **Relay cost:** the relay adds 12–13% of one core while a browser reads it. That runs in its
  own process, off rosbridge's path.
- **Relay alone:** with the events executor, it cuts TF traffic from 8.0 to 1.55 Mbit/s and
  rosbridge from 27% to 7%.
- **Compression:** takes 1.55 Mbit/s to 0.24 Mbit/s for about 1% CPU.
- **Relay at 30 Hz:** 0.12 Mbit/s.
- **Three browsers:** 23.8 Mbit/s and 52% CPU before; 0.71 Mbit/s and 9% after.
- **Robot computer capped at half a core:** the previous configuration no longer keeps up with
  `/tf` (1376 of 1500 Hz delivered), and discovery takes 5.6 s. The new one is unchanged.
- **Action goals:** 10/10 succeeded in every configuration that was still connected.

Compression costs more on large binary messages. A 50,000-point cloud at 10 Hz, subscribed as
the 3D panel subscribes, measured:

| | rosbridge CPU | Probe p99 | TF age p99 |
| --- | ---: | ---: | ---: |
| Compression off | 6% | 87 ms | 8 ms |
| Compression on | 22% | 107 ms | 44 ms |

Deflate saves only about 12% of the traffic on such messages. Over 16 Mbit/s neither setting
helps much: the cloud alone fills the link. A LAN-only deployment that streams large point
clouds can set `ROSBRIDGE_USE_COMPRESSION=false`. Remote users need a lower rate or resolution
for such topics.

Write-queue drops are per client and cover every topic and service of that client. One heavy
subscription can therefore still starve that browser's service responses.

## Measurement Limits

- Synthetic ROS traffic excludes rosbridge, DDS, robot-computer, and network costs.
- WebGL calls and canvas pixels are GPU-work proxies; the suite does not read GPU power or memory.
- Camera checks do not represent real stream transfer, decoding, or composition.
- Tauri runs the same React and Three.js code, but its platform webview is not measured by Chrome's
  profiling API.
- Short lifecycle tests do not replace a real-robot soak with large meshes, point clouds, reconnects,
  and lossy networking.
