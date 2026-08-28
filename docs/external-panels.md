# External Panels

Robo-Boy can host independently developed, deployment-bundled panels as workspace tiles. External panel source
stays in its own repository; a deployer reviews and stages an immutable ESM release below Robo-Boy's same-origin
`panels/` directory. This v1 mechanism is a trusted extension boundary, not a sandboxed plugin platform.

## Architecture And Boundaries

| Boundary           | Responsibility                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Robo-Boy core      | Catalog composition, metadata/integrity checks, workspace persistence/layout, lazy loading, lifecycle, host services, and per-panel error UI |
| Panel SDK          | Type-only manifest, activation context, storage, runtime, connection, viewport, and lifecycle interfaces in `panel-sdk/`                     |
| External panel     | Its own source, dependencies, release process, `roboboy.panel.json`, and browser-ready ESM bundle                                            |
| Panel Inventory    | Discoverable metadata and immutable release locations; it does not host source or act as the installed registry                              |
| Installed registry | Deployment-local `panels/installed.json` listing the bundles actually packaged with that Robo-Boy build                                      |

The core implementation is under `src/panels/`:

- `builtInPanels.ts` supplies metadata for the five existing workspace panels.
- `registry.ts` validates installed manifests, registry limits, duplicate IDs, SemVer ranges, capabilities,
  SHA-256 metadata, and same-origin immutable release paths before any external code executes.
- `useInstalledPanels.ts` discovers manifests without importing their bundles.
- `loader.ts` checks the staged bundle's declared SHA-256 digest, performs a cached dynamic import only when an
  external tile mounts, and validates the module export. Hashing uses Web Crypto when available and a bundled
  SHA-256 implementation on HTTP/local-address or embedded-webview contexts where `crypto.subtle` is absent.
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
- A panel does not need React. If it chooses React, Vue, Three.js, or another runtime, those dependencies belong
  to that panel bundle and may duplicate libraries already used by Robo-Boy.
- The Tauri `script-src 'self'` policy, offline installations, and normal web deployments behave consistently.
- Dependencies are owned and bundled by the panel author. Authors should avoid large libraries unless the panel
  needs them and should split additional features behind dynamic imports.
- The installed registry and versioned on-disk layout leave room for a future installer, but v1 does not define
  an installer transaction, rollback, publisher-signing, or garbage-collection protocol.

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
      "entryPoint": "./telemetry/1.2.0/index.js",
      "integrity": "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      "assets": [
        {
          "path": "./worker.js",
          "integrity": "sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
          "offline": true
        }
      ],
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

Each installed entry point and declared asset must resolve to the registry's protocol and host and contain the
manifest's exact version as a decoded path segment. A cross-origin, mutable `latest/`, `data:`, `blob:`, or
`javascript:` location is rejected before import. Entry points require a SHA-256 SRI value; declared assets also
carry hashes for deployment validation and future installer use. Optional `icon` and `preview` metadata are not
rendered by this host, and `offline` is advisory metadata for future installers.

The registry accepts at most 100 entries and 256 KiB. The production PWA precache includes JSON manifests,
webmanifests, JavaScript bundles, styles, and common static assets copied into the build, so deployment-bundled
panels remain available after the service worker has cached that release. Updating a panel means staging a new
versioned directory, updating its hash and registry entry, and rebuilding/repackaging Robo-Boy.

Discovery fetches and validates only JSON. Import begins when a workspace tile for that manifest mounts; repeated
instances share the browser module promise but receive distinct activation contexts and storage namespaces.

## Public Panel API

The canonical type definitions are the type-only `@tessel-la/roboboy-panel-sdk` package in `panel-sdk/index.d.ts`.
The API version is `1.0.0`.

```ts
interface RoboBoyPanelDefinition {
  apiVersion: string;
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
  readonly runtime: RoboBoyPanelRuntime;
  readonly connection: RoboBoyPanelConnection;
  readonly viewport: RoboBoyPanelViewport;
  readonly logger: RoboBoyPanelLogger;
}

interface RoboBoyPanelInstance {
  mount(container: HTMLElement): void | Promise<void>;
  setActive?(isActive: boolean): void | Promise<void>;
  unmount(): void | Promise<void>;
}
```

The boundary intentionally excludes React components, application stores, layout mutation, notifications, and
feature-specific services. `runtime` exposes only public ROS bridge, video, mesh, and Ollama endpoints plus the
web/desktop target. `connection` publishes status and a monotonically increasing generation when the shared ROS
instance changes. `viewport` publishes tile size, intersection, document visibility, and effective active state;
panels should pause expensive work while inactive. The host owns the tile and the panel owns only DOM below the
supplied mount element. `unmount` is mandatory and must remove listeners, timers, observers, ROS clients,
rendering resources, and created DOM.

### Lifecycle

1. Core validates registry metadata and compatibility.
2. A user adds or restores a workspace tile.
3. Core imports the ESM module, once per versioned entry point.
4. Core validates the default export's ID, compatible SemVer API version, and `activate` function.
5. `activate(context)` creates one instance for one workspace tile.
6. `mount(element)` renders that instance; `setActive` reports visibility changes when applicable.
7. `unmount()` runs when the tile, panel version, a required ROS instance, or host disappears.

Import, activation, synchronous or asynchronous mount, active-state, cleanup, and later global errors whose stack
or source identifies the installed bundle are caught and logged. The affected tile shows a retry action; built-ins
and other external tiles remain mounted. A rejected module promise is removed from the cache so retry can import
it again. Core's boot-error fallback is disabled after React starts, so an unattributed runtime exception is logged
instead of replacing the entire application.

## Capabilities And Access

| Capability      | Host behavior in v1                                                            |
| --------------- | ------------------------------------------------------------------------------ |
| `ros`           | Supplies the shared `ROSLIB.Ros` instance, or `null` while unavailable         |
| `storage`       | Supplies a versioned, instance-owned JSON store persisted with workspace state |
| `network`       | Declares that the panel uses `fetch`, WebSocket, or other network APIs         |
| `web-bluetooth` | Declares use of Web Bluetooth                                                  |
| `web-usb`       | Declares use of WebUSB                                                         |
| `web-serial`    | Declares use of Web Serial                                                     |
| `camera`        | Declares use of camera/media capture                                           |
| `microphone`    | Declares use of microphone/media capture                                       |

ROS and storage affect which services the context supplies: undeclared services are `null`. These are API-shaping
checks, not security gates. All capabilities are declarations for deployer review and possible future consent.
An installed same-realm module has Robo-Boy's browser privileges and can access browser globals directly. Only
stage trusted releases. Enforceable permissions require a future isolated-realm loader and message-based API.

The raw ROS connection is exposed because Robo-Boy panels may need arbitrary robot-specific topics, services,
and actions. Panels must scope their own ROSLIB clients and unsubscribe, unadvertise, cancel, or detach listeners
in `unmount`. Robo-Boy does not publish ROS on `window`; the capability-gated context is the supported boundary.

Storage is owned by `(panel type, workspace instance)`, stored in a schema-versioned envelope, cleared when a
tile changes panel type, and debounced before `localStorage` writes. It accepts only finite, acyclic, plain JSON
values up to 20 levels deep, validates keys, and enforces a 64 KiB serialized quota per instance. Authors can
inspect `storage.schemaVersion`, `quotaBytes`, and `sizeBytes()` and should handle quota errors explicitly.

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

## ROS Time Series Reference Panel

The sibling `robo-boy-timeseries-panel` is a fuller external-author example that exercises the `ros`, `storage`,
`connection`, and `viewport` APIs. It discovers topics, subscribes through the shared ROS connection, plots up to
eight nested numeric message fields, and provides bounded retention, bridge throttling, auto or fixed Y ranges,
pause/clear controls, point markers, and long-form CSV export. Leaving the field list blank discovers numeric
fields from the first received message. Its source-first settings drawer presents discovered topics and numeric
fields before placing retention and rendering controls in a scrollable advanced section for short mobile tiles.

The release bundles ROSLIB because the panel SDK exposes the host ROS object as a stable interface but does not
share Robo-Boy's module graph. This keeps the artifact independently buildable at the cost of about 170 KiB in
the panel bundle. The installed artifact lives under `public/panels/timeseries-panel/` and is loaded only when a
user adds that panel.

## WebRTC / RTSP Camera Reference Panel

The sibling `robo-boy-webrtc-panel` demonstrates a network-oriented panel without coupling video transport to
Robo-Boy core. It negotiates a WHEP endpoint with the browser's native WebRTC API, displays connection and inbound
video statistics, cleans up the remote WHEP session on disconnect, and keeps its matching RTSP URL available for
native consumers. Browsers do not decode RTSP directly, so a gateway such as the one configured in the sibling
Genesis simulation translates one H.264 stream into RTSP and WebRTC outputs.

The panel fetches ready streams from the restricted `/webrtc/_discovery/paths` resource and derives matching WHEP
and RTSP endpoints from the selected path. It automatically selects the only ready stream and retains a Custom URL
fallback for external gateways; simulator-specific preset buttons are not part of the panel contract.
Its compact footer never hides statistics based on tile height. Resolution, bitrate, FPS, candidate-pair RTT,
receiver jitter, packet loss, and dropped frames can be enabled independently from the advanced settings.
Bearer credentials remain in the settings input for the current panel session and are never written to panel
storage. The installed artifact lives under `public/panels/webrtc-panel/` and declares only `network` and `storage`.

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

1. During v1 development, depend on the type-only SDK from Robo-Boy's `panel-sdk/` directory and use
   `import type`. Publish it as `@tessel-la/roboboy-panel-sdk` before treating that package name as a public
   registry dependency.
2. Export one default definition and build a browser ESM artifact with no unresolved bare imports.
3. Keep manifest ID/version/API values aligned with the module export and package release, and make `unmount`
   deterministic and idempotent.
4. Test activation, mount, active-state changes, cleanup, missing services, and failure paths.
5. Publish immutable manifest and bundle artifacts from the panel's repository and record a SHA-256 SRI digest.
6. Add catalog metadata to the separate Panel Inventory repository; do not copy source there.
7. For manual installation, copy the bundle below `public/panels/<panel>/<version>/`, recompute its digest, and
   add its manifest metadata to `public/panels/installed.json` with a versioned relative `entryPoint`.
8. Rebuild/repackage Robo-Boy. The bundle is copied unchanged to `dist/panels/` for web/Docker and Tauri.

The sibling `robo-boy-hello-panel`, `robo-boy-timeseries-panel`, `robo-boy-webrtc-panel`, and
`robo-boy-panel-inventory` directories are workspace prototypes in this vertical slice. Their example GitHub
release URLs are publication targets, not evidence that those repositories or artifacts are already public. A
production pipeline must verify inventory metadata and artifact hashes before staging, then publish the complete
Robo-Boy build atomically.

## Limitations And Expected Evolution

- v1 installation/removal/update is deployment-managed; there is no UI installer yet.
- Same-realm panels are trusted code. Browser APIs beyond ROS/storage are declared but not enforceably gated.
- Runtime entry points must be installed same-origin; arbitrary remote modules are rejected.
- Optional manifest icons/previews are catalog metadata only in this slice.
- Panel settings do not yet have a separate host UI; panels render their own settings inside their tile.
- The raw ROS API is stable enough for the first slice but could gain narrower convenience services without
  removing direct access.
- SHA-256 hashes detect artifact drift but do not establish publisher identity. Publisher signing, inventory
  review policy, transactional staging, rollback metadata, and revocation should precede one-click installation.
- Same-realm error attribution is best effort. Import, activation, mount, and lifecycle failures are isolated to
  the tile, but arbitrary synchronous code can still block the main thread or mutate global state.
- A truly untrusted v2 platform should use an iframe or worker protocol with structured-clone messages, explicit
  ROS/network brokers, timeouts, quotas, and a separately versioned installer lifecycle.
