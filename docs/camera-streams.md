# Shared camera streams

The built-in Camera panel defaults to Camera streamer (shared MJPEG where supported). Open the **Camera** menu for **Image source**, stream quality, and connection settings. The source selector also offers explicit ROS messages and WebRTC choices. WebRTC connection settings offer gateway discovery or a manual WHEP URL and are saved with each workspace panel. In **3D → Settings → Visualizations**, in the Camera image layer's settings, **Image source** defaults to **Camera streamer**, using the same transport. Explicitly saved **ROS image messages** choices are preserved. Stream quality is selected independently; matching effective URLs share a connection even if the preset names differ.

## Ownership and performance

- `utils/images/mjpegStreams.ts` owns one HTTP reader and decoder per ROS connection identity and canonical stream URL. URL parameters include topic, format, dimensions and quality. Refresh tokens do not create a separate identity; refresh reconnects all compatible consumers.
- Decoding keeps one in-flight frame and one newest pending JPEG. Slow decoding drops intermediate frames instead of building latency. A multipart part is bounded to 64 MiB and headers to 8 KiB. Existing decoded image dimension and pixel limits still apply.
- `SharedImageFrame` is the common ROS/MJPEG consumer boundary. Callbacks borrow a frame until replacement; asynchronous or held consumers call `retain()` and release the returned lease when finished. Consumers never close shared bitmaps themselves. Synchronous callbacks must stay short; heavy future consumers should sample or schedule work and retain only bounded frames.
- Camera draws at the available source/decoder rate. `cameraProjectionSource.ts` samples only the 3D consumer at the configured projection rate (10 fps by default; 5/10/15/30/60 fps or Source frame rate). The control is in the camera layer settings and applies to streamed video. ROS image decoding retains its existing source policy. Calibration and TF remain in `CameraImageClient`; waiting for them cannot pause Camera. 3D retains its last complete pixels/calibration/pose snapshot while a new one waits for TF.
- Removing a consumer leaves the others running. The final unsubscribe aborts the HTTP reader and releases cached/late decoded frames. Connection identity isolates different robots and replay sessions. Idle streams fail after 10 seconds; Camera refresh retries them.

This scales acquisition/decoding by unique stream profiles rather than panel count. Every view still pays for drawing, and each WebGL renderer owns its texture/GPU upload. Different quality/resolution profiles intentionally open separate streams; there is no implicit quality downgrade or global frame-rate cap. A 3D-only streamer downloads source-rate MJPEG even when projection samples fewer frames. ROS image messages remain an alternative.

Native MJPEG playback avoids the JavaScript multipart/bitmap/canvas path and can cost less main-thread time for one Camera. Shared playback trades that overhead for reusable frames and eliminating compatible duplicate image downloads/decodes. See [performance measurements](performance.md). High-resolution/many-camera performance must be measured on the target device; this change does not claim worker or GPU zero-copy decoding.

Shared readers request `Accept: multipart/mixed`. The ROS image's streamer returns that readable multipart type; native image requests retain `multipart/x-mixed-replace` with identical JPEG bytes. WebKit (Safari and Tauri) rejects the latter through fetch even when native Camera playback succeeds. Rebuild the ROS image for shared Camera/3D streaming on WebKit. Older streamers remain compatible with browsers that can read their response type.

Future in-app consumers can subscribe to the same frame events and leases. `webrtcStreams.ts` owns one WHEP peer/session per ROS connection identity and selected URL. Native Camera playback uses the shared MediaStream. A video/bitmap capture path exists only while 3D consumers need it; it follows the highest requested projection rate and shares bitmaps. A 3D-only API failure does not stop native Camera playback. The final consumer closes the peer and DELETEs its WHEP session. WebRTC supports plain standard WHEP streams without custom ROS metadata; arbitrary proprietary signaling requires an adapter. WebRTC capture-time synchronization is deferred. External sandboxed panels do not share these in-process bitmaps. The transport does not own TF, replay clocks, or consumer UI.

## ROS metadata and compatibility

Upstream `web_video_server` multipart `X-Timestamp` is steady-clock receipt time, **not the ROS acquisition stamp**. It must not be used to query TF. Robo-Boy's pinned upstream overlay adds a JPEG APP15 segment; ordinary JPEG/MJPEG clients ignore it. It carries the original image header and full input dimensions, before full-frame resizing. The frontend uses these dimensions with CameraInfo, so reduced stream resolution preserves the calibrated field of view.

All integers are big-endian. Immediately after JPEG SOI (`FF D8`), the producer writes:

| Field | Bytes |
| --- | --- |
| APP15 marker `FF EF` | 2 |
| Segment length, including the length field | 2; value `26 + frame_id UTF-8 byte count` |
| Version signature `RBROS001` | 8 |
| Original ROS seconds, nanoseconds | 4 each |
| Original source width, height | 4 each |
| Original optical frame ID, UTF-8 | 1–512 |

Negative seconds, nanoseconds outside `[0, 1e9)`, empty/control-character frame IDs, missing dimensions, and inverted images are not tagged. The frontend validates the segment before using it. Cropping, inversion and pixel rotation require an explicit pixel transform and are unsupported for streamer projection.

Old/custom streamers without acquisition metadata play in Camera and support **Latest TF** projection. New camera layers explicitly start with Latest TF; existing saved layers without the new timing field retain their capture-time behavior. Latest TF resolves the selected CameraInfo optical frame (or an explicit frame override), uses the most recent transform, and displays a persistent **not time-synchronized** status. Video latency can produce motion misalignment. Calibration must describe the selected stream's pixels, ROI/binning and distortion; cropping/rotation or a different resolution needs matching calibration. Robo-Boy does not infer which arbitrary stream belongs to a ROS camera.

For MJPEG, selecting **Capture time** requires valid embedded acquisition metadata. Missing metadata is reported visibly; there is no automatic timing/transport fallback. ROS image messages use their standard headers. WebRTC uses Latest TF only in this increment and needs no metadata topic or stream-ID extension. Adding arbitrary metadata to a WebRTC publisher does not automatically enable capture-time matching. The non-WebRTC metadata producer and parser remain unchanged.

Camera source/quality controls and 3D source/calibration/timing/rate controls are independent. Changing 3D rate does not change Camera's requested playback rate. Higher rates add bitmap/GPU work and can compete for device resources. 3D retains complete image/pose snapshots while waiting for TF, independently of the sampling rate. Refresh Camera to retry a failed WebRTC session; changing/removing a 3D source also releases its subscription. No silent ROS/HLS fallback is performed. Replay always bypasses live MJPEG and WHEP endpoints, including saved WebRTC choices. The existing external WebRTC panel is unchanged and does not share in-process sessions with built-in panels.

## Metric depth

Select ROS messages in Camera or Depth points (ROS) in a 3D Camera image layer. Both consumers share the exact depth topic’s decoder and metric frame, including during replay. 16UC1 is millimetres and 32FC1 is metres. compressedDepth PNG retains the full 16-bit payload and applies the transport’s inverse-depth quantization for 32FC1. PNG dimensions, chunk bounds/CRCs, decompressed size and quantization are validated before use; RVL is unsupported. MJPEG/WebRTC carry display pixels and cannot supply metric geometry.

Camera shows a fixed 0–10 m preview plus a pointer/touch/keyboard pixel measurement. 3D uses the existing CameraInfo/TF rules and bounds geometry to 100,000 regularly sampled points, with configurable range and point size. Missing TF/calibration holds the last complete snapshot; malformed data clears it. Mono16 is still an intensity image. See the [user guide](user-guide.md) for controls and limits.

## Deployment and validation

### Remote connections

Web Quick Connect uses the page's same-origin `/webrtc/` proxy, including when the
page is opened through a LAN IP, VPN hostname, or HTTPS domain. Desktop and direct
backend connections use the selected robot host and configured WebRTC port.
Discovery resolves selected stream paths against that runtime endpoint; a manual
WHEP URL remains an explicit endpoint and is not rewritten when choosing another
robot. The selected video still needs matching CameraInfo/TF for projection.

WHEP HTTP signaling and WebRTC media take different network paths. The robot
gateway must advertise ICE addresses reachable by the client and permit its media
port (Duck defaults to UDP/TCP 8189). Proxying HTTP alone does not relay media.
For NAT-restricted deployments, configure STUN/TURN on the gateway; the client
reads standard `rel="ice-server"` Link headers from WHEP OPTIONS responses.
HTTPS pages need HTTPS signaling or the same-origin proxy.

Duck's loopback RTP input connects its encoder to MediaMTX on the robot host; it
does not restrict viewers to localhost. Its management API deliberately permits
only loopback callers. Remote discovery therefore uses Robo-Boy's existing relay;
a desktop directly accessing a remote gateway can use its manual WHEP URL when
that deployment does not provide a discovery relay. Keep the management boundary
intact rather than exposing the API to make discovery work.

`infra/docker/Dockerfile.ros` builds upstream web_video_server 3.1.0 at commit `0b6944deef80db148b3e09d2901fbbf85b199c67`, checks its source archive SHA-256, and applies `infra/ros/web_video_server_metadata.patch`. A separate build stage keeps compilers out of the runtime. The entrypoint sources the installed package overlay at `/opt/roboboy-video/share/web_video_server/local_setup.bash`. Rebuilding/redeploying the ROS service is necessary to enable metadata; frontend-only upgrades against an unpatched streamer support Latest TF; Capture time reports unavailable acquisition metadata. Choose Latest TF or ROS image messages explicitly. An upstream streamer outside Robo-Boy's image needs the same overlay to provide metadata.

`npm run test:camera-metadata` compiles the producer helper and checks exact wire values and unchanged decoded JPEG pixels. Unit tests cover chunk boundaries/limits, metadata validation, sharing, profile/robot isolation, decoder backpressure, frame leases, refresh, disposal and strict source selection, including failures that must not open ROS image subscriptions. `e2e/shared-camera-stream.spec.ts` exercises an ongoing 30 fps HTTP stream through the built-in Camera and 3D, late calibration/TF, refresh/profile changes, actual drawing and final stream closure. Replay E2E asserts zero live video requests.

For an isolated real ROS → streamer → HTTP check, without connecting to robot networks:

```bash
docker build --target video-build -t roboboy-camera-video-build:metadata -f infra/docker/Dockerfile.ros .
docker run --rm --network none -e ROS_LOCALHOST_ONLY=1 -e ROS_DOMAIN_ID=103 \
  -v "$PWD/scripts/test-camera-streamer.py:/test-camera-streamer.py:ro" \
  roboboy-camera-video-build:metadata bash -c \
  'source /opt/ros/jazzy/setup.bash && source /opt/roboboy-video/share/web_video_server/local_setup.bash && python3 /test-camera-streamer.py'
```

This verifies original stamps and dimensions in a resized JPEG. It does not redeploy or restart an active ROS stack.

## Real WebRTC integration check

With an isolated standard 320x240 H.264 WHEP fixture running, start a separate Vite
server and run:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5175 PLAYWRIGHT_SKIP_WEB_SERVER=1 \
ROBOBOY_TEST_WHEP_URL=http://127.0.0.1:21089/microduck_head_camera/whep \
npx playwright test e2e/shared-webrtc-stream.spec.ts --config=config/playwright.config.ts --project=chromium
```

This uses a real browser peer/decoder and gateway, with mocked calibration/TF only.
It checks native playback, one shared WHEP session, metadata-free 3D mapping,
consumer removal, persisted Camera source settings and final session cleanup.
It does not touch a live robot or prove every browser, network or camera codec.
