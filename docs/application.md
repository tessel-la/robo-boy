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
| Optional recordings  | `http://HOST:9091` |

Override the desktop direct-connect defaults with Vite environment variables when needed:

```bash
VITE_ROSBRIDGE_PORT=19090 VITE_VIDEO_STREAM_PORT=18080 VITE_MESH_RESOURCES_PORT=18000 VITE_RECORDINGS_PORT=19091 npm run desktop:dev
```

When the backend runs on another laptop, use the advanced connection box, select **Host or IP**, and enter that laptop's hostname, VPN DNS name, or IP. Desktop connects directly to rosbridge, video, and mesh services on that host.

The BT agent's Ollama provider also follows this selected backend host on port `11434` by default. In Agent
settings, clear **Use connected backend host** to enter a different Ollama URL. A remote Ollama server must
listen on its VPN or LAN interface rather than only `127.0.0.1`. If Ollama rejects the desktop webview's
origin, add `tauri://*,http://tauri.localhost,https://tauri.localhost` to `OLLAMA_ORIGINS`.

The packaged app asks for a host on its first launch and offers no default: it was served from nowhere, and its ROS stack is as likely to be on a robot as on the machine it runs on. Enter `localhost` when ROS runs on the same computer. Every host that connects is remembered, and the most recent one becomes what **Quick Connect** offers, so the question is asked once. The web app keeps offering the host that served the page.

Configure `ROS_DOMAIN_ID`, DDS middleware, and robot overlays on the ROS container; those settings are not owned by the frontend.

Desktop control sessions use the local account name when available. You can replace it in
**Session name**, and the app remembers that confirmed label. Web/mobile sessions keep a
generated label until you choose one. See [Shared robot control](robot-control.md#session-names)
for identity limits and the optional robot-side ROS control switch.

The existing `ros-stack` Compose service satisfies the local contract on its own. Neither Caddy nor the web
frontend is needed, so no certificate has to be created:

```bash
docker compose up -d --build ros-stack
```

URDF descriptions arrive over rosbridge; their mesh files, materials, and textures come from the
selected mesh server. Electron and Tauri (including mobile) fetch these assets through a dedicated
native `robot-resource` transport, so the mesh server does not need CORS headers. Mesh markers use
the same transport. Set the mesh port in the connection's service-port fields; `8000` is only the
default. Localhost, remote hosts, VPN addresses, IPv6, and custom ports follow the same path.

The transport only performs HTTP(S) GETs within the selected resource-server origin and path,
checks redirects against that scope, and sends no cookies or authorization headers. Assets on an
unrelated absolute URL keep using normal browser fetching and need that server's CORS support.
The web app continues to use `/mesh_resources` through Caddy, or ordinary CORS when configured to
connect directly. Other services such as Ollama retain their existing origin requirements.

Meshes are cached but checked on every load. The Electron transport asks the server with
`cache: 'no-cache'`, and Caddy marks `/mesh_resources` responses `Cache-Control: no-cache`, so an
unchanged mesh costs a 304 and a mesh replaced on the robot (another simulation, a new cell) is
downloaded the next time the 3D panel loads. This needs a mesh server that sends `ETag` or
`Last-Modified` and answers conditional requests; one that sends neither is downloaded in full each
time, as before. The Tauri transport does not cache.

If TF frames appear but the robot mesh does not, check asset requests as well as `/robot_description`:
a valid URDF can arrive while every OBJ/STL/DAE request fails. In older desktop builds, a missing
`Access-Control-Allow-Origin` response header causes exactly this symptom.

Validate the desktop asset path against a local fixture with no CORS headers (OBJ, MTL, textures,
STL, plus web-proxy parity) using `npm run test:robot-resources`. An optional read-only live check is:

```bash
ROBOBOY_TEST_ROSBRIDGE=ws://10.8.0.1:9090 \
ROBOBOY_TEST_MESH_BASE=http://10.8.0.1:8000 npm run test:robot-resources
```

Use the target connection's actual ports. The check subscribes to `/robot_description` and reads
assets; it does not publish robot commands. On headless Linux, run it under `xvfb-run -a`.

Panels that frame a robot page, such as a web viewer on the robot's port 8089, use the same-origin
path `/<port>/` beside their sandbox. In a browser the robot's Robo-Boy proxy serves that path and
publishes only the ports in `ROBOBOY_EMBED_PORTS`. The packaged app serves itself, so Electron gives
each connection's panel sandbox its own host, `app://embed-<id>/`, and forwards that host's
`/<port>/` requests to the connection's robot proxy at `https://<host>` (`VITE_EMBED_PROXY_PORT`,
default 443). The robot's allowlist still decides which ports are reachable, cookies are not
forwarded, and hosts the app did not register reach nothing. Tauri keeps the sandbox beside the app.

A robot that runs no Robo-Boy proxy can publish a service on its own port instead, listening on
all interfaces. Build the desktop app with `VITE_EMBED_DIRECT_PORTS` (for example `8089`, or a comma
separated list): each listed port's `/<port>/` frames are then fetched from `http://<host>:<port>/`
with the prefix stripped, and every other port is refused, so this list replaces the robot's
allowlist. The service is then reachable by anyone who can reach the robot, without TLS.

`npm run test:embed-proxy` checks the route against a local fixture. An optional read-only live
check frames a page on one of the robot's allowed ports and waits until `ROBOBOY_TEST_EMBED_SELECTOR`
(default `body`) renders content:

```bash
ROBOBOY_TEST_EMBED_BASE=https://robot.local ROBOBOY_TEST_EMBED_PATH=/8089/ npm run test:embed-proxy
```

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

The connected workspace is loaded on demand. Inactive mobile camera and 3D panels release their stream and renderer, and inactive TF trees unsubscribe until shown again.

A camera panel asks web_video_server for a smaller JPEG stream through its **Stream** preset, which
is saved with the tile. Full-size MJPEG is 20–80 Mbit/s for a 1080p camera, more than most remote
links carry, so frames queue on the robot and the picture lags by seconds.

| Preset   | Frame width                                              | JPEG quality      |
| -------- | -------------------------------------------------------- | ----------------- |
| Auto     | Fits the panel and screen density, up to 1920 (default)  | 60                |
| Low      | Up to 640                                                | 40                |
| Medium   | Up to 960                                                | 60                |
| High     | Up to 1920                                               | 80                |
| Original | The camera's own                                         | Server default    |

The panel reads the camera's frame size once per topic from a single low-quality `/snapshot`, because
web_video_server stretches the frame when given only a width. It never asks for more pixels than the
camera has, and Auto snaps to a few fixed widths so resizing a tile restarts the stream only rarely.
On a 1080p camera, Low is roughly a tenth of Original's bandwidth. High-rate TF visualization traffic uses CBOR with a bounded queue and update rate so stale transforms cannot build a main-thread backlog.

On machines where the GPU stack opens to a blank window or crashes, use the compatibility renderer:

```bash
ROBOBOY_DESKTOP_COMPATIBILITY_RENDERING=1 npm run desktop:dev
```

Compatibility mode disables WebKit's DMABUF renderer for that launch.

On Windows, the desktop webview keeps Wry's default disabled Edge UI features and adds GPU rasterization hints through `additionalBrowserArgs` in `src-tauri/tauri.conf.json`. Desktop devtools are disabled in the packaged webview config to keep the runtime closer to production performance.

## WebRTC On The Linux Desktop

The desktop shell renders in the system's WebKitGTK rather than a webview Robo-Boy ships, so whether
WebRTC exists at all is the distribution's build choice. Where it is compiled out there is no
`RTCPeerConnection`, and a panel that plays a WHEP stream fails on that missing reference rather than
on the network. Ubuntu 26.04 is one such distribution, in both its GTK3 (`webkit2gtk-4.1`) and GTK4
(`webkitgtk-6.0`) builds.

Check the host before assuming a stream problem is a stream problem:

```bash
strings "$(ldconfig -p | awk '/libwebkit2gtk-4.1.so.0/{print $NF; exit}')" | grep -qx webrtcbin && echo "WebRTC available" || echo "WebRTC not built into this WebKitGTK"
```

Installing GStreamer's WebRTC plugins does not change the answer. WebKitGTK negotiates through
GStreamer, so a host needs those elements *as well*, but when the engine was built without the
backend it never names them and no amount of plugins makes the API appear.

WebKitGTK also leaves `enable-webrtc` off by default, so the shell turns it on as the main window is
created. That is required wherever the backend is compiled in, and harmless where it is not.

The Electron shell sidesteps all of this by bundling Chromium -- see [The Electron Desktop
Shell](#the-electron-desktop-shell). Browsers carry their own WebRTC stack too, so the same panel
works in the web build on the same machine.
This is a WebKitGTK property, not a desktop one: the Windows, macOS, iOS and Android shells all use
engines with WebRTC compiled in.

A panel does not have to give up where it is missing. The stream gateway can publish the same H.264
over HLS -- `hls: true` in its configuration -- and Robo-Boy names that as the `webrtcHls` endpoint,
which a panel may declare alongside `webrtcWhep`. Every one of these engines has Media Source
Extensions even where it has no WebRTC, so a panel can feed the buffer itself and play the same
camera; the official WebRTC panel does exactly that when `RTCPeerConnection` is missing. Latency is
seconds rather than milliseconds, so it is a fallback and not the path to prefer.

One trap if you write such a panel: a panel's frame has an opaque origin, so the object URL a player
would normally make for its MediaSource comes back as `blob:null/...` and a media element refuses to
load it. Attach the source with `srcObject` instead, which needs no URL. The camera view avoids all
of this by reading the MJPEG endpoint, which needs neither WebRTC nor Media Source Extensions.

## The Electron Desktop Shell

Everything above describes the Tauri shell, which draws the app in whatever web view the operating
system provides. On Linux that is WebKitGTK, with the consequences the previous section sets out:
where the distribution compiled WebRTC out, the video panels fall back to HLS and the operator
watches the robot seconds late.

The Electron shell exists for that case. It bundles Chromium, so a packaged desktop app has the
same WebRTC stack a browser does and the HLS fallback stays unused. It renders the identical React
tree -- there is no second frontend -- and differs only in what draws it.

The secure `app://` origin keeps WebRTC available when a robot gateway uses plain HTTP. For
self-signed HTTPS and `wss`, Electron accepts certificates on private IPv4 addresses (RFC 1918,
VPN shared address space `100.64.0.0/10`), loopback, link-local, IPv6 unique-local addresses,
and `.local` / `.localhost` names. Use one of these addresses for a robot with a self-signed
certificate; other DNS names and public IP addresses need a normally trusted certificate.
Public hosts retain Chromium's certificate checks. Panel inventory, manifest and bundle downloads
use Node's certificate-checked fetch, with HTTPS and the GitHub host allowlist enforced on every
redirect, independently of these robot exceptions.

Which shell to use:

| | Tauri | Electron |
| --- | --- | --- |
| Download size | ~10 MB | ~100 MB |
| WebRTC on Linux | Whatever the distribution built | Always, bundled |
| iPhone and Android | Yes | Not supported |

Tauri remains the shell for mobile, where bundling a browser is not an option, and the better choice
on any desktop whose web view does speak WebRTC. Reach for Electron when the video panels matter
more than the download.

### Development

```bash
npm run dev:electron
```

Vite starts first and the window waits for it, so the shell never opens against a server that is not
listening yet. Closing the window stops both.

### Build an installer

```bash
npm run package:electron
```

Installers are written to `release/`. Linux produces a `.deb`, Windows an NSIS
installer, macOS a `.dmg`; as with Tauri, each operating system builds and signs its own.

Local packaging defaults to the host architecture. Official CI builds three Electron packages: a
`.deb` for **x86_64 (AMD64)** and for **ARM64** Linux, and a `.dmg` for **Apple Silicon** Macs (M1
and later). Release Please also publishes a stable copy of each for permanent download links:

| System | Package |
| --- | --- |
| Linux x86_64 / AMD64 | `Robo-Boy-linux-amd64-electron.deb` |
| Linux ARM64 | `Robo-Boy-linux-arm64-electron.deb` |
| macOS, Apple Silicon | `Robo-Boy-macos-arm64-electron.dmg` |

The versioned files and stable copies contain the same packages. AMD64 and x86_64 name the same
64-bit architecture; neither is a 32-bit x86 build. Intel Macs use the universal Tauri disk image;
Tauri installers are published separately.

The Mac app is ad-hoc signed, not notarized: signing with a Developer ID needs an Apple account. The
first time it is opened from a download, macOS says it cannot check it; open it from **System
Settings → Privacy & Security → Open Anyway** (or Control-click it and choose **Open**). Updates
installed from inside the app do not ask again.

`npm run build:electron` stops after producing the unpackaged app under `dist-electron/`, which is
what `dev:electron` and the smoke checks use.

### How the shell reaches the app

The renderer runs with context isolation and no Node integration, because a panel is third-party
code the operator installed. The one channel across is the preload bridge at
`electron/preload.ts`, exposed as `window.roboBoyDesktop`, and the app finds it through
`src/runtime/desktopBridge.ts`. It carries two things:

- **The window.** The app draws its own title bar in both shells, so it needs to minimise, maximise
  and close the real window. Chromium resizes a frameless window from CSS rather than from the
  renderer, so the resize edges the app paints for Tauri are hidden here and the compositor does the
  work.
- **Panel installation.** Release assets carry no CORS headers, so neither shell can fetch them from
  the renderer. Tauri uses its HTTP capability; Electron fetches in the main process, which is
  outside CORS enforcement and therefore limited to an explicit list of hosts. Bytes are still
  checked against the origins the source allows and the SHA-256 the inventory and manifest publish.

The packaged renderer is served from `app://robo-boy`, not from disk. This is not a detail: Chromium
gives every `file://` document an opaque origin, so `location.origin` reports `file://` while the
origin arriving on a message event is `null`, and anything that compares the two disagrees with
itself. The panel sandbox does compare them -- the host names the origin it will talk to, the
sandbox checks messages against that name -- so under `file://` it discarded every probe and
reported that it never started. A scheme registered as standard has a real origin and the packaged
app behaves as the same code does over http. Tauri solves this the same way, with
`tauri://localhost`.

`isDesktopRuntime()` is true under either shell. Stylesheets tell them apart through
`data-runtime`, which names the shell, and `data-desktop`, which only says the app is in a packaged
window; the rules working around WebKitGTK stay keyed to the former so Chromium does not inherit
them.

## Build An Installer

That is the local equivalent of what CI runs for a release. Official installers for Linux, macOS, and
Windows are built and attached to the GitHub Release automatically; see
[Releases](development.md#desktop-installers).

```bash
npm run desktop:build
```

Installers are written below `src-tauri/target/release/bundle/`. Building installers does not build or package the ROS image. Each target operating system should build and sign its own artifacts.

## Updates

A packaged desktop app keeps itself up to date. A few seconds after launch, and every six hours, it
looks for a newer `robo-boy-v*` release (the Panel SDK's releases share the repository and are
ignored). When there is one, a card in the bottom-left corner shows the version, its release notes,
and whether it also changes the ROS stack. **Update and restart** downloads the installer this copy
was installed from, with progress, installs it and opens the new version. **Later** keeps the offer
in the connection menu, where **Robo-Boy** also checks on request; **Skip this version** stays quiet
until a newer one appears.

| Installation                 | Installer                            | How it is installed                                               |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| Linux, Electron `.deb`       | `Robo-Boy-linux-{amd64,arm64}-electron.deb` | `pkexec apt-get install`: the system asks for the password |
| Linux, Tauri `.deb` / `.rpm` | `Robo-Boy-linux-amd64.deb`, `Robo-Boy-linux-x86_64.rpm` | `pkexec apt-get install` / `pkexec dnf install` |
| Windows                      | `Robo-Boy-windows-x64-setup.exe`     | The NSIS installer in passive mode, which reopens the app         |
| macOS                        | `Robo-Boy-macos-universal.dmg`       | The app bundle is replaced from the disk image, then reopened     |
| macOS, Electron (Apple Silicon) | `Robo-Boy-macos-arm64-electron.dmg` | The app bundle is replaced from the disk image, then reopened  |

Everything that has to be trusted happens in the desktop shell, never in the page: the shell looks
the release up on GitHub over its own certificate-checked connection, downloads the installer only
from GitHub's hosts, and installs it only if its size and SHA-256 match what GitHub publishes for
that release asset. Nothing needs to be signed or configured in CI. If installing in place is not
possible (the password prompt is dismissed, no `pkexec`, the app cannot replace its bundle), the
card says why and offers **Open installer**, which hands the checked file to the system's own
installer. Development builds, the web app and the phone apps do not update themselves.

When a release changes what runs on the ROS host (`infra/ros`, the ROS and Caddy images, the
Compose files or the DDS configuration), the offer says so, and after the restart the app shows the
command to bring the ROS host up to date, to run in its `robo-boy` checkout:

```bash
git pull && docker compose up -d --build
```

The app never touches the ROS host itself; the reminder stays until it is marked done.

## Web And Mobile

The web build uses same-origin Caddy routes (`/websocket`, `/video_stream`, and `/mesh_resources`) for proxy-backed connections and can use direct backend host URLs when the advanced host connection points at another machine. Runtime endpoint selection lives in `src/runtime/runtimeConfig.tsx`.

The iOS shell uses that same direct, remote-host contract, so no feature code is forked for it. Only the chrome differs: a phone draws its own bars around the app and has no window controls, so `drawsOwnWindowChrome()` keeps the title bar out of it. See [iOS application](ios.md) for building and installing.
