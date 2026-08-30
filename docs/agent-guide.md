# Agent Guide

This guide is the entry point for coding agents working on Robo-Boy. It explains how to find authoritative evidence,
choose the correct extension path, preserve architectural boundaries, and verify a change. It does not replace the
task-specific guides or source code.

## Operating Rule

Treat the current worktree as authoritative. Documentation provides intent and navigation; types, schemas, runtime
code, tests, and build scripts prove the current contract. When prose and implementation appear inconsistent, inspect
both, state the discrepancy, and do not invent a third behavior.

Before implementation:

1. Classify the task using the reading routes below.
2. Read the relevant guide completely.
3. Inspect the named source, configuration, and tests.
4. Write down the public boundary, persisted data, cleanup obligations, and deployment modes affected.
5. Implement and run checks whose scope matches the change.

## Task-Specific Reading Routes

| Task                                  | Read first                                                                         | Then inspect                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Run or connect Robo-Boy               | [User guide](user-guide.md), [Development guide](development.md)                   | `docker-compose.yml`, `infra/`, `src/runtime/`, `src/hooks/useRos.ts`                |
| Change application structure          | [Application architecture](architecture.md)                                        | `src/App.tsx`, `src/components/MainControlView.tsx`, owning feature module and tests |
| Change web/desktop endpoints          | [Desktop application](desktop.md), [Application architecture](architecture.md)     | `src/runtime/`, `config/vite.config.ts`, Caddy files, Compose files                  |
| Add robot interfaces                  | [Robot workspace overlays](robot-overlays.md)                                      | `infra/docker/ros_entrypoint.sh`, Compose override, robot workspace install tree     |
| Create or edit control-pad layouts    | [Custom gamepads](custom-gamepads.md)                                              | `src/features/customGamepad/`, `src/components/gamepads/custom/`                     |
| Add a built-in gamepad component      | [Custom gamepads](custom-gamepads.md), [Application architecture](architecture.md) | component types, palette, editor, renderer, storage, ROS helpers, tests              |
| Change built-in workspace panels      | [Application architecture](architecture.md)                                        | `src/panels/builtInPanels.ts`, `MainControlView`, panel adapters, workspace tests    |
| Build an external panel               | [External panels](external-panels.md), [SDK README](../panel-sdk/README.md)        | `panel-sdk/index.d.ts`, sibling reference panel, staging scripts                     |
| Change the panel SDK or loader        | [External panels](external-panels.md), [Application architecture](architecture.md) | `panel-sdk/`, `src/panels/`, installer/stager scripts and all related tests          |
| Change behavior trees or 3D rendering | [User guide](user-guide.md), [Application architecture](architecture.md)           | owning feature, hooks/services, ROS/Three.js adapters, disposal tests                |

## Source-Of-Truth Hierarchy

Use the strongest available evidence for the question being answered:

1. **Public type or machine-readable contract:** `panel-sdk/index.d.ts`, JSON schemas, TypeScript domain types, and
   version constants.
2. **Runtime behavior:** the implementation that validates, loads, persists, connects, renders, or cleans up.
3. **Focused tests:** expected success, failure, compatibility, migration, and cleanup behavior.
4. **Operational configuration:** Vite, Caddy, Compose, Docker, Tauri, and environment examples.
5. **Guides:** supported workflows and architectural intent.
6. **Reference repositories:** complete examples of using the public contract; never assume their internal helpers
   are host APIs.

A green test proves only the behavior it covers. A sample that imports an internal file does not make that file
public. A field present in runtime state does not become a supported external-panel field unless it is in the SDK.

## Architecture In One Pass

```text
Browser or Tauri webview
  App -> MainControlView -> feature modules and built-in panel adapters
                       -> external panel catalog/host
  shared ROSLIB.Ros connection
  versioned local browser state
        |
        | Web: same-origin proxy or selected backend host
        | Desktop: selected backend host and direct ports
        v
rosapi + rosbridge + web_video_server
        |
        | ROS 2 DDS on the host network
        v
robot or simulation nodes
```

Robo-Boy has no application server or user database. `App` owns connection and global theme state.
`MainControlView` coordinates the active ROS connection, workspace, built-in and external panel catalog, primary view,
control area, and cross-feature controls. Large feature behavior belongs below the shell in its feature module,
services, hooks, persistence layer, or renderer.

The web deployment uses Caddy to keep the frontend and proxied robot services on one origin. The Tauri application is
a thin frontend shell; it does not install, start, or stop ROS. Keep deployment-specific URL selection inside
`src/runtime/` instead of branching throughout feature components.

## Choose The Correct Extension Path

### Custom gamepad layout

Use a layout when the requested control surface can be composed from the existing joystick, button, D-pad, toggle,
slider, camera, plot, and heartbeat components. Layouts are versioned JSON created, imported, exported, and persisted
by the application. This path requires no JavaScript plugin and no panel SDK.

### New built-in gamepad component

Use this path when every Robo-Boy deployment should gain a new reusable control primitive in the gamepad editor. It
is core application development: extend the domain types, palette, editor settings, runtime dispatch, ROS helpers,
storage compatibility, and tests. It is not an external panel.

### Built-in workspace panel or core feature

Use this path only when the capability belongs in Robo-Boy core and needs application-shell or feature-module
integration. Register stable built-in metadata in `src/panels/builtInPanels.ts`, keep protocol/rendering behavior out
of `MainControlView`, and preserve existing persisted IDs.

### External SDK panel

Use an external panel for independently owned, deployment-selected functionality. Its source, dependencies, tests,
manifest, release, and distribution live outside Robo-Boy. Robo-Boy discovers only deployment-installed metadata and
lazy-loads the reviewed same-origin ESM bundle when a tile mounts.

Do not convert a request for one path into another merely because it is easier to implement.

## External Panel Contract

### Public and versioned

The public source contract is [panel-sdk/index.d.ts](../panel-sdk/index.d.ts), currently API `1.0.0`:

- `RoboBoyPanelDefinition` and `RoboBoyPanelInstance`
- `RoboBoyPanelContext`
- manifest, compatibility, author, asset, capability, and JSON value types
- storage, runtime, connection, viewport, and logger interfaces

The documented schema-version-1 manifest and installed-registry format are deployment contracts validated by the
host. Compatibility uses SemVer ranges, including prerelease support for the current alpha host versions.

### Internal and changeable

External panels must not depend on:

- React components, hooks, contexts, application stores, or feature-module source
- `MainControlView`, `ExternalPanelHost`, registry/loader/storage implementations, or browser-storage keys
- built-in panel adapters or custom-gamepad implementation details
- Robo-Boy's module graph or bundled copy of ROSLIB, Three.js, React, or another dependency
- globals that Robo-Boy happens to create during development

CSS custom properties may be consumed as optional theme hints only when the panel supplies usable fallbacks. They are
not a substitute for a versioned theme API.

### Lifecycle

For each workspace tile, the host:

1. Validates installed metadata, IDs, compatibility, paths, capabilities, and integrity fields.
2. Verifies the bundle SHA-256 and imports one cached module per immutable release.
3. Calls `activate(context)` to create a tile-owned instance.
4. Calls `mount(container)` and optional `setActive(isActive)`.
5. Calls `unmount()` when the tile, release, required ROS instance, or host disappears.

`mount` and `unmount` are mandatory. `unmount` must be deterministic and safe after partial startup. A panel owns only
DOM below the supplied container. It cannot mutate host workspace layout through the v1 API.

### ROS and reconnection

Declare `ros` to receive the shared `ROSLIB.Ros` object. It may be `null`. A panel that constructs topics, services,
or actions bundles its own compatible ROSLIB runtime, scopes every client to the instance that owns it, and releases
the client on cleanup. Watch `context.connection`; its generation changes when the shared ROS instance changes. Ignore
events from stale clients and rebuild against the new instance.

### Configuration and state

Declare `storage` to receive the per-instance JSON store. It accepts finite, acyclic, plain JSON values up to 20
levels deep and enforces a 64 KiB serialized quota. Keys must satisfy the SDK host's documented key rules. Sanitize
loaded values, version panel-owned configuration, and handle quota/unavailable-storage errors.

Never persist ROSLIB clients, callbacks, DOM nodes, timers, rendering objects, media streams, Bluetooth/USB/Serial
handles, credentials, or unbounded live samples. v1 has no host settings surface or secret store; a panel renders its
own settings and keeps secrets in memory.

### Layout, activity, and performance

The host owns tile creation, sizing, order, saved workspace layouts, and replacement. Use viewport snapshots for
responsive tile UI. Pause subscriptions, polling, decoding, animation, media, device traffic, and expensive rendering
when effective activity is false. Clean up even if an activity transition or mount operation fails.

### Dependencies and artifacts

The SDK package is type-only. Use `import type`; it supplies no runtime implementation. Bundle every runtime dependency
into browser-ready ESM with no unresolved bare imports. A normal Robo-Boy build never scans panel packages or sibling
repositories.

The manifest, module definition, package release, inventory entry, and artifact must agree on stable ID, version, API
compatibility, capabilities, and SHA-256 SRI. Runtime assets are same-origin, immutable, versioned deployment files.

## External Panel Evidence To Inspect

When available as sibling checkouts, use these repositories as complete examples:

| Repository                  | Evidence                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `robo-boy-hello-panel`      | smallest lifecycle and storage example, artifact validation                             |
| `robo-boy-timeseries-panel` | ROS discovery/subscription, connection generation, viewport activity, bounded live data |
| `robo-boy-webrtc-panel`     | network/media lifecycle, WHEP, in-memory credentials, statistics, abort/cleanup         |
| `robo-boy-panel-inventory`  | catalog and release-entry schema, immutable distribution metadata                       |

If they are not checked out, use the repositories linked from [External panels](external-panels.md). Do not infer an
API solely from an example's private helper.

## Change Workflow

### Application or feature change

1. Identify the owning shell, feature, hook/service, persistence module, or renderer.
2. Inspect co-located tests and any end-to-end flow that crosses the boundary.
3. Separate serializable domain data from live clients and rendering resources.
4. Implement cleanup before considering the happy path complete.
5. Preserve stored/imported data or add an explicit migration and compatibility test.
6. Update the relevant guide when user behavior, configuration, or extension points change.

### SDK or panel-host change

1. Decide whether the change is backward compatible under panel API `1.0.0`.
2. Update the canonical SDK type before documenting a new public member.
3. Update host types/validation/lifecycle and negative-path tests together.
4. Update `docs/external-panels.md` and `panel-sdk/README.md`.
5. Validate at least one minimal and one lifecycle-heavy standalone panel.
6. Use a new API major version for a breaking source or runtime contract; do not reinterpret `1.0.0` silently.

### Standalone panel change

1. Typecheck and test source behavior.
2. Build a browser ESM artifact with all runtime dependencies resolved.
3. Import and validate the built artifact, not only source modules.
4. Recalculate SRI after every bundle change.
5. Keep manifest and inventory metadata synchronized.
6. Stage through the common desired-state installer and exercise add, reload, reconnect, activity, resize, removal, and
   retry behavior in Robo-Boy.

## Verification Matrix

| Change area                          | Minimum focused evidence                    | Broader gate when applicable              |
| ------------------------------------ | ------------------------------------------- | ----------------------------------------- |
| Pure helper/domain logic             | relevant co-located unit test               | `npm run test:run`                        |
| React UI or feature state            | component/feature tests                     | `npm run lint`, `npm run build`           |
| Browser persistence/import-export    | storage and compatibility tests             | relevant Playwright flow                  |
| ROS subscription/publisher lifecycle | mocked ROS test including cleanup/reconnect | end-to-end or stack test                  |
| Caddy/Vite/Compose endpoint          | config/runtime tests and service logs       | `npm run e2e:stack`                       |
| External registry/loader/host        | `src/panels/*.test.*`                       | external-panel Playwright test            |
| Remote panel installer               | `npm run test:panel-installer`              | Docker panel overlay build                |
| Tauri frontend/package               | `npm run build:tauri`                       | target-specific installer build           |
| Broad application change             | focused tests first                         | lint, unit suite, build, end-to-end suite |

Do not report a broad workflow as verified when only a helper or typecheck ran. Record checks that were not run and why.

## Known V1 Boundaries

Agents must describe these as current limitations, not missing hidden APIs:

- Installation, updates, and removal are deployment-managed; there is no panel-management UI or rollback UI.
- Same-realm panels are trusted code. Capabilities shape context and review but do not enforce security permissions.
- The common installer supports one ESM bundle per release and rejects additional declared assets.
- Panels render settings inside their tile; there is no host settings schema, secret store, or notification API.
- Runtime dependencies are not shared with the host.
- SHA-256 detects artifact drift but does not establish publisher identity or revocation.
- Runtime error isolation is best effort; arbitrary synchronous panel code can still block or mutate the page.
- The raw ROS object is public, but host-owned topic/service/action convenience APIs are not part of v1.

## Documentation Maintenance

When a contract changes, update the closest source of truth and every dependent explanation in the same change:

| Change                              | Required documentation/evidence                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| Public SDK type or capability       | `panel-sdk/index.d.ts`, SDK README, external-panel guide, host tests, reference panel |
| Manifest or inventory rule          | validators/schema, external-panel guide, installer/stager tests, inventory example    |
| Runtime endpoint or deployment mode | runtime tests, development/desktop/architecture guides, proxy/Compose configuration   |
| Persisted or exported structure     | domain type, parser/migration, compatibility tests, owning feature guide              |
| Built-in panel/component            | catalog or component registry, UI/cleanup tests, user/custom-gamepad guide            |

Avoid copying volatile implementation details into several documents. Link to the canonical type, schema, or guide and
explain why the boundary exists.

## Suggested Context Packet For Another Agent

When handing off a task, include:

```text
Objective: <concrete outcome>
Base branch: dev
Required reading: docs/agent-guide.md plus <task-specific guides>
Public contract: <SDK type/schema/domain type, if any>
In-scope files: <paths>
Persisted/deployment behavior affected: <none or details>
Required checks: <focused tests and broader gate>
Constraint: inspect current source and tests; do not invent APIs or substitute extension paths
```

This packet is navigation, not proof. The receiving agent must still inspect the current worktree before changing it.
