# External Panels

Robo-Boy can host independently developed panels as first-class workspace tiles. External panel source stays in
its own repository; Robo-Boy loads only a deployment-installed ESM artifact described by validated metadata.

## Architecture And Boundaries

| Boundary           | Responsibility                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Robo-Boy core      | Catalog composition, compatibility validation, workspace persistence/layout, lazy loading, lifecycle, host services, and per-panel error UI |
| Panel SDK          | Type-only stable manifest, activation context, storage, and lifecycle interfaces in `panel-sdk/`                                            |
| External panel     | Its own source, dependencies, release process, `roboboy.panel.json`, and browser-ready ESM bundle                                           |
| Panel Inventory    | Discoverable metadata and immutable release locations; it does not host source or act as the installed registry                             |
| Installed registry | Deployment-local `panels/installed.json` listing the bundles actually packaged with that Robo-Boy build                                     |

The core implementation is under `src/panels/`:

- `builtInPanels.ts` supplies metadata for the five existing workspace panels.
- `registry.ts` validates installed manifests, duplicate IDs, SemVer ranges, capabilities, and same-origin entry
  points before any external code executes.
- `useInstalledPanels.ts` discovers manifests without importing their bundles.
- `loader.ts` performs cached dynamic imports only when an external tile mounts and validates the module export.
- `ExternalPanelHost.tsx` supplies gated host services and owns activation, mounting, active-state changes,
  cleanup, retry, and tile-local failures.

`MainControlView` merges built-in and external entries into one catalog. Existing workspace records keep the
legacy built-in IDs (`camera`, `3d`, `behaviorTree`, `tfTree`, and `pad`), so no built-in migration or duplicate
panel architecture is required. A persisted external tile keeps its stable reverse-domain panel ID and displays
an actionable unavailable state if that panel is later removed.

## Distribution Decision

The first implementation uses independently released, framework-neutral JavaScript ESM bundles. Installation
copies a bundle into the same-origin static `panels/` directory used by the web, Docker, PWA, and Tauri builds.

This choice fits the current static Vite/Tauri architecture:

- Panel code is lazy and remains outside Robo-Boy's main application chunks.
- A panel does not need React and cannot accidentally load a second incompatible React runtime.
- The Tauri `script-src 'self'` policy, offline installations, and normal web deployments behave consistently.
- Dependencies are owned and bundled by the panel author. Authors should avoid large libraries unless the panel
  needs them and should split additional features behind dynamic imports.
- A future installer can download, verify, copy, remove, or update bundles and rewrite only the installed
  registry; it does not need to change the panel API or workspace model.

npm packages remain a reasonable release transport, but Robo-Boy does not scan `node_modules` or require panel
packages to be application dependencies. Direct live imports from arbitrary HTTPS origins were not selected:
they conflict with Tauri's CSP and offline packaging, require CORS, and increase supply-chain exposure. Module
federation would add a runtime not otherwise needed by this Vite application. iframe isolation is a possible
future loader for untrusted panels but needs explicit bridges for ROS, theming, sizing, and persistence.

## Installed Registry And Discovery

The default registry URL is resolved from `panels/installed.json` relative to `document.baseURI`, which works for
normal web paths and Tauri's custom protocol. A deployment can set `VITE_PANEL_REGISTRY_URL` to a different
same-origin path at build time.

```json
{
  "schemaVersion": 1,
  "panels": [
    {
      "schemaVersion": 1,
      "id": "com.example.telemetry",
      "name": "Robot Telemetry",
      "description": "Displays robot-specific telemetry.",
      "version": "1.2.0",
      "entryPoint": "./telemetry/index.js",
      "compatibility": {
        "panelApi": "^1.0.0",
        "roboboy": ">=0.3.0-0 <1.0.0"
      },
      "capabilities": ["ros", "storage"],
      "author": { "name": "Example Robotics", "url": "https://example.com" },
      "repository": "https://github.com/example/roboboy-telemetry",
      "tags": ["telemetry", "robot-specific"]
    }
  ]
}
```

Panel IDs are stable and should use a lowercase reverse-domain form. IDs may not collide with another installed
panel or a built-in ID. Versions and compatibility fields use npm SemVer range syntax. Robo-Boy evaluates ranges
with prerelease support because Robo-Boy itself currently publishes alpha versions.

The installed entry point must resolve to the same protocol and host as the installed registry. A cross-origin,
`data:`, `blob:`, or `javascript:` entry point is rejected before import. Optional `icon` and `preview` metadata
are reserved in the manifest contract but are not rendered by this first host.

Discovery fetches and validates only JSON. Import begins when a workspace tile for that manifest mounts; repeated
instances share the browser module promise but receive distinct activation contexts and storage namespaces.

## Public Panel API

The canonical type definitions are the type-only `@tessel-la/roboboy-panel-sdk` package in `panel-sdk/index.d.ts`.
The API version is `1.0.0`.

```ts
interface RoboBoyPanelDefinition {
  apiVersion: '1.0.0';
  id: string;
  activate(context: RoboBoyPanelContext): RoboBoyPanelInstance | Promise<RoboBoyPanelInstance>;
}

interface RoboBoyPanelContext {
  readonly panelId: string;
  readonly instanceId: string;
  readonly hostVersion: string;
  readonly capabilities: readonly RoboBoyPanelCapability[];
  readonly ros: ROSLIB.Ros | null;
  readonly storage: RoboBoyPanelStorage | null;
  readonly logger: RoboBoyPanelLogger;
}

interface RoboBoyPanelInstance {
  mount(container: HTMLElement): void | Promise<void>;
  setActive?(isActive: boolean): void | Promise<void>;
  unmount?(): void | Promise<void>;
}
```

The boundary intentionally excludes React components, application stores, layout internals, notifications, and
feature-specific services. The host owns the tile and its sizing. The panel owns only DOM below the supplied
mount element. `unmount` must remove listeners, timers, observers, ROS clients, rendering resources, and DOM it
created. A panel can bundle React, Vue, Three.js, or another framework internally, but should do so deliberately
because those bytes and runtime instances are not shared by the host.

### Lifecycle

1. Core validates registry metadata and compatibility.
2. A user adds or restores a workspace tile.
3. Core imports the ESM module, once per versioned entry point.
4. Core validates the default export's ID, API version, and `activate` function.
5. `activate(context)` creates one instance for one workspace tile.
6. `mount(element)` renders that instance; `setActive` reports visibility changes when applicable.
7. `unmount()` runs when the tile, panel version, ROS instance, or host disappears.

Import, activation, synchronous or asynchronous mount, active-state, cleanup, and later global errors whose stack
or source identifies the installed bundle are caught and logged. The affected tile shows a retry action; built-ins
and other external tiles remain mounted. A rejected module promise is removed from the cache so retry can import
it again. Core's boot-error fallback is disabled after React starts, so an unattributed runtime exception is logged
instead of replacing the entire application.

## Capabilities And Access

| Capability      | Host behavior in v1                                                       |
| --------------- | ------------------------------------------------------------------------- |
| `ros`           | Supplies the shared `ROSLIB.Ros` instance, or `null` while unavailable    |
| `storage`       | Supplies an instance-namespaced JSON store persisted with workspace state |
| `network`       | Declares that the panel uses `fetch`, WebSocket, or other network APIs    |
| `web-bluetooth` | Declares use of Web Bluetooth                                             |
| `web-usb`       | Declares use of WebUSB                                                    |
| `web-serial`    | Declares use of Web Serial                                                |
| `camera`        | Declares use of camera/media capture                                      |
| `microphone`    | Declares use of microphone/media capture                                  |

ROS and storage are actual host-service gates: undeclared services are `null`. The other capabilities are
declarations for review and future installation consent. This is not a security sandbox. An installed same-realm
module has the browser privileges granted to Robo-Boy and could access global browser APIs directly. Only install
trusted panel releases. Enforceable permissions require a future iframe/worker loader plus a message-based API.

The raw ROS connection is exposed because Robo-Boy panels may need arbitrary robot-specific topics, services,
and actions. Panels must scope their own ROSLIB clients and unsubscribe, unadvertise, cancel, or detach listeners
in `unmount`. They do not receive internal state stores or runtime endpoint configuration.

## Minimal Hello Panel

```ts
import type { RoboBoyPanelDefinition } from '@tessel-la/roboboy-panel-sdk';

const definition: RoboBoyPanelDefinition = {
  apiVersion: '1.0.0',
  id: 'com.example.hello',
  activate(context) {
    return {
      mount(container) {
        const heading = document.createElement('h2');
        heading.textContent = `Hello from ${context.panelId}`;
        container.replaceChildren(heading);
      },
      unmount() {
        // Release listeners, clients, timers, and rendering resources here.
      },
    };
  },
};

export default definition;
```

The complete standalone example is the sibling `robo-boy-hello-panel` repository. Its installed release artifact
is under `public/panels/hello-panel/`, and `public/panels/installed.json` makes it available without importing it
into application source.

## Create, Install, And Register A Panel

Smallest viable standalone repository:

```text
my-roboboy-panel/
  package.json
  tsconfig.json
  roboboy.panel.json
  src/index.ts
  dist/index.js
  README.md
```

1. Depend on `@tessel-la/roboboy-panel-sdk` for types and use `import type`.
2. Export one default definition and build a browser ESM artifact with no unresolved bare imports.
3. Keep manifest ID/version/API values equal to the module export and package release.
4. Test activation, mount, active-state changes, cleanup, missing services, and failure paths.
5. Publish immutable manifest and bundle artifacts from the panel's repository.
6. Add catalog metadata to the separate Panel Inventory repository; do not copy source there.
7. For manual installation, copy the bundle below Robo-Boy's `public/panels/<panel>/` directory and add its
   manifest metadata to `public/panels/installed.json`, adjusting `entryPoint` to the installed relative path.
8. Rebuild/repackage Robo-Boy. The bundle is copied unchanged to `dist/panels/` for web/Docker and Tauri.

For a production installation pipeline, verify hashes/signatures before copying an inventory release. The
current inventory schema leaves this as the next security extension rather than claiming unimplemented trust.

## Limitations And Expected Evolution

- v1 installation/removal/update is deployment-managed; there is no UI installer yet.
- Same-realm panels are trusted code. Browser APIs beyond ROS/storage are declared but not enforceably gated.
- Runtime entry points must be installed same-origin; arbitrary remote modules are rejected.
- Optional manifest icons/previews are catalog metadata only in this slice.
- Panel settings do not yet have a separate host UI; panels render their own settings inside their tile.
- The raw ROS API is stable enough for the first slice but could gain narrower convenience services without
  removing direct access.
- Integrity hashes, publisher signing, inventory review policy, and rollback metadata should precede automated
  one-click installation.
- An installer can later consume the inventory, request declared capabilities, download and verify artifacts,
  update the local installed registry, and trigger the target-specific rebuild/repackage step. None of those
  changes require a different panel lifecycle contract.
