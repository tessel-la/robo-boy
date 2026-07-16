# Desktop Application

Robo-Boy's desktop application is a thin Tauri shell around the same React application used by the web deployment. It does not bundle, install, start, or stop ROS. Run the ROS stack separately on the local computer or on a reachable robot computer.

## Runtime Contract

The desktop frontend connects directly to these services on the selected ROS host:

| Service | Default endpoint |
| --- | --- |
| rosbridge | `ws://HOST:9090` |
| web_video_server | `http://HOST:8080` |
| Optional mesh server | `http://HOST:8000` |

Override the desktop direct-connect defaults with Vite environment variables when needed:

```bash
VITE_ROSBRIDGE_PORT=19090 VITE_VIDEO_STREAM_PORT=18080 VITE_MESH_RESOURCES_PORT=18000 npm run desktop:dev
```

Quick Connect uses `localhost`. To connect to another computer, open the advanced connection options, select **IP Address**, and enter its hostname or IP address. Configure `ROS_DOMAIN_ID`, DDS middleware, and robot overlays on the ROS container; those settings are not owned by the frontend.

The existing `ros-stack` Compose service satisfies the local contract:

```bash
cp config/env/no-overlay.env.example .env
docker compose up -d --build ros-stack
```

The optional mesh server must allow cross-origin requests when the desktop app loads URDF meshes directly from port 8000.

## Development

Install the standard Tauri v2 prerequisites for the host operating system, including Rust and the platform webview development packages. Then run:

```bash
npm ci
npm run desktop:dev
```

The command starts Vite in Tauri mode and opens the native window. Tauri mode omits the PWA service worker; normal web builds continue to include it.

### Production build parity

Tauri development and production both execute Vite's frontend entry as an ES module. Do not convert the generated `type="module"` script to a classic deferred script: production code splitting emits module imports and exports that classic scripts cannot parse.

`npm run build:tauri` runs a post-build check that verifies the module entry and every directly referenced lazy chunk. A failed check means the generated desktop frontend is not safe to package.

## Desktop Rendering Performance

The Linux desktop shell uses WebKitGTK. Robo-Boy uses WebKit's accelerated DMABUF renderer by default so desktop rendering stays as close as possible to the browser.

The connected workspace is loaded on demand. Inactive mobile camera and 3D panels release their stream and renderer, and inactive TF trees unsubscribe until shown again. High-rate TF visualization traffic uses CBOR with a bounded queue and update rate so stale transforms cannot build a main-thread backlog.

On machines where the GPU stack opens to a blank window or crashes, use the compatibility renderer:

```bash
ROBOBOY_DESKTOP_COMPATIBILITY_RENDERING=1 npm run desktop:dev
```

Compatibility mode disables WebKit's DMABUF renderer for that launch.

On Windows, the desktop webview keeps Wry's default disabled Edge UI features and adds GPU rasterization hints through `additionalBrowserArgs` in `src-tauri/tauri.conf.json`. Desktop devtools are disabled in the packaged webview config to keep the runtime closer to production performance.

## Build An Installer

```bash
npm run desktop:build
```

Installers are written below `src-tauri/target/release/bundle/`. Building installers does not build or package the ROS image. Each target operating system should build and sign its own artifacts.

## Web And Future Mobile

The web build continues to use same-origin Caddy routes (`/websocket`, `/video_stream`, and `/mesh_resources`). Runtime endpoint selection lives in `src/runtime/runtimeConfig.tsx`; future Tauri mobile targets can use the same direct, remote-host contract as desktop without forking feature code.
