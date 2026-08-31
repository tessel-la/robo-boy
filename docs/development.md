# Development Guide

## Prerequisites

- Node.js 20 or newer
- npm
- Docker with Docker Compose for the complete ROS and proxy stack
- mkcert for trusted local HTTPS

## Frontend Only

Install dependencies and start Vite:

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`. The frontend can load without Docker, but ROS, video, and mesh proxy routes require compatible services or test mocks.

Set `FRONTEND_PORT` to use a different local Vite port:

```bash
FRONTEND_PORT=3000 npm run dev
```

## Complete Development Stack

Generate the certificate as described in the root README, select a Compose configuration, and start the stack:

```bash
cp config/env/no-overlay.env.example .env
docker compose up -d --build
```

The stack starts:

- `app`: Vite development server with source mounted for hot reload.
- `ros-stack`: ROS 2, rosapi, rosbridge, and `web_video_server` on the host network.
- `caddy`: HTTP/HTTPS entry point and reverse proxy.
- `ollama-relay`: transport-only adapter from Caddy's Unix socket to the configured external Ollama API.
- `webrtc-relay`: host-network adapter from Caddy's Unix socket to MediaMTX's WHEP signaling API.
- Ollama is external to the Compose stack and is reached through the same-origin `/ollama` proxy.

Changes under `src/` should hot reload. Rebuild after changing files under `infra/`, Compose files, or ROS dependencies:

```bash
docker compose up -d --build --force-recreate
```

The default ports are defined in the copied `.env` file. The main knobs are:

| Variable                        | Default                  | Used by                                                    |
| ------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `FRONTEND_PORT`                 | `5173`                   | Vite dev server and Caddy frontend upstream                |
| `HTTP_PORT`                     | `80`                     | Caddy HTTP listener                                        |
| `HTTPS_PORT`                    | `443`                    | Caddy HTTPS and HTTP/3 listener                            |
| `BACKEND_HOST`                  | `host.docker.internal`   | Caddy upstream host for ROS services                       |
| `ROSBRIDGE_PORT`                | `9090`                   | rosbridge and Caddy `/websocket` upstream                  |
| `VIDEO_STREAM_PORT`             | `8080`                   | `web_video_server` and Caddy `/video_stream` upstream      |
| `WEBRTC_BACKEND_URL`            | `http://127.0.0.1:8889`  | Host-network MediaMTX WHEP endpoint used by the relay      |
| `WEBRTC_DISCOVERY_BACKEND_URL`  | `http://127.0.0.1:9997`  | Loopback MediaMTX API used only for active-path discovery  |
| `MESH_RESOURCES_PORT`           | `8000`                   | Caddy `/mesh_resources` upstream                           |
| `OLLAMA_BACKEND_URL`            | `http://127.0.0.1:11434` | Optional external Ollama API used by the same-origin relay |
| `OLLAMA_PORT`                   | `11434`                  | Desktop direct-connect Ollama port                         |
| `OLLAMA_PROXY_TARGET`           | `http://127.0.0.1:11434` | Frontend-only Vite `/ollama` upstream                      |
| `WEBRTC_PROXY_TARGET`           | `http://127.0.0.1:8889`  | Frontend-only Vite `/webrtc` WHEP upstream                 |
| `WEBRTC_DISCOVERY_PROXY_TARGET` | `http://127.0.0.1:9997`  | Frontend-only Vite active-path discovery upstream          |
| `VITE_ROSBRIDGE_PORT`           | `9090`                   | Desktop direct-connect rosbridge URL                       |
| `VITE_VIDEO_STREAM_PORT`        | `8080`                   | Desktop direct-connect video URL                           |
| `VITE_MESH_RESOURCES_PORT`      | `8000`                   | Desktop direct-connect mesh URL                            |
| `VITE_OLLAMA_PORT`              | `11434`                  | Desktop direct-connect Ollama URL                          |
| `VITE_WEB_BACKEND_MODE`         | `auto`                   | `auto`, `proxy`, or `direct` for web IP connections        |

For a frontend/proxy laptop talking to a backend laptop, set `BACKEND_HOST` to the backend laptop's hostname or IP before starting Caddy:

```bash
BACKEND_HOST=192.168.1.20 docker compose up -d --build app caddy
```

Ollama remains external to Robo Boy. The application does not start Ollama or control its bind address,
origins, models, or networking. The browser provider uses `/ollama` so discovery and generation remain
same-origin. A transport-only relay connects that route to `OLLAMA_BACKEND_URL`, which can be any Ollama API
reachable from the Docker host. The default supports a same-machine Ollama without exposing it to Docker or
the network.
The Tauri app uses the host selected on the connection screen (including VPN hostnames and IPs) with
`VITE_OLLAMA_PORT`. Set `OLLAMA_HOST=0.0.0.0:11434` on the Ollama machine, or bind it specifically to the
VPN interface, so remote desktop clients can reach it. If a desktop webview receives
a CORS rejection, include `tauri://*,http://tauri.localhost,https://tauri.localhost` in `OLLAMA_ORIGINS`.

In the browser app, Quick Connect and Domain ID use the Caddy proxy. The advanced Host or IP field accepts any hostname, DNS name, VPN name, IPv4 address, IPv6 address, or URL that resolves from the client machine. The Ports fields control rosbridge, video, and mesh ports for direct host connections and default to the matching `VITE_*_PORT` values. It connects directly to that host in `auto` mode when it differs from the frontend host. Use `VITE_WEB_BACKEND_MODE=proxy` to force all browser connections through Caddy.

The optional camera gateway is reached through the same-origin `/webrtc` route for WHEP signaling. Caddy reaches
host-network MediaMTX through `webrtc-relay` and a shared Unix socket, avoiding Docker host-gateway firewall
differences. Its ICE media port is negotiated by WebRTC and must be reachable directly from clients (the Genesis
gateway uses UDP `8189`). RTSP remains a direct gateway service on port `8554` for native clients; browsers use
WHEP/WebRTC instead.
The gateway control API stays bound to host loopback. The relay exposes only `GET /webrtc/_discovery/paths`,
which maps to MediaMTX's active-path listing; configuration and mutation endpoints are not proxied.

Normal development discovers an empty tracked registry at `public/panels/installed.json`. Run
`npm run dev:panels` to verify and stage the local repositories selected by
`config/panel-sources.local.json` into the ignored `.panel-stage/` tree. Pass
`-- --config config/panel-sources.json` to use an ignored custom or mixed desired-state file. Schema-v2 selection is
explicit: `all`, a non-empty `include` list, or `none`. Set `VITE_PANEL_REGISTRY_URL` to use another same-origin
installed-registry path. Panel modules remain unloaded until their workspace tiles mount. See
[External panels](external-panels.md#create-install-and-register-a-panel) for the complete standalone repository,
SDK, integrity, desired-state, host-development, and Docker-development workflow.

For the Docker development stack, opt in with the panel Compose overlay:

```bash
export ROBOBOY_PANEL_MANAGER_TOKEN='use-a-long-random-development-secret'
docker compose -f docker-compose.yml -f infra/compose/panels.yml build app
docker compose -f docker-compose.yml -f infra/compose/panels.yml up -d
```

The overlay mounts the known sibling panel repositories read-only and starts the panel manager. On first startup it
seeds private desired state from `config/panel-sources.local.json`, verifies the selection, and populates the shared
panel volume before the app starts. Both overlays mount that volume read-only into the app. Set
`ROBOBOY_PANEL_MANAGER_TOKEN`, open **Manage installations…** in the workspace add menu, and use preview/apply to
select a subset, install none, add another mounted local repository, or mix local and remote sources.
`ROBOBOY_PANEL_SOURCES_FILE` changes only the initial seed for a new manager-state volume.
`ROBOBOY_PANEL_IDS` is no longer used by this overlay; migrate any existing value into the configuration's explicit
`selection` object.

This is a developer convenience only. For published official or private releases, use
`infra/compose/panels.remote.yml`. The remote overlay defaults to `config/panel-sources.official.json`, mounts no
panel repositories, and has its manager populate a named volume from configured HTTPS inventories. A deployment
can select a private configuration with `ROBOBOY_PANEL_SOURCES_FILE`. See
[External panels](external-panels.md#remote-inventories-and-private-panels) for configuration, subset selection,
and credential handling.

The Tessella Dashboard starts existing images with `docker compose up -d --no-build`. Its Robo-Boy catalog entry
selects `docker-compose.yml` and `infra/compose/panels.remote.yml` through a per-application `composeFiles` setting,
so stopping and starting Robo-Boy from the dashboard starts the release manager before the application. Keep
`COMPOSE_FILE=docker-compose.yml` in Robo-Boy's shared `.env`: simulators consume that file for ROS/DDS settings,
and putting the panel overlay there would incorrectly apply it relative to every simulator project.

The Vite configuration pins React and ReactDOM to the project-root copies and pre-optimizes the external-panel
registry's `semver` dependency. Keep those settings when adding lazy entry points: discovering a new CommonJS
dependency during the connection transition can otherwise invalidate Vite's development dependency graph while
React is mounting the workspace.

If the frontend is opened over HTTPS, direct browser connections use `wss://` and `https://` backend URLs. For a plain ROS backend, use the HTTP frontend URL or set `VITE_WEB_BACKEND_MODE=proxy` with `BACKEND_HOST`.

## Desktop Frontend

The Tauri application packages only the frontend and expects the ROS stack to run separately. After installing the Tauri platform prerequisites and Rust, start it with:

```bash
docker compose up -d --build ros-stack
npm run desktop:dev
```

See [Desktop application](desktop.md) for the port contract and installer build command.

## Useful Commands

```bash
npm run build
npm run lint
npm run format:check
npm run test:run
npm run test:coverage
npm run e2e
```

Set `ROBOBOY_DIST_DIR` when build artifacts need to be written outside the default `dist/` directory. The web and
Tauri Vite builds honor it, and the Tauri post-build module check validates the same directory.

`npm run e2e` starts its own Vite server. To test an already-running Docker/Caddy stack, use:

```bash
npm run e2e:stack
```

## Logs And Shutdown

```bash
docker compose logs -f app
docker compose logs -f caddy
docker compose logs -f ros-stack
docker compose down
```

Use `docker compose down -v` only when the Caddy data and configuration volumes should also be removed.

## Testing Strategy

- Vitest and Testing Library cover components, hooks, storage, message conversion, behavior-tree logic, and ROS/3D adapters with mocks.
- Playwright covers browser navigation and complete user flows.
- Tests live beside source files unless they exercise the complete application, in which case they belong in `e2e/`.
- Add focused tests with behavior changes. Use end-to-end coverage when a change crosses the application shell, browser APIs, proxy paths, or several feature modules.

## Before Opening A Change

Run the checks relevant to the modified area. For broad changes, use:

```bash
npm run lint
npm run test:run
npm run build
npm run e2e
```

## Releases

Feature pull requests target `dev`. The only development promotion into `main` should be a pull request from `dev`; feature branches should not target `main` directly.

Official releases are created from `main` only. After `dev` is promoted into `main`, the Release Please workflow scans the commits on `main` and creates or updates a release pull request.

Do not create official releases directly from `dev`.

Release Please uses Conventional Commits to choose the next SemVer version:

| Commit message                             | Release type |
| ------------------------------------------ | ------------ |
| `fix: correct login redirect`              | Patch        |
| `feat: add export endpoint`                | Minor        |
| `feat!: change public API response format` | Major        |

Breaking changes can also be marked with a `BREAKING CHANGE:` footer in the commit body. Commits such as `docs:`, `test:`, `chore:`, and `refactor:` can appear in history, but they do not create a release by themselves unless they include a breaking-change marker.

When the Release Please pull request is merged into `main`, the workflow creates the Git tag and GitHub Release, and updates the package version and `CHANGELOG.md` as part of the release pull request.

Every push to `main`, including a development promotion or merged Release Please pull request, runs the `Sync main to dev` workflow. It merges `main` back into `dev` so release versions and changelog updates remain in both branches. If that workflow reports a merge conflict, reconcile `main` into a branch based on the latest `dev` and merge that fix before the next promotion.
