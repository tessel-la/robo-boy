# Robo-Boy Agent Instructions

These instructions apply to the complete repository.

## Start Here

Before changing code, read [docs/agent-guide.md](docs/agent-guide.md). Follow its task-specific reading routes and
source-of-truth hierarchy. Inspect the current implementation and tests named by that guide before relying on prose.

## Non-Negotiable Boundaries

- Do not invent ROS, panel SDK, manifest, registry, installer, or deployment APIs.
- Treat [panel-sdk/index.d.ts](panel-sdk/index.d.ts) and panel API `1.0.0` as the public source contract for external
  panels. Treat `src/panels/`, React components, application stores, and browser-storage keys as internal.
- Keep external panels independent. Robo-Boy must not import an external panel repository, source tree, or package
  into the core application.
- A custom gamepad layout, a new built-in gamepad component, an internal built-in panel, and an external SDK panel
  are different extension paths. Choose deliberately; do not silently substitute one for another.
- Keep live ROSLIB clients, Three.js objects, device handles, callbacks, and timers out of persisted state.
- Release every subscription, advertised publisher, listener, timer, observer, animation, media/device connection,
  and rendering resource when its owner becomes inactive or unmounts.
- Preserve backward compatibility for versioned browser data and exported JSON unless the task explicitly defines a
  migration or breaking change.

## Change Discipline

- Keep orchestration in the application shell and feature behavior inside the owning feature module, hook, service,
  storage module, or renderer.
- Add focused tests with behavior changes. Use end-to-end coverage when a change crosses the application shell,
  browser APIs, proxy paths, persistence/import-export, or several feature modules.
- Update the relevant guide when behavior, setup, public contracts, extension points, or operational constraints
  change.
- Feature pull requests target `dev`; official releases are created from `main` through the documented promotion and
  Release Please flow.

## Verification

Run the narrowest checks that prove the changed behavior. For broad changes, run:

```bash
npm run lint
npm run test:run
npm run build
npm run e2e
```

Panel installer changes also require `npm run test:panel-installer`. Tauri packaging changes require
`npm run build:tauri`; standalone panel repositories must typecheck, test, build, and validate their release artifact.
