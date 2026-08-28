# Robo-Boy Panel SDK

`@tessel-la/roboboy-panel-sdk` is Robo-Boy's type-only public contract for external panels. It deliberately
contains no React, ROSLIB, or browser runtime code, so importing its types cannot add code to a panel bundle.

Panel packages should install the contract as a development dependency, use `import type` for its interfaces, and
export one default `RoboBoyPanelDefinition` from their ESM entry point:

```sh
npm install --save-dev @tessel-la/roboboy-panel-sdk@^1.0.0
```

The complete authoring and deployment guide lives in the
[Robo-Boy repository](https://github.com/tessel-la/robo-boy/blob/main/docs/external-panels.md).

API `1.0.0` is the source contract in the Robo-Boy repository. Panel instances must implement both `mount` and
`unmount`, and same-realm panels must be treated as trusted deployment code.
