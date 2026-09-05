# Application

Robo-Boy's packaged application is a thin Tauri shell around the same React application used by the web deployment. It runs on Linux, macOS, Windows and iPhone, and the runtime contract below is the same on all of them. It does not bundle, install, start, or stop ROS. Run the ROS stack separately on the local computer or on a reachable robot computer.

Everything past the runtime contract is about the desktop build. See [iOS application](ios.md) for building, signing and installing on a phone.

## Runtime Contract

The desktop frontend connects directly to these services on the selected ROS host:

| Service              | Default endpoint   |
| -------------------- | ------------------ |
| rosbridge            | `ws://HOST:9090`   |
| web_video_server     | `http://HOST:8080` |
| Optional mesh server | `http://HOST:8000` |
| WebRTC gateway       | `http://HOST:8889` |
| Gateway discovery    | `http://HOST:9997` |

Override the desktop direct-connect defaults with Vite environment variables when needed:

```bash
VITE_ROSBRIDGE_PORT=19090 VITE_VIDEO_STREAM_PORT=18080 VITE_MESH_RESOURCES_PORT=18000 npm run desktop:dev
```

When the backend runs on another laptop, use the advanced connection box, select **Host or IP**, and enter that laptop's hostname, VPN DNS name, or IP. Desktop connects directly to rosbridge, video, and mesh services on that host.

The BT agent's Ollama provider also follows this selected backend host on port `11434` by default. In Agent
settings, clear **Use connected backend host** to enter a different Ollama URL. A remote Ollama server must
listen on its VPN or LAN interface rather than only `127.0.0.1`. If Ollama rejects the desktop webview's
origin, add `tauri://*,http://tauri.localhost,https://tauri.localhost` to `OLLAMA_ORIGINS`.

The packaged app asks for a host on its first launch and offers no default: it was served from nowhere, and its ROS stack is as likely to be on a robot as on the machine it runs on. Enter `localhost` when ROS runs on the same computer. Every host that connects is remembered, and the most recent one becomes what **Quick Connect** offers, so the question is asked once. The web app keeps offering the host that served the page.

Configure `ROS_DOMAIN_ID`, DDS middleware, and robot overlays on the ROS container; those settings are not owned by the frontend.

The existing `ros-stack` Compose service satisfies the local contract on its own. Neither Caddy nor the web
frontend is needed, so no certificate has to be created:

```bash
docker compose up -d --build ros-stack
```

The optional mesh server must allow cross-origin requests when the desktop app loads URDF meshes directly from port 8000.

## WebRTC Gateway

`webrtc-gateway` is a MediaMTX beside the ROS stack rather than inside it. The two start together and stop
independently, so video can be running with nothing else up, and the ROS stack can run with no gateway at all.

It binds its WHEP and API ports on every interface, so the desktop app reaches it directly and needs no proxy in
front. Open 8889 and 9997 to the clients that use them, and 8554 for anything publishing RTSP into it. A browser
cannot reach those ports from an HTTPS page, so the web deployment keeps going through Caddy's same-origin
`/webrtc` route instead; both paths end at this one gateway.

By default it re-encodes one MJPEG topic from the ROS stack, on demand, so nothing transcodes until somebody
watches. Point it elsewhere with `WEBRTC_SOURCE_TOPIC`, or publish RTSP into any other path name and it appears
in discovery by itself.

A simulator that runs its own gateway binds the same ports, so only one of them can be up at a time.

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

That is the local equivalent of what CI runs for a release. Official installers for Linux, macOS, and
Windows are built and attached to the GitHub Release automatically; see
[Releases](development.md#desktop-installers).

```bash
npm run desktop:build
```

Installers are written below `src-tauri/target/release/bundle/`. Building installers does not build or package the ROS image. Each target operating system should build and sign its own artifacts.

## Web And Mobile

The web build uses same-origin Caddy routes (`/websocket`, `/video_stream`, and `/mesh_resources`) for proxy-backed connections and can use direct backend host URLs when the advanced host connection points at another machine. Runtime endpoint selection lives in `src/runtime/runtimeConfig.tsx`.

The iOS shell uses that same direct, remote-host contract, so no feature code is forked for it. Only the chrome differs: a phone draws its own bars around the app and has no window controls, so `drawsOwnWindowChrome()` keeps the title bar out of it. See [iOS application](ios.md) for building and installing.
