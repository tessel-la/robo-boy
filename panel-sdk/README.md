# Robo-Boy Panel SDK

`@tessel-la/roboboy-panel-sdk` is Robo-Boy's type-only public contract for external panels. It deliberately
contains no React, ROSLIB, or browser runtime code, so importing its types cannot add code to a panel bundle.

Panel packages should install the contract as a development dependency, use `import type` for its interfaces, and
export one default `RoboBoyPanelDefinition` from their ESM entry point:

```sh
npm install --save-dev \
  https://github.com/tessel-la/robo-boy/releases/download/panel-sdk-v2.2.0/tessel-la-roboboy-panel-sdk-2.2.0.tgz
```

The SDK is distributed as an npm-compatible tarball attached to the matching versioned GitHub release. It is not
published to the npm registry. Release assets are treated as append-only, and a panel's lockfile records the
tarball integrity so replacement bytes fail installation.

The complete authoring and deployment guide lives in the
[Robo-Boy repository](https://github.com/tessel-la/robo-boy/blob/main/docs/external-panels.md).

API `2.0.0` is the source contract in the Robo-Boy repository. Package `2.1.0` adds the `webrtcWhep` and
`webrtcDiscovery` host endpoints, so a panel that wants the stream gateway can ask for it by name instead of
inferring it from the video server. `videoStream` still reaches the gateway for panels written before those
existed, so nothing published against `2.0.0` needs changing. Package `2.2.0` adds the `webxr` capability,
which delegates `xr-spatial-tracking` and `fullscreen` to the panel frame so it can open an immersive
`navigator.xr` session; a panel that does not declare it is unaffected. Panel instances execute in an opaque-origin
sandbox and must implement both `mount` and `unmount`. ROS, network, storage, viewport, connection, and theme access
are host-owned services; raw Robo-Boy objects are not exposed to panel code. Direct HTTP calls are blocked by the
sandbox CSP, so network access must use the reviewed `context.network` allowlist.

Panels that let users choose arbitrary ROS inputs should declare `permissions.ros.selectTopic: true` and call
`context.ros.selectTopic()`. The complete topic graph is displayed only in trusted Robo-Boy UI. The sandbox receives
the one selected topic and message type, and the broker grants that exact subscription for the current tile session.

Robo-Boy installs its public theme tokens as CSS custom properties in the sandbox and updates them when the user
changes theme. Use variables such as `--background-color`, `--card-bg`, `--text-color`, `--border-color`,
`--primary-color`, and `--font-family-ui`; `context.theme` is available when code also needs the current snapshot.

## Shared robot control

ROS operations use the host connection’s robot-wide control lease. Observers can subscribe and
inspect, but topic publishes and robot service calls require the session to request
control in Robo-Boy’s top bar. Do not acquire automatically or retry/queue rejected commands.
Use absolute canonical names. SDK `2.3.0` adds tracked ROS 2 actions and explicit in-panel
control requests. These require the matching host implementation, not only newer type definitions.
Until that host and SDK tarball are released, use a coordinated local checkout; existing published
SDK `2.2.0` panels and their manifest permissions continue to work unchanged.
See [the concurrency contract](../docs/robot-control.md#panel-and-integration-contract) for
handover, disconnects, and robot-side watchdog requirements.

Declare `permissions.ros.actions` with the allowed action names and use
`context.ros.sendActionGoal({ action, actionType, goal }, onFeedback)`. It returns a host-generated
`goalId` and a `result` promise carrying `{ status, result }`. Status 4, 5 or 6 confirms a succeeded,
canceled or aborted goal; check the action's result payload as well. `cancelActionGoal(goalId)` only
accepts active goals created by that tile. It requests cancellation and retries until completion;
await the original result to know the outcome. Errors and connection loss do not prove stopping.
Unmount requests cancellation; host tracking continues until terminal status or transport closure.
Goals are never queued while offline or replayed after reconnect. There are at most 16 outstanding
panel goals per host ROS connection, and goal, feedback and result payloads are limited to 1 MiB JSON.

Declare `permissions.ros.control: true` to call `context.ros.control.request()` synchronously from a
click/key handler inside the focused, visible panel. The host checks browser user activation too.
It requests the existing connection's lease or asks its current owner for consent, returning
`{ state: 'owned' | 'pending', message }` without exposing lease tokens. A pending response does not
authorize a command. Missing activation support requires the top-bar workflow instead. Never request
on mount or a timer, adopt persistent work, or automatically replay a refused command when control arrives.

Panel API remains `2.0.0`: the additions are backward compatible for existing panels. New panels
must set their `compatibility.roboboy` minimum to the first released host containing these additions;
the SDK package version alone cannot establish runtime compatibility.
