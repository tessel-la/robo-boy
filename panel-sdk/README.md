# Robo-Boy Panel SDK

`@tessel-la/roboboy-panel-sdk` is Robo-Boy's type-only public contract for external panels. It deliberately
contains no React, ROSLIB, or browser runtime code, so importing its types cannot add code to a panel bundle.

Panel packages should use `import type` for the interfaces in `index.d.ts` and export one default
`RoboBoyPanelDefinition` from their ESM entry point. See `docs/external-panels.md` for the complete authoring and
deployment guide.
