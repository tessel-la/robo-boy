# Data Explorer

The Data Explorer panel inspects the ROS graph: topics, services, actions and nodes, who publishes and subscribes,
how much traffic flows, what the messages contain, and whether the robot reports itself healthy. It has three views:

- **Resources**: a searchable list with an inspector for the selected item.
- **Graph**: who talks to whom.
- **Health**: diagnostics, logs, events and your own topic rules.

It only observes. It never calls a robot service or sends an action goal. To act on something, use a Pad or a
Behavior Tree.

The toolbar holds the three views, the source (for example **● ROS host**), a download button and a refresh button:

- **Download** saves one JSON file with the resources, measurements, diagnostics, rules, events and logs.
- **Refresh** asks the ROS host for the graph again and re-sorts the rows by their current values.

## Resources

Pick **Topics**, **Services**, **Actions** or **Nodes**. Each row shows the name, the type and a column per count:

| Kind      | Columns      | What they count                                                                             |
| --------- | ------------ | ------------------------------------------------------------------------------------------- |
| Topic     | Pub, Sub, Hz | Endpoints. One node with two publishers on a topic counts as 2. Hz only for watched topics. |
| Service   | Srv, Cli     | Endpoints on ROS 2 Jazzy and later; otherwise participating nodes (the tooltip says which). |
| Action    | Srv, Cli     | Participating nodes. An action's internal services and topics are never added up.           |
| Node      | Pub, Sub     | How many topics the node publishes and subscribes to.                                       |
| Recording | Msgs, Avg Hz | Messages in the file and their whole-file average rate.                                     |

Services, actions and nodes have no rate column: they have no message stream to measure.

Counts include observers: the inspector's own probe, rosbridge and the recorder all appear as subscribers. The
**Endpoints** tab marks them as **Observer** instead of silently subtracting them. `—` means unknown, never zero.

Three filter buttons sit beside the search. On a narrow tile they fold into one **Filters** menu, with a dot while
any filter is on.

- **Watched only** (eye) hides topics you do not watch. It only applies to topics; services, actions and nodes stay.
- **Show hidden** (layers) adds hidden and infrastructure resources: names with a `_` segment, Robo-Boy's own topics,
  `/rosout`, `/parameter_events`, the parameter services every node offers, and bridge nodes.
- **Missing endpoints** (funnel) shows resources with no publisher, subscriber, server or client.

With a recording open, only **Show hidden** is offered: a recording has no watch probes and no endpoint counts.

**Sort** by clicking a column heading; click again to reverse. Number columns start with the largest values, and
unknown values always go last. Rows keep their order while numbers change; **Refresh** re-sorts them.
**Resize** a column by dragging the left edge of its heading, or focus that edge and use the arrow keys
(Shift for bigger steps). Widths save with the workspace.

**Actions** for each topic are icons at the end of the row: watch traffic, record, health rule, and, when the type
has a view, open it in 3D, Camera or the TF tree. The inspector shows the same icons. On a very narrow tile the row
icons hide and only the inspector keeps them. A row with a violated health rule shows a warning mark and an amber
edge.

**Select several rows** with their checkboxes (Shift-click selects a range; the heading checkbox selects everything
shown). A bar then acts on all of them at once: **Watch** (or **Unwatch** when all are watched already), **Record**,
**Rules**, **Pin** (keeps them at the top of the list), **Copy** the names, or clear the selection.

### Inspector

Select a row to open the inspector: beside the list in a wide tile, or in its place in a narrow one (**Back** returns).

- **Value**: the latest message as a tree, updated at most 10 times a second. Large arrays, strings and images
  are shortened, so a point cloud never has to render in full. **Freeze** holds the displayed message without
  pausing the robot or the replay. **Find a field** filters by path. Changed values are highlighted against the
  previous message. Every field copies its path, and numeric fields open in Time Series.
- **Endpoints**: publisher and subscriber nodes, each endpoint's delivery settings (QoS: reliability, durability,
  history, depth, deadline, lifespan, liveliness), and known QoS incompatibilities. A compatible policy does not
  prove delivery.
- **Traffic** (watched topics): rate, payload rate, last message age, message count, interval statistics, message
  sizes, and charts of the rate and payload over the last minute. The charts start at zero and show their scale.
  An unwatched topic offers a **Watch this topic** button instead.
- **Schema**: nested fields and constants from the ROS host. For a recording, the message definition stored in the
  MCAP file.
- For an action, **Goal status** lists goals seen on its status topic with readable states
  (Accepted, Executing, Succeeded, Canceled, Aborted…) and their transitions; **Feedback** shows the latest
  feedback message. Other clients' goal and result payloads are not visible to an observer.

The inspector heading can also pin the resource and copy its name.

**Watch traffic** starts measuring a topic. A panel can watch up to 32 topics by hand (topics with a health rule are
watched too), and the ROS host measures at most 32 at once across all panels and browsers. A topic past that limit shows "Not measured: the shared 32-topic probe budget
is full" rather than a rate.

## Graph

Topics are drawn publisher → topic → subscriber. Services and actions are drawn client → resource → server. The
layer follows the selected kind. Selecting a resource or node focuses the drawing on it and its neighbours; large
systems draw the first 60 resources and say so.

- A **dashed** edge was discovered; a **solid** one belongs to a watched topic with measured traffic. Discovery alone
  does not prove delivery. A red edge marks a known QoS incompatibility.
- Bridge and Robo-Boy nodes are left out of the drawing (not the counts) unless **Show hidden** is on.
- Dragged positions are saved per layer with the workspace. The **+**, **−** and fit buttons zoom; the graph fits
  itself again when resources appear or disappear, or when it becomes visible after being hidden.

## Health

- **Diagnostics** reads a `diagnostic_msgs/DiagnosticArray` topic, `/diagnostics` by default. Choose
  `/diagnostics_agg` instead of both, to avoid counting components twice. Components are keyed by source, name and
  hardware ID, so partial arrays update only what they name. The robot's own severity is shown separately from
  **Update stale**, which only means no update arrived within the **Stale after** time. An empty list does not mean
  the robot is healthy.
- **Logs** shows the last 200 `/rosout` entries with level and text filters. Repeated adjacent messages are folded,
  and **Freeze** holds the list.
- **Events** records discovery changes, diagnostic level changes and rule changes during this session (last 200).
- **Rules** check a topic against a minimum or maximum rate, a silence timeout, and required publisher or subscriber
  counts. Rule topics are watched automatically. Rates are judged once the 10-second window has warmed up. Silence is
  judged against how long the topic has been watched, so a timeout longer than the window still works. A change must
  last 3 seconds before a rule is reported or cleared, so one late message does not make it flip. Rules save with the
  workspace.
- The summary counts components that need attention and violated rules separately.
- A topic's heart icon opens its rule here when it already has one.

## Opening other panels

**Plot** (a numeric field in the Value tab) opens Time Series. The view icon opens **3D** (point clouds, laser scans,
camera info, marker arrays), **Camera** (images) or the **TF tree** (TF messages). **Record** opens Record &
Replay's record view with the topic selected, without starting a recording.

These add to what is already there instead of replacing it:

- An open panel of that kind is reused. The topic is added to its settings: a new 3D layer, a new plotted line, one
  more recorded topic. Existing layers, lines, record options and the 3D frame settings stay. A topic already shown
  is not added twice.
- Otherwise a new panel opens. A camera always gets its own tile while there is room, so the view already on screen
  keeps its stream.
- When the workspace is full (a phone holds two stacked tiles), the other tile is used.

Pose topics have no 3D shortcut for now, because their 3D arrow does not show the pose correctly yet.

While a recording is open, Time Series, 3D, Camera and TF follow it. If the Explorer inspects the live robot at that
time, these actions are disabled, so recorded data is never shown under a live label.

## The AI assistant

While a Data Explorer is open, the assistant sees what it shows and can act on it. Ask, for
example, "which topics have no subscribers", "watch /scan and /odom", "alert me if /cmd_vel goes
silent for 2 seconds", or "what do the diagnostics say".

- It reads every resource with its counts, the rates of watched topics, QoS problems,
  diagnostics, the newest `/rosout` entries, events, and each health rule with its state.
- It can watch and stop watching topics, add, change or remove health rules, select a resource
  (to read its endpoints, schema and latest message), and switch the view or the diagnostic topic.
- It can list any of the 200 kept log entries by level, node or text.

Everything it changes appears in the panel straight away, the same as a click. Watching and rules
only observe; they never publish to the robot's own topics. With no Explorer open, the assistant
can add one first. See [AI Assistant](ai-assistant.md#context).

## What the numbers mean

The observation point is always labelled, because the same topic can measure differently in each:

| Source                  | Meaning                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Observed on ROS host    | A best-effort probe on the ROS host counts arrivals in a rolling 10-second window. It is a receive rate, not proof of every publish. |
| Received in the browser | Without the companion, preview arrivals are counted. rosbridge throttles them to 10 per second, so "≥ 10 Hz" is a lower bound.       |
| Recorded                | Message count divided by the file's duration: a whole-file average, independent of playback speed.                                   |

- **Rate** needs at least a second of observation and is marked **Warming up** for the first 10 seconds. A watched
  topic that delivers nothing in a full window reads 0 Hz; an unwatched topic reads `—`.
- **Payload** is serialized message bytes. It excludes transport overhead, so it is not wire bandwidth.
- **Intervals** use a monotonic clock. A long interval is not proof of message loss.
- The probe is a real subscriber with its own cost on the ROS host. It appears in the subscriber count.

## Replay

By default the Explorer follows an open recording (**Follow replay**); pick **Live robot** to inspect the robot
instead. The source is shown in the toolbar of every view.

A recording lists its topics, message counts, whole-file average rates, message previews at the playback cursor and
stored message definitions. Diagnostics and logs follow bag time, so pausing does not make them stale. Seeking
backwards starts inspection again from the cursor, so nothing from the future remains. After a backward seek,
diagnostics hold the latest array at the cursor plus what has been played since; a component that reported only
earlier appears again with its next update.
Ordinary MCAP files have no publisher/subscriber graph: counts, endpoints and the Graph view say **Not recorded**
rather than borrowing the live robot's topology.

## The ROS inspection companion

`infra/ros/inspection_runner.py` runs next to rosbridge. The ROS container's entrypoint starts it and restarts it if
it exits. It provides endpoint counts, QoS, nested schemas and host measurements. Without it, the Explorer still
lists topics, services, actions and nodes through rosapi. Counts, endpoints, QoS and schemas then show as unavailable,
and rates come from the browser.

It talks over protocol-version-1 JSON in `std_msgs/String`:

| Topic                         | Direction      | Content                                                           |
| ----------------------------- | -------------- | ----------------------------------------------------------------- |
| `/roboboy/inspection/request` | browser → host | A lease: watched topics and selected resources, renewed every 2 s |
| `/roboboy/inspection/graph`   | host → browser | The resource graph; sent when it changes or a client asks         |
| `/roboboy/inspection/metrics` | host → browser | Measurements every 500 ms, also the companion's heartbeat         |

Limits: 32 probes, 7-second leases (a closed browser's probes stop on their own), 10-second measurement windows,
2,000 resources and 500 nodes per graph, and graph discovery about every 2 seconds while a client is connected.
Probes, leases and discovery stop when no client is connected.

### Installing or updating

With the Docker stack, rebuild and recreate the ROS container:

```bash
docker compose build ros-stack
```

```bash
docker compose up -d --force-recreate --no-deps ros-stack
```

On a robot without the container, run it next to rosbridge with ROS sourced:

```bash
python3 infra/ros/inspection_runner.py
```

It needs `rclpy`, `rosidl_runtime_py`, `std_msgs`, and the message packages of the topics you inspect. Its tests run
without ROS:

```bash
python3 -m unittest discover -s infra/ros -p test_inspection_runner.py
```

## Not in this release

These parts of the original design are deliberately left for later:

- Recorded diagnostics restored at a seek point (after a seek, components reappear as they update).
- Recording and replaying topology snapshots; service call tracing through service introspection; parameter browsing.
- Graph namespace groups and collapse, and explicit one- or two-hop neighbourhood controls.
- Namespace grouping and a health filter in the resource list, and optional live sorting.
- Header-stamp age, message-loss counters, and rolling recorded rates computed in the replay worker.
- A C++ collector for very high-bandwidth topics. The Python probe's cost has not been benchmarked on camera or
  point-cloud workloads yet.
- CSV export (reports are JSON), and saved mappings from diagnostic names to topics or nodes.
