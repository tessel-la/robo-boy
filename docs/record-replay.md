# Record & Replay

The Record & Replay panel has two views:

- **Replay** plays an MCAP through Time Series, TF tree and 3D panels: a file on this device, or a recording on the
  ROS host, read in place without copying it first.
- **Record** asks the ROS host to write selected topics to an MCAP bag.

Robot controls (pads, camera, behavior trees, services) always stay on the live connection. Replay never publishes.

## Replay

Drop an `.mcap` file on the panel, or click to choose one. You can also start from **Open local recordings** on the
connection screen when no robot is available.

- Play, pause, back/forward 10 seconds, scrub, loop, and speed (0.25× to 8×).
- Moving forward keeps panel state, as live data would. Moving backward rebuilds Time Series, TF and 3D, because
  TF buffers and plots cannot accept older messages than they already hold.
- Seeking restores each topic's latest message at the cursor. `/tf` and `/tf_static` are merged per child frame;
  dynamic TF looks back at most 30 seconds, like a tf2 buffer.
- The file stays on the device. It is read with random access through its index, so only summary data and the chunks
  being played enter memory.

### Recordings on the ROS host

While connected, the empty Replay view lists the recording root of the ROS host under **On the ROS host**: folders,
finished bags (with duration, message count and size) and loose `.mcap` files. A split bag lists each part. A bag
that is still being recorded is shown but cannot be opened until it stops. **Find it in Replay** in the Record view
opens the folder of the recording that just finished.

Each MCAP file has two actions:

- **Replay** reads it in place over HTTP range requests, through the same reader as a local file. Opening a bag
  transfers only its header, footer and index; playback then fetches the chunks it plays, reading ahead up to 8 MiB
  once it moves forward through the file, and keeps at most 64 MiB in memory. A multi-gigabyte bag opens in a few
  tens of kilobytes. On a slow link the clock waits (the panel shows **Buffering…**) instead of queueing data.
- **Download** copies it to this device. Where the browser can write files (Chromium browsers and Electron), you
  choose where to save it and the copy streams straight to disk with progress, cancel, and automatic resume from the
  last byte after a dropped connection; **Replay** then opens the copy exactly like a dropped file. Elsewhere
  (Firefox, Safari, mobile web views) the browser's own download takes over; drop the file on the panel when it
  finishes.

Failures stay recoverable. A dropped connection is retried with backoff; if it persists, playback stops with
**Reconnect and continue**, which reopens the recording where it stopped. A download that runs out of retries keeps
what it has and offers **Resume**. A recording that disappears, or changes while it is being read (detected through
its size and ETag), is reported instead of being read inconsistently.

The ROS host's recorder serves these files read-only on port 9091 (`RECORDINGS_PORT` in Compose,
`ROBOBOY_RECORDINGS_PORT` on the host, `0` turns it off): `GET /list?path=` and `GET /files/<path>.mcap` with Range,
HEAD and CORS. Nothing outside the recording root and nothing but `.mcap` files is served. The browser reaches it
through Caddy at `/recordings`, so a web client needs no extra port; the desktop and mobile apps connect to
`HOST:9091` directly (`VITE_RECORDINGS_PORT`), like rosbridge. Like the robot's other services it is
unauthenticated: keep it on a trusted network or VPN.

Caddy reaches the recorder from the Docker network through the host gateway, like rosbridge. If the host firewall
filters that traffic, **On the ROS host** says the recordings service did not answer and Caddy logs a dial timeout
to port 9091; allow the port the same way rosbridge's is allowed, for example
`sudo ufw allow from 172.16.0.0/12 to any port 9091 proto tcp` for Docker's default bridge networks.

Supported files: indexed MCAP (the `ros2 bag` default) with `ros2msg`/CDR, `ros1msg`, or JSON channels, and
uncompressed, zstd or LZ4 chunks. A file without a chunk index can be fixed with `mcap recover`.

### How playback is fed

1. `ReplaySession` (main thread) owns the clock. About 30 times a second it asks the worker for the next time window.
2. `replay.worker.ts` keeps one forward MCAP iterator open across windows, so each chunk is decompressed once. Seeking
   or changing topics starts a new iterator.
3. Messages come back in batches of at most 256 messages or 8 MiB. The worker waits for an acknowledgement before
   sending more, and the clock advances at most 100 ms per tick. A slow machine plays slower; it does not queue data
   without limit.
4. `ReplayRos` is a read-only stand-in for a `roslib` connection. Panels subscribe to it exactly as they would to a
   robot, and it answers the `rosapi` topic lookups from the file's index.

int64 fields are converted to numbers, as rosbridge does. Decompression is plain JavaScript (`fzstd` and
`lz4.ts`), so no wasm loader or CSP exception is needed on web, desktop or mobile.

## Record

Recording runs on the ROS host in `infra/ros/recording_runner.py`, started by the ROS container's entrypoint. Raw
message bytes never cross the browser connection, and a recording continues if the browser closes. The same process
serves the finished recordings to Replay (see [Recordings on the ROS host](#recordings-on-the-ros-host)).

| Option                | Meaning                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Destination           | Folder inside the recording root (`ROBOBOY_RECORDINGS_ROOT`, `./recordings` in compose). |
| Recording name        | Bag directory name. Letters, numbers, `.`, `-`, `_`. Must not exist yet.                 |
| Topics                | All topics (including ones that appear later), or a picked list.                         |
| Include / exclude     | Regular expressions that add or remove topics.                                           |
| Maximum Hz per topic  | At most N messages per second per topic. `0` keeps the original rate.                    |
| Compression           | Zstandard (fast) or none.                                                                |
| Split size / interval | Start a new file after N MiB or N seconds. `0` disables. **Split** does it now.          |
| Writer queue          | Memory for messages waiting to be written. When full, messages are dropped and counted.  |
| Delivery policy (QoS) | Match each publisher, or force reliable / best effort.                                   |
| Hidden topics         | Include topics with a path segment starting with `_`.                                    |
| Simulation time       | Stamp messages with `/clock`. Recording waits for the first `/clock` message.            |

The panel talks to the recorder over `/roboboy/recorder/command` and `/roboboy/recorder/status` (`std_msgs/String`
JSON, protocol version 1). Status is latched, so a panel opened later sees a running recording.

### Desktop and external ROS applications

The Electron and Tauri apps use the recorder on the ROS host selected on the connection screen,
just like the browser. Receiving topics through rosbridge alone is not enough: the host also needs
the recording service and the MCAP storage plugin. After upgrading an older Compose installation,
rebuild and recreate `ros-stack` to install those dependencies and start the recorder:

```bash
docker compose up -d --build ros-stack
```

For a ROS host outside Compose, source its ROS environment and any robot interface workspace,
then run the service from this repository:

```bash
sudo apt-get install "ros-${ROS_DISTRO}-rosbag2-py" "ros-${ROS_DISTRO}-rosbag2-storage-mcap"
mkdir -p "$HOME/recordings"
ROBOBOY_RECORDINGS_ROOT="$HOME/recordings" python3 infra/ros/recording_runner.py
```

The service also serves the recording root read-only on port 9091 (set `ROBOBOY_RECORDINGS_PORT`, or `0` to turn it
off, and `ROBOBOY_RECORDINGS_ADDRESS` to bind one interface); allow that port through the firewall for desktop and
mobile clients.

The recorder, rosbridge, and the external application must discover the same ROS graph. Use the
same domain and compatible DDS settings, and make custom message definitions available to the
recorder through [robot workspace overlays](robot-overlays.md). Keep QoS on **Match publishers**
unless a particular topic requires an override; this also supports best-effort sensor publishers.

**Ready to record** confirms the service is reachable. After **Start recording**, the state should
change to **Recording in progress** and its message count should rise. Files are saved on the ROS
host, even when using a desktop app on another computer. After **Stop & save**, replay the bag from
the ROS host or download it from the Replay view. Local replay needs no ROS installation or connection.

The container writes as root, so each finished bag is handed to the owner of the recording root (on a bind mount,
the host user). This matters for snap browsers (Ubuntu's Firefox and Chromium): they only open files your user
owns, and report other files as "The operation was aborted". If the recording root itself is owned by root, create
it as your user first (`mkdir recordings`).
