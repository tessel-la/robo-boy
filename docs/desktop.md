# Desktop Application

Robo-Boy's desktop application is a thin Tauri shell around the same React application used by the web deployment. It does not bundle, install, start, or stop ROS. Run the ROS stack separately on the local computer or on a reachable robot computer.

## Runtime Contract

The desktop frontend connects directly to these services on the selected ROS host:

| Service | Default endpoint |
| --- | --- |
| rosbridge | `ws://HOST:9090` |
| web_video_server | `http://HOST:8080` |
| Optional mesh server | `http://HOST:8000` |

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

## Build An Installer

```bash
npm run desktop:build
```

Installers are written below `src-tauri/target/release/bundle/`. Building installers does not build or package the ROS image. Each target operating system should build and sign its own artifacts.

## Web And Future Mobile

The web build continues to use same-origin Caddy routes (`/websocket`, `/video_stream`, and `/mesh_resources`). Runtime endpoint selection lives in `src/runtime/runtimeConfig.tsx`; future Tauri mobile targets can use the same direct, remote-host contract as desktop without forking feature code.
