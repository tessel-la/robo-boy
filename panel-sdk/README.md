# Robo-Boy Panel SDK

`@tessel-la/roboboy-panel-sdk` is Robo-Boy's type-only public contract for external panels. It deliberately
contains no React, ROSLIB, or browser runtime code, so importing its types cannot add code to a panel bundle.

Panel packages should install the contract as a development dependency, use `import type` for its interfaces, and
export one default `RoboBoyPanelDefinition` from their ESM entry point:

```sh
npm install --save-dev \
  https://github.com/tessel-la/robo-boy/releases/download/panel-sdk-v1.0.0/tessel-la-roboboy-panel-sdk-1.0.0.tgz
```

The SDK is distributed as an npm-compatible tarball attached to the matching versioned GitHub release. It is not
published to the npm registry. Release assets are treated as append-only, and a panel's lockfile records the
tarball integrity so replacement bytes fail installation.

The complete authoring and deployment guide lives in the
[Robo-Boy repository](https://github.com/tessel-la/robo-boy/blob/main/docs/external-panels.md).

API `1.0.0` is the source contract in the Robo-Boy repository. Panel instances must implement both `mount` and
`unmount`, and same-realm panels must be treated as trusted deployment code.
