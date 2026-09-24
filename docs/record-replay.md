# Record & Replay

The Record & Replay panel has two views:

- **Replay** opens an MCAP file on this device and plays it through Time Series, TF tree and 3D panels.
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
message bytes never cross the browser connection, and a recording continues if the browser closes.

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

The container writes as root, so each finished bag is handed to the owner of the recording root (on a bind mount,
the host user). This matters for snap browsers (Ubuntu's Firefox and Chromium): they only open files your user
owns, and report other files as "The operation was aborted". If the recording root itself is owned by root, create
it as your user first (`mkdir recordings`).
