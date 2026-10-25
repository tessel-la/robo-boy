# Shared camera streams

The built-in Camera panel uses shared MJPEG frames when browser APIs and the endpoint support them. In **3D → Settings → Visualizations → Camera image**, choose **Image source → Camera streamer (ROS fallback)** to use the same transport. Existing layers default to ROS messages. Stream quality is selected independently; matching effective URLs share a connection even if the preset names differ.

## Ownership and performance

- `utils/images/mjpegStreams.ts` owns one HTTP reader and decoder per ROS connection identity and canonical stream URL. URL parameters include topic, format, dimensions and quality. Refresh tokens do not create a separate identity; refresh reconnects all compatible consumers.
- Decoding keeps one in-flight frame and one newest pending JPEG. Slow decoding drops intermediate frames instead of building latency. A multipart part is bounded to 64 MiB and headers to 8 KiB. Existing decoded image dimension and pixel limits still apply.
- `SharedImageFrame` is the common ROS/MJPEG consumer boundary. Callbacks borrow a frame until replacement; asynchronous or held consumers call `retain()` and release the returned lease when finished. Consumers never close shared bitmaps themselves. Synchronous callbacks must stay short; heavy future consumers should sample or schedule work and retain only bounded frames.
- Camera draws at the available source/decoder rate. `cameraProjectionSource.ts` samples only the 3D consumer at up to 10 fps. Calibration and acquisition-time TF remain in `CameraImageClient`; waiting for them cannot pause Camera. 3D retains its last complete pixels/calibration/pose snapshot while a new one waits for TF.
- Removing a consumer leaves the others running. The final unsubscribe aborts the HTTP reader and releases cached/late decoded frames. Connection identity isolates different robots and replay sessions. Idle streams fail after 10 seconds; Camera refresh retries them.

This scales acquisition/decoding by unique stream profiles rather than panel count. Every view still pays for drawing, and each WebGL renderer owns its texture/GPU upload. Different quality/resolution profiles intentionally open separate streams; there is no implicit quality downgrade or global frame-rate cap. A 3D-only streamer downloads source-rate MJPEG even though it samples at 10 fps. ROS image messages remain an alternative.

Native MJPEG playback avoids the JavaScript multipart/bitmap/canvas path and can cost less main-thread time for one Camera. Shared playback trades that overhead for reusable frames and eliminating compatible duplicate image downloads/decodes. See [performance measurements](performance.md). High-resolution/many-camera performance must be measured on the target device; this change does not claim worker or GPU zero-copy decoding.

Future in-app consumers can subscribe to the same frame events and leases. WebRTC/WHEP is a separate follow-up: it needs explicit camera identity/calibration mapping and trustworthy per-frame acquisition metadata before it can drive timestamped projection. External sandboxed panels do not share these in-process bitmaps. The transport does not own TF, replay clocks, or consumer UI.

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

Old/custom streamers without valid acquisition metadata continue playing in Camera. 3D visibly switches to ROS images, preferring an advertised compressed twin; it never fabricates timestamps from arrival time. Unsupported fetch/bitmap/canvas APIs or inaccessible CORS endpoints use native Camera playback. Existing endpoint validation, enterprise authentication and runtime proxy/remote URL resolution remain in use. Replay bypasses HTTP, even when saved layer settings select the streamer.

## Deployment and validation

`infra/docker/Dockerfile.ros` builds upstream web_video_server 3.1.0 at commit `0b6944deef80db148b3e09d2901fbbf85b199c67`, checks its source archive SHA-256, and applies `infra/ros/web_video_server_metadata.patch`. A separate build stage keeps compilers out of the runtime. The entrypoint sources the installed package overlay at `/opt/roboboy-video/share/web_video_server/local_setup.bash`. Rebuilding/redeploying the ROS service is necessary to enable metadata; frontend-only upgrades retain the ROS projection fallback. An upstream streamer outside Robo-Boy's image needs the same overlay to provide metadata.

`npm run test:camera-metadata` compiles the producer helper and checks exact wire values and unchanged decoded JPEG pixels. Unit tests cover chunk boundaries/limits, metadata validation, sharing, profile/robot isolation, decoder backpressure, frame leases, refresh, disposal and projection fallback. `e2e/shared-camera-stream.spec.ts` exercises an ongoing 30 fps HTTP stream through the built-in Camera and 3D, late calibration/TF, refresh/profile changes, actual drawing and final stream closure. Replay E2E asserts zero live video requests.

For an isolated real ROS → streamer → HTTP check, without connecting to robot networks:

```bash
docker build --target video-build -t roboboy-camera-video-build:metadata -f infra/docker/Dockerfile.ros .
docker run --rm --network none -e ROS_LOCALHOST_ONLY=1 -e ROS_DOMAIN_ID=103 \
  -v "$PWD/scripts/test-camera-streamer.py:/test-camera-streamer.py:ro" \
  roboboy-camera-video-build:metadata bash -c \
  'source /opt/ros/jazzy/setup.bash && source /opt/roboboy-video/share/web_video_server/local_setup.bash && python3 /test-camera-streamer.py'
```

This verifies original stamps and dimensions in a resized JPEG. It does not redeploy or restart an active ROS stack.
