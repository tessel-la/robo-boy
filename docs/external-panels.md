# External Panels

Robo-Boy can host independently developed, deployment-bundled panels as workspace tiles. External panel source
stays in its own repository; a deployer reviews and stages an immutable ESM release below Robo-Boy's same-origin
`panels/` directory. Panel API v2 executes that release in an opaque-origin iframe and brokers every host service
over a private message channel.

## Architecture And Boundaries

| Boundary           | Responsibility                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Robo-Boy core      | Catalog, integrity checks, workspace layout, sandbox lifecycle, permission brokers, management API/UI, and per-panel error UI   |
| Panel SDK          | Type-only manifest, activation context, storage, runtime, connection, viewport, theme, and lifecycle interfaces in `panel-sdk/` |
| External panel     | Its own source, dependencies, release process, `roboboy.panel.json`, and browser-ready ESM bundle                               |
| Panel Inventory    | Remote catalog metadata and immutable release locations; it does not host source or act as the installed registry               |
| Desired state      | Schema-v2 source and selection configuration shared by local and remote installation                                            |
| Installed registry | Deployment-local `panels/installed.json` locking exact bundles, integrity, selection, and source provenance                     |

The core implementation is under `src/panels/`:

- `builtInPanels.ts` supplies metadata for the five existing workspace panels.
- `registry.ts` validates installed manifests, registry limits, duplicate IDs, SemVer ranges, capabilities,
  SHA-256 metadata, and same-origin immutable release paths before any external code executes.
- `useInstalledPanels.ts` discovers manifests without importing their bundles.
- `loader.ts` fetches the staged bundle as bytes and checks its declared SHA-256 digest only when an external tile
  mounts. Hashing uses Web Crypto when available and a bundled
  SHA-256 implementation on HTTP/local-address or embedded-webview contexts where `crypto.subtle` is absent.
- `ExternalPanelHost.tsx` creates an iframe without `allow-same-origin`, transfers verified source through a private
  `MessagePort`, and owns activation, cleanup, retry, and tile-local failures.
- `capabilityBroker.ts` enforces ROS topic/service patterns, filters discovery, validates network origins and
  redirects, strips ambient browser credentials, and exposes only explicitly requested host endpoints.
- `PanelManagerDialog.tsx` and `scripts/panel-manager.mjs` provide authenticated preview/apply management in Compose.

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
- The sandbox receives verified source bytes as a blob module, so installed web, PWA, and Tauri assets remain
  same-origin and offline-capable without executing in the parent page.
- Dependencies are owned and bundled by the panel author. The installed entry point must be a self-contained ESM
  bundle; relative dynamic chunks are not part of the current installer contract.
- The installer atomically replaces the registry only after every selected bundle verifies. The versioned on-disk
  layout supports deterministic re-application; publisher signing and garbage collection remain future work.

Package tarballs remain a reasonable development-contract transport—the panel SDK is an npm-compatible tarball
attached to a versioned Robo-Boy GitHub release—but runtime panels are immutable manifest and ESM bundle assets.
Robo-Boy does not scan `node_modules` or require panel packages to be application dependencies. Direct live
imports from arbitrary HTTPS origins were not selected:
they conflict with Tauri's CSP and offline packaging, require CORS, and increase supply-chain exposure. Module
federation would add a runtime not otherwise needed by this Vite application. The iframe bridge deliberately
implements ROS, network, storage, sizing, connection, logging, and fullscreen operations rather than sharing host
objects.

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
        "panelApi": "^2.0.0",
        "roboboy": ">=0.3.0-0 <1.0.0"
      },
      "capabilities": ["ros", "storage"],
      "permissions": {
        "ros": {
          "discover": true,
          "subscribe": ["/telemetry/**"]
        }
      },
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

Discovery fetches and validates only JSON. Bundle fetch and sandbox startup begin when a workspace tile mounts.
Every tile gets an isolated realm, capability channel, and storage namespace.
The optional `installation` object generated by the installer records the configuration schema, explicit selection,
configured source names/types, and exact version/integrity/source for each resolved panel. Robo-Boy exposes that
provenance in the workspace catalog; older schema-v1 registries without it remain valid.

## Public Panel API

The canonical type definitions are the type-only `@tessel-la/roboboy-panel-sdk` package in `panel-sdk/index.d.ts`.
The API version is `2.0.0`.

```ts
interface RoboBoyPanelDefinition {
  apiVersion: string;
  id: string;
  activate(context: RoboBoyPanelContext): RoboBoyPanelInstance | Promise<RoboBoyPanelInstance>;
}

interface RoboBoyPanelContext {
  readonly panelId: string;
  readonly instanceId: string;
  readonly capabilities: readonly RoboBoyPanelCapability[];
  readonly ros: RoboBoyPanelRos | null;
  readonly storage: RoboBoyPanelStorage | null;
  readonly network: RoboBoyPanelNetwork | null;
  readonly runtime: RoboBoyPanelRuntime;
  readonly connection: RoboBoyPanelConnection;
  readonly viewport: RoboBoyPanelViewport;
  readonly theme: RoboBoyPanelTheme;
  readonly logger: RoboBoyPanelLogger;
}

interface RoboBoyPanelInstance {
  mount(container: HTMLElement): void | Promise<void>;
  setActive?(isActive: boolean): void | Promise<void>;
  unmount(): void | Promise<void>;
}
```

The boundary intentionally excludes React components, application stores, layout mutation, notifications, host
version, raw ROSLIB objects, and the complete runtime endpoint map. `runtime` exposes only the web/desktop target;
an approved `network.hostEndpoints` entry appears under `context.network.endpoints`. `connection` publishes status
and a monotonically increasing generation when the shared ROS
instance changes. `viewport` publishes tile size, intersection, document visibility, and effective active state;
panels should pause expensive work while inactive. `theme` provides the current light/dark color scheme and a
reviewed set of Robo-Boy CSS tokens. The sandbox also installs those tokens on its document root and supplies base
styles for native controls. The host owns the tile and the panel owns only DOM below the supplied mount element.
`unmount` is mandatory and must remove listeners, timers, observers, ROS clients, rendering resources, and created
DOM.

### Lifecycle

1. Core validates registry metadata and compatibility.
2. A user adds or restores a workspace tile.
3. Core verifies bundle bytes and transfers them into an opaque-origin iframe.
4. The sandbox imports the blob module and validates its exact ID/API definition.
5. `activate(context)` creates one instance inside that workspace tile's iframe.
6. `mount(element)` renders that instance; `setActive` reports visibility changes when applicable.
7. `unmount()` runs when the tile, panel version, a required ROS instance, or host disappears.

Fetch, import, activation, mount, active-state, cleanup, and sandbox runtime errors are reported through the channel.
The affected tile shows a retry action; built-ins and other external tiles remain mounted. Removing the iframe
terminates the panel realm even if its cleanup fails.

## Capabilities And Access

| Capability      | Host behavior in v2                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `ros`           | Supplies brokered discovery/subscribe/publish/service methods constrained by manifest patterns           |
| `storage`       | Supplies a versioned, instance-owned JSON store persisted with workspace state                           |
| `network`       | Supplies credential-free brokered fetch and approved host endpoints; iframe CSP blocks direct HTTP calls |
| `web-bluetooth` | Declares use of Web Bluetooth                                                                            |
| `web-usb`       | Declares use of WebUSB                                                                                   |
| `web-serial`    | Declares use of Web Serial                                                                               |
| `camera`        | Declares use of camera/media capture                                                                     |
| `microphone`    | Declares use of microphone/media capture                                                                 |

Undeclared services are `null`. ROS/network capabilities require a matching `permissions` block. Static ROS
discovery returns only topics matching an approved `subscribe` pattern; every subscribe, publish, and service
request is checked again. A panel that needs user-configurable topics can instead declare `selectTopic: true` and
call `context.ros.selectTopic()`. Robo-Boy obtains the complete graph, displays it in trusted host UI, and returns
only the selected topic and message type to the panel. That selection grants subscription access to that exact pair
for the current tile session; it does not expose the graph or create a wildcard grant. Network requests accept only
declared exact HTTPS origins, `self`, or the visibly broad `https:` grant. Host endpoint grants are narrower:
`videoStream`, for example, permits only its known discovery and WHEP routes rather than the complete service
origin. Redirect targets are checked, ambient credentials are omitted, privileged headers are blocked, response
headers are filtered, responses are size-capped, and concurrent requests time out. The sandbox has no parent DOM,
Robo-Boy storage, cookies, or raw host objects.

### Theme And UI Guidelines

Opaque-origin panels cannot inherit parent-page CSS directly. Robo-Boy therefore copies only its public design
tokens into the sandbox: primary and semantic colors, page/card/background/text/border colors, button text, and the
UI font family. The current values are available through `context.theme.getSnapshot()` and changes are published by
`context.theme.subscribe()`. The same tokens are also written as CSS custom properties on `:root`, which is the
preferred styling interface:

```css
.panel-card {
  color: var(--text-color);
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 12px;
}

.panel-action {
  color: var(--button-text-color);
  background: var(--primary-color);
}
```

Use theme variables for every palette value and `--font-family-ui` for typography. Native buttons, inputs, selects,
and textareas receive baseline Robo-Boy styling, but panels remain responsible for their layout, spacing, focus
order, labels, disabled states, overflow behavior, and responsive UI. Avoid copying a built-in theme's resolved
colors into panel source because custom and future themes update the variables at runtime.

Device capabilities are translated to iframe Permissions Policy entries. Camera and microphone still require the
browser's normal user consent. Browser support for Bluetooth, USB, and Serial inside a sandbox varies and should be
tested on the deployment target.

Storage is owned by `(panel type, workspace instance)`, stored in a schema-versioned envelope, cleared when a
tile changes panel type, and debounced before `localStorage` writes. It accepts only finite, acyclic, plain JSON
values up to 20 levels deep, validates keys, and enforces a 64 KiB serialized quota per instance. Authors can
inspect `storage.schemaVersion`, `quotaBytes`, and `sizeBytes()` and should handle quota errors explicitly.

## Minimal Hello Panel

```ts
import type { RoboBoyPanelDefinition } from '@tessel-la/roboboy-panel-sdk';

const definition: RoboBoyPanelDefinition = {
  apiVersion: '2.0.0',
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

The complete standalone example is the sibling `robo-boy-hello-panel` repository. It is not included in a normal
Robo-Boy checkout or build. The desired-state installer reads its manifest, verifies its local release artifact,
and places it in a generated deployment tree without importing it into application source.

## ROS Time Series Reference Panel

The sibling `robo-boy-timeseries-panel` is a fuller external-author example that exercises the brokered `ros`,
`storage`, `connection`, `viewport`, and theme APIs. It asks the user to choose any topic through Robo-Boy's trusted
picker, subscribes through the broker, plots up to eight nested numeric message fields, and provides bounded
retention, bridge throttling, auto or fixed Y ranges, pause/clear controls, point markers, and long-form CSV export.
Leaving the field list blank discovers numeric fields from the first received message. Its source-first settings
drawer presents the approved topic and numeric fields before placing retention and rendering controls in a
scrollable advanced section for short mobile tiles.

The release uses the API v2 ROS broker and contains no ROSLIB client or direct rosbridge connection. Its manifest
permits the panel to open the trusted picker, but the panel never receives the unselected graph. An explicitly
staged artifact is loaded only when a user adds that panel.

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
storage. Its explicitly staged artifact declares only `network` and `storage`.

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

Keep the panel repository outside Robo-Boy. A local source lists repository directories explicitly, so adding a panel
does not cause Robo-Boy to scan or execute unrelated sibling projects. A typical workspace is:

```text
workspace/
  robo-boy/
  my-roboboy-panel/
```

Install the type-only SDK directly from its versioned GitHub release:

```bash
cd my-roboboy-panel
npm install --save-dev \
  https://github.com/tessel-la/robo-boy/releases/download/panel-sdk-v2.0.0/tessel-la-roboboy-panel-sdk-2.0.0.tgz
```

After building `dist/index.js`, calculate its SRI value and copy the complete `sha256-...` value into the panel
manifest:

```bash
printf 'sha256-'
openssl dgst -sha256 -binary dist/index.js | openssl base64 -A
printf '\n'
```

Create an ignored desired-state configuration from `config/panel-sources.mixed.example.json`, or use this minimal
local-only configuration:

```json
{
  "schemaVersion": 2,
  "sources": [
    {
      "type": "local",
      "name": "development",
      "root": "../..",
      "rootEnv": "ROBOBOY_PANEL_WORKSPACE",
      "repositories": ["my-roboboy-panel"]
    }
  ],
  "selection": {
    "mode": "include",
    "panelIds": ["com.company.robot.my-panel"]
  }
}
```

`root` is resolved relative to the configuration file for host commands. `rootEnv` optionally overrides it in a
container. Stage and run the selected panels without copying source into Robo-Boy:

```bash
cd ../robo-boy
npm run panels:stage-local -- \
  --config config/panel-sources.json

npm run dev:panels -- \
  --config config/panel-sources.json
```

For Docker development, `infra/compose/panels.yml` runs the same installer against
`config/panel-sources.local.json`. Add an uncommitted deployment-local Compose file for a new panel and point
`ROBOBOY_PANEL_SOURCES_FILE` at your ignored configuration:

```yaml
services:
  panel-manager:
    volumes:
      - /absolute/path/my-roboboy-panel:/panel-workspace/my-roboboy-panel:ro
```

```bash
export ROBOBOY_PANEL_SOURCES_FILE=./config/panel-sources.json

docker compose \
  -f docker-compose.yml \
  -f infra/compose/panels.yml \
  -f /absolute/path/my-panel.compose.yml \
  build app panel-manager

docker compose \
  -f docker-compose.yml \
  -f infra/compose/panels.yml \
  -f /absolute/path/my-panel.compose.yml \
  up -d
```

After changing a local bundle, use the **Manage installations…** action in Robo-Boy to preview and apply the
same desired state again. For a command-line-only workflow, restart the manager after removing its persisted state
volume or use the staging commands above.

```bash
export ROBOBOY_PANEL_MANAGER_TOKEN='use-a-long-random-deployment-secret'
docker compose \
  -f docker-compose.yml \
  -f infra/compose/panels.yml \
  -f /absolute/path/my-panel.compose.yml \
  up -d --build panel-manager app caddy
```

Do not commit the deployment-local Compose/configuration files, generated `.panel-stage/` tree, or panel bundle
copies to Robo-Boy.

1. Depend on the type-only SDK tarball from the pinned `panel-sdk-v<version>` Robo-Boy GitHub release and use
   `import type`. For coordinated local development only, the sibling examples may temporarily use
   `file:../robo-boy/panel-sdk` before the release asset exists.
2. Export one default definition and build a browser ESM artifact with no unresolved bare imports.
3. Keep manifest ID/version/API values aligned with the module export and package release, and make `unmount`
   deterministic and idempotent.
4. Test activation, mount, active-state changes, cleanup, missing services, and failure paths.
5. Select the local repository in a schema-v2 desired-state configuration and verify it through the real installer.
6. Publish immutable manifest and bundle artifacts from the panel's repository and record a SHA-256 SRI digest.
7. Add catalog metadata to the separate Panel Inventory repository only when publishing; local development does not
   require an inventory entry.
8. Run `npm run dev:panels`, `npm run build:panels`, or `npm run build:tauri:panels` with `-- --config <path>`; each
   command stages the exact desired state before using the generated public tree. Normal `dev`, `build`, and
   `build:tauri` commands keep the tracked empty registry and package no external panels.

The generated `.panel-stage/` directory is ignored by Git. The tracked `public/panels/installed.json` remains an
empty default registry, and external bundle copies must not be committed to Robo-Boy. A production installer or
deployment pipeline should perform the equivalent staging operation from immutable published release URLs rather
than relying on sibling working copies.

## Remote Inventories And Private Panels

`scripts/install-panels.mjs` is the common installer for local repositories and published releases. It resolves every
configured source, verifies manifests and bundle SHA-256 values, and atomically replaces the deployment's
`installed.json`. A failed install leaves the previous registry active. Versioned bundles are immutable and may
remain cached when a later desired state no longer selects them.

The source configuration is deployment-owned:

The canonical machine-readable contract is `config/panel-sources.schema.json`. Both shipped Compose overlays use
the same configuration and installer; they differ only in their default configuration and repository mounts.

```json
{
  "schemaVersion": 2,
  "sources": [
    {
      "type": "remote",
      "name": "roboboy-official",
      "catalogUrl": "https://panels.roboboy.example/catalog.json",
      "allowedOrigins": ["https://releases.roboboy.example"]
    },
    {
      "type": "remote",
      "name": "company-private",
      "catalogUrl": "https://panels.company.example/roboboy/catalog.json",
      "allowedOrigins": ["https://panels.company.example"],
      "authorizationEnv": "ROBOBOY_PANEL_AUTHORIZATION",
      "authenticatedOrigins": ["https://panels.company.example"]
    }
  ],
  "selection": {
    "mode": "include",
    "panelIds": ["la.tessel.roboboy.timeseries", "com.company.robot.private-telemetry"]
  }
}
```

Selection is deliberately explicit: `all` installs every discovered panel, `include` requires a non-empty
`panelIds` list, and `none` installs an empty registry without contacting configured sources. Panel IDs must be
unique across selected sources: a local or private source cannot silently replace an official panel. Catalog, entry,
manifest, bundle, and redirect URLs must use HTTPS, except localhost HTTP used by installer tests. Every release
origin must be explicitly allowed. Source configuration schema v1 is not accepted; migrate `inventories` to typed
`sources` and replace `enabledPanels` with the explicit `selection` object.

### Select A Published Panel Subset

The tracked official source configuration explicitly uses `selection.mode: "all"`. To select a subset, create the
ignored deployment-local copy:

```bash
cp config/panel-sources.official.json config/panel-sources.json
```

Add the exact IDs to its top-level object. For example, this installs only Time Series and WebRTC:

```json
{
  "schemaVersion": 2,
  "sources": [
    {
      "type": "remote",
      "name": "roboboy-official",
      "catalogUrl": "https://raw.githubusercontent.com/tessel-la/robo-boy-panel-inventory/main/catalog.json",
      "allowedOrigins": [
        "https://github.com",
        "https://objects.githubusercontent.com",
        "https://release-assets.githubusercontent.com"
      ]
    }
  ],
  "selection": {
    "mode": "include",
    "panelIds": ["la.tessel.roboboy.timeseries", "la.tessel.roboboy.webrtc"]
  }
}
```

Then set this non-secret path in Robo-Boy's `.env` so manual Compose and Tessella Dashboard launches use it:

```dotenv
ROBOBOY_PANEL_SOURCES_FILE=./config/panel-sources.json
```

The Compose panel manager seeds its persisted configuration from this file on first startup. Set
`ROBOBOY_PANEL_MANAGER_TOKEN` and use **Manage installations…** to edit later desired state. Use
`selection.mode: "none"` to remove all external panels while retaining their cached versioned bytes. Every ID
listed by `include` must exist in one configured source or preview fails without replacing the working registry.

Private credentials are not stored in the source configuration. `authorizationEnv` names an environment variable
whose complete value becomes the `Authorization` header, such as `Bearer <token>`. The header is sent only to
`authenticatedOrigins`, which must also be allowed origins. Redirects are checked again before response bytes are
accepted. To prevent the manager token or unrelated service secrets from being reused, the name must be
`ROBOBOY_PANEL_AUTHORIZATION` or `ROBOBOY_PANEL_SOURCE_<NAME>_AUTHORIZATION`. Local root overrides are likewise
limited to `ROBOBOY_PANEL_WORKSPACE` or `ROBOBOY_PANEL_SOURCE_<NAME>_ROOT`. Keep actual secrets in an ignored,
deployment-specific environment file.

### Mix Published And Local Panels

Remote and local panels use the same source list and selection contract. Start from
`config/panel-sources.mixed.example.json`, list the local repository in its local source, and mount that repository
into the `panel-manager` service. Use `infra/compose/panels.yml` for this development workflow; it already supplies
`ROBOBOY_PANEL_WORKSPACE=/panel-workspace` and mounts the known reference repositories. This produces one registry,
detects duplicate IDs across source types, and records the winning source for every installed panel. Do not combine
the local and remote Compose overlays; choose one overlay and put all desired sources in its configuration.

The remote Docker overlay uses a deployment-owned named volume and does not mount panel repositories. With no
extra configuration it reads `config/panel-sources.official.json` and installs the official catalog:

```bash
ROBOBOY_PANEL_MANAGER_TOKEN='use-a-long-random-deployment-secret' \
docker compose -f docker-compose.yml -f infra/compose/panels.remote.yml build app panel-manager
docker compose -f docker-compose.yml -f infra/compose/panels.remote.yml up -d
```

To combine official and private inventories, create the ignored deployment-local configuration and secret files,
then point Compose at them:

```bash
cp config/panel-sources.example.json config/panel-sources.json
cp config/panel-secrets.example.env config/panel-secrets.env
# Edit both deployment-local files before continuing.

ROBOBOY_PANEL_SOURCES_FILE=./config/panel-sources.json \
ROBOBOY_PANEL_SECRETS_FILE=./config/panel-secrets.env \
docker compose -f docker-compose.yml -f infra/compose/panels.remote.yml build app panel-manager

ROBOBOY_PANEL_SOURCES_FILE=./config/panel-sources.json \
ROBOBOY_PANEL_SECRETS_FILE=./config/panel-secrets.env \
docker compose -f docker-compose.yml -f infra/compose/panels.remote.yml up -d
```

The first `up` starts the manager, seeds its private state volume, verifies the selected bundles, and only then
allows the app to start. Later changes go through authenticated preview/apply in the UI. The bearer token stays in
dialog memory, the manager stores only environment-variable names for inventory credentials, and a preview expires
after ten minutes. Apply re-resolves every source and rejects the plan if any verified bytes or metadata changed.

The installer validates compatibility metadata structurally. Robo-Boy applies its canonical SemVer compatibility
checks while reading the generated registry and refuses to expose incompatible releases in the workspace menu.

The current base Compose stack runs Vite, so the overlay mounts the volume at `/app/public/panels`. A deployment
using the production Nginx image sets `ROBOBOY_PANEL_WEB_ROOT=/usr/share/nginx/html/panels`. In both cases the
browser reads the same-origin `/panels/installed.json`; it never receives inventory credentials or imports a
cross-origin module.

An organization can therefore keep using an unmodified official Robo-Boy application image while privately
owning its panel source, build pipeline, HTTPS inventory, release storage, access policy, and desired-state selection.
It should build against a pinned panel SDK GitHub release, publish a browser-ready immutable ESM bundle, and use a
stable reverse-domain ID under a domain it controls. Neither private panel source nor an npm-registry publication
is required.

The official Hello, Time Series, and WebRTC examples are independently released from their panel repositories;
their source and bundles are not copied into Robo-Boy. The sibling directories remain convenient coordinated
development checkouts only. A production pipeline must verify inventory metadata and artifact hashes before
staging, then publish the complete Robo-Boy build atomically.

## Limitations And Expected Evolution

- Compose has authenticated preview/apply installation UI, but there is no scheduled update policy, rollback UI,
  publisher revocation service, or garbage collector yet. CLI staging remains available for builds and Tauri.
- The installer supports one ESM bundle per panel release. Manifests that declare additional assets are
  rejected until the inventory contract defines immutable URLs for each asset.
- Runtime entry points must be installed same-origin; arbitrary remote modules are rejected.
- Optional manifest icons/previews are catalog metadata only in this slice.
- Panel settings do not yet have a separate host UI; panels render their own settings inside their tile.
- ROS is intentionally a JSON message broker. Binary ROS payloads, actions, and streaming service responses are not
  in API v2.
- SHA-256 hashes detect artifact drift but do not establish publisher identity. Publisher signing, inventory
  review policy, rollback metadata, and revocation should precede installation from unreviewed catalogs.
- A sandboxed panel cannot mutate the parent page, but CPU-heavy synchronous code can still consume main-thread
  resources in its iframe. Per-panel CPU and bandwidth accounting remain future hardening.
- The sandbox is an access-minimization boundary, not a safe way to run arbitrary hostile code. A panel can use data
  explicitly granted to it and still has ordinary in-frame browser behavior. Install only reviewed artifacts; a
  fully untrusted marketplace would require a stronger process boundary and a declarative rendering contract.
