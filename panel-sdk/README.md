# Robo-Boy Panel SDK

`@tessel-la/roboboy-panel-sdk` is Robo-Boy's type-only public contract for external panels. It deliberately
contains no React, ROSLIB, or browser runtime code, so importing its types cannot add code to a panel bundle.

Panel packages should use `import type` for the interfaces in `index.d.ts` and export one default
`RoboBoyPanelDefinition` from their ESM entry point. See `docs/external-panels.md` for the complete authoring and
deployment guide.

API `1.0.0` is the source contract in this repository. The package name is intended for publication; until it is
published, standalone workspace examples should use a local `file:` development dependency. Panel instances must
implement both `mount` and `unmount`, and same-realm panels must be treated as trusted deployment code.
