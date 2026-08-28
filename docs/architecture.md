# Application Architecture

This document describes the current runtime and the boundaries future development should preserve.

## System Overview

```text
Browser or Tauri webview
  React application
  ROSLIB WebSocket client
  Three.js visualization
        |
        | Web: Caddy routes or selected backend host
        | Desktop: selected backend host ports
        |
        v
ROS stack
  rosapi + rosbridge + web_video_server
        |
        | ROS 2 DDS on the host network
        v
Robot or simulation nodes
```

Robo-Boy has no application server or database. The web deployment uses Caddy to provide one origin for the frontend and ROS-facing services. The desktop deployment packages only the frontend in Tauri and connects to an independently installed ROS stack. The `ros-stack` container uses host networking for DDS discovery, while the web frontend and Caddy share the `app-net` bridge network.

## Frontend Composition

`src/main.tsx` mounts `App`. `App` owns the connection-screen transition and global theme state. Before connection it renders `EntrySection`; after submission it renders `MainControlView`.

`MainControlView` is the runtime coordinator. It:

- Owns the shared ROS connection through `useRos`.
- Switches between camera, 3D, and behavior-tree views.
- Discovers camera topics.
- Manages open custom-gamepad panels and editor sessions.
- Keeps behavior-tree execution controls reachable for stop and disconnect operations.
- Owns the resizable split between the primary view and control area.

Keep orchestration here, but place feature-specific behavior inside feature modules and hooks. New large features should not add substantial protocol or rendering logic directly to `MainControlView`.

## ROS Boundary

`useRos` is the owner of the active `ROSLIB.Ros` instance. `src/runtime/runtimeConfig.tsx` owns deployment-specific endpoints. Web builds use same-origin proxy routes for Quick Connect and Domain ID, and can use the selected host or IP for direct backend connections. Tauri builds connect directly to rosbridge, video, and mesh services on the selected ROS host. Keep this distinction out of feature components by consuming the runtime configuration boundary.

The connection object is passed to feature components. Code that creates a `ROSLIB.Topic`, `Service`, or action request must:

- Require an active connection.
- Keep the client instance scoped to the component, hook, or execution object that owns it.
- Unsubscribe, unadvertise, cancel, or detach listeners on cleanup.
- Ignore events from stale connections after reconnects.
- Put message conversion and schema normalization in testable helpers.

rosapi provides topic, service, action, and message-schema discovery. Robot-specific interface packages are supplied through workspace overlays described in [Robot workspace overlays](robot-overlays.md).

## Feature Modules

### Custom Gamepads

`src/features/customGamepad/` owns layout types, editing, persistence, message conversion, and runtime components. `src/components/gamepads/custom/` is only the adapter used by the main panel system. See [Custom gamepads](custom-gamepads.md).

### Behavior Trees

`src/features/behaviorTree/` is split into:

- `components/`: React Flow editor, toolbar, palette, node renderers, and parameter editors.
- `services/rosDiscovery.ts`: ROS resource and schema discovery through rosapi.
- `engine/executor.ts`: sequence, selector, parallel, action, service, and topic execution.
- `engine/persistentExecutor.ts`: the versioned command/status transport for ROS-owned executions.
- `storage/treeStorage.ts`: versioned browser persistence and JSON import/export.
- Root helpers and types: node creation, ordering, layout, search, and templates.

The editor owns graph state; an executor consumes a complete tree snapshot and emits execution events. Local runs use the browser executor. Opt-in persistent runs are sent to `infra/ros/behavior_tree_runner.py`, which owns ROS clients independently of the browser and exposes reconnectable status over standard `std_msgs/String` topics. Keep graph editing independent from either execution transport so both remain testable.

### 3D Visualization

The 3D stack has three layers:

- `VisualizationPanel` owns the viewer-level UI, active visualization configuration, topic discovery, fixed frame, and settings.
- `src/components/visualizers/` adapts React props to visualization hooks and settings components.
- `src/hooks/` and `src/utils/ros3d/` own ROS subscriptions, TF coordination, Three.js objects, shaders, primitives, and disposal.

New visualization types should follow the same split: serializable configuration in the panel, a thin React adapter, and lifecycle-heavy ROS/Three.js code in a hook or `ros3d` class. Dispose subscriptions, geometries, materials, animation callbacks, and viewer objects when dependencies change or components unmount.

### Themes

`src/features/theme/` owns theme creation and CSS generation. Built-in themes are CSS variable sets in `src/index.css`; custom themes generate a scoped style element and are persisted in browser storage. Components should consume theme variables rather than hardcoded palette colors.

### Panel Hosting And External Panels

`MainControlView` owns the unified workspace and persists panel instances by stable panel-definition ID. The common
catalog in `src/panels/builtInPanels.ts` registers the existing camera, 3D, behavior-tree, TF-tree, and pad panels.
`src/panels/useInstalledPanels.ts` adds compatible external manifests from the deployment-local
`public/panels/installed.json` without importing panel code.

Built-ins retain their existing React adapters and lifecycle behavior. External panels use the small,
framework-neutral contract in `panel-sdk/`; `ExternalPanelHost` verifies and lazily imports a deployment-bundled
release when its tile mounts, supplies narrow storage/runtime/connection/viewport services, and isolates lifecycle
failures to that tile. This is trusted same-realm code, so capability declarations shape the API and review process
but are not a security sandbox. Keep application stores and feature internals out of the public context. See
[External panels](external-panels.md) for distribution, compatibility, capabilities, authoring, and inventory boundaries.

## State And Persistence

State is intentionally local to the browser:

| State                        | Owner                     | Persistence                                                      |
| ---------------------------- | ------------------------- | ---------------------------------------------------------------- |
| Active ROS connection        | `useRos`                  | Memory only                                                      |
| Persistent BT runtime        | ROS behavior-tree runner  | Memory until completion/restart                                  |
| Current view and open panels | `MainControlView`         | Memory only                                                      |
| Mobile single/split panels   | `MainControlView`         | `localStorage`                                                   |
| Panel split                  | `useResizablePanels`      | `localStorage`                                                   |
| Themes                       | `App` and theme utilities | `localStorage`                                                   |
| Gamepad definitions          | `gamepadStorage.ts`       | Versioned `localStorage` and JSON                                |
| Behavior trees               | `treeStorage.ts`          | Versioned `localStorage` and JSON                                |
| 3D configuration             | `visualizationState.ts`   | Memory plus `localStorage`                                       |
| External panel instance data | `MainControlView`         | Owned/versioned JSON envelope; 64 KiB per tile in `localStorage` |

Visited mobile editor panel types remain mounted while hidden so transient editing state survives panel switches. Camera and 3D panels are released while hidden to stop video decoding, ROS subscriptions, and WebGL rendering; their serializable configuration remains in the workspace and visualization storage. Browser-owned ROS clients and executions are session-only. An explicitly persistent behavior-tree run is owned by the ROS stack; the app shell discovers it on reconnect and the editor rehydrates its tree and live statuses. No live client object is serialized in browser storage.

Persist domain definitions, not live ROS clients, Three.js objects, React state, or callbacks. Parse stored data defensively and provide defaults for newly introduced fields.

## Dependency Direction

Use this dependency direction for new code:

```text
App shell and shared components
        -> feature public components
        -> feature hooks/services/storage
        -> shared hooks and utilities
        -> ROSLIB, Three.js, browser APIs
```

Feature modules should not import application-shell state. Pass connection objects and callbacks through props or narrow feature APIs. Shared helpers must remain independent of feature UI.

External panels sit outside this internal dependency graph. They depend only on the versioned panel SDK contract
(currently source-controlled under `panel-sdk/`) and receive narrow runtime services from the host context.
Robo-Boy core may import SDK types; it must never import an external panel's source or package directly.

## Adding A Feature

1. Put a cohesive user capability under `src/features/<feature>/` when it needs its own types, state transitions, persistence, or services.
2. Expose a small top-level component or hook to the application shell.
3. Keep serializable domain state separate from ROS and rendering instances.
4. Centralize browser storage behind a feature storage module with a version and defensive parsing.
5. Centralize ROS discovery and message construction behind service or utility functions.
6. Add cleanup for every subscription, listener, timer, animation, WebGL resource, and in-flight action.
7. Add unit tests beside the changed code and an end-to-end test when the feature crosses major UI boundaries.
8. Update the relevant guide in `docs/` when behavior, setup, or extension points change.

## Operational Constraints

- Caddy path routing is part of the frontend contract. Changes to `/websocket`, `/video_stream`, `/webrtc`, or `/mesh_resources` require coordinated frontend and proxy updates. `/webrtc` proxies media-gateway WHEP signaling through a host-network relay and shared Unix socket; its reserved `/_discovery/paths` child exposes only the active-path listing from the loopback MediaMTX API. Negotiated WebRTC media still reaches the gateway's advertised ICE candidates directly.
- ROS 2 interface discovery depends on `ROS_DISTRO`, `ROS_DOMAIN_ID`, network compatibility, and mounted interface workspaces.
- The ROS container derives from the official `ros:<distro>-ros-core-<ubuntu>` image. Keep `ROS_DISTRO` and `ROS_UBUNTU_CODENAME` paired when overriding them (for example, Jazzy/Noble or Humble/Jammy).
- The production `infra/docker/Dockerfile` builds static assets and serves them with Nginx; the default Compose stack is development-oriented and serves Vite through Caddy.
- Browser storage is origin-specific. Switching between HTTP, HTTPS, hostnames, or ports produces separate local datasets.
