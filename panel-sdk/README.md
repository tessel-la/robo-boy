# Robo-Boy Panel SDK

`@tessel-la/roboboy-panel-sdk` is Robo-Boy's type-only public contract for external panels. It deliberately
contains no React, ROSLIB, or browser runtime code, so importing its types cannot add code to a panel bundle.

Panel packages should install the contract as a development dependency, use `import type` for its interfaces, and
export one default `RoboBoyPanelDefinition` from their ESM entry point:

```sh
npm install --save-dev \
  https://github.com/tessel-la/robo-boy/releases/download/panel-sdk-v2.0.0/tessel-la-roboboy-panel-sdk-2.0.0.tgz
```

The SDK is distributed as an npm-compatible tarball attached to the matching versioned GitHub release. It is not
published to the npm registry. Release assets are treated as append-only, and a panel's lockfile records the
tarball integrity so replacement bytes fail installation.

The complete authoring and deployment guide lives in the
[Robo-Boy repository](https://github.com/tessel-la/robo-boy/blob/main/docs/external-panels.md).

API `2.0.0` is the source contract in the Robo-Boy repository. Panel instances execute in an opaque-origin
sandbox and must implement both `mount` and `unmount`. ROS, network, storage, viewport, connection, and theme access
are host-owned services; raw Robo-Boy objects are not exposed to panel code. Direct HTTP calls are blocked by the
sandbox CSP, so network access must use the reviewed `context.network` allowlist.

Panels that let users choose arbitrary ROS inputs should declare `permissions.ros.selectTopic: true` and call
`context.ros.selectTopic()`. The complete topic graph is displayed only in trusted Robo-Boy UI. The sandbox receives
the one selected topic and message type, and the broker grants that exact subscription for the current tile session.

Robo-Boy installs its public theme tokens as CSS custom properties in the sandbox and updates them when the user
changes theme. Use variables such as `--background-color`, `--card-bg`, `--text-color`, `--border-color`,
`--primary-color`, and `--font-family-ui`; `context.theme` is available when code also needs the current snapshot.
