# Shared robot control

Robo-Boy gives one connected **session** control of the entire ROS graph behind a robot endpoint. Other sessions can observe telemetry, inspect the graph, and edit panels and trees. A session means one WebSocket connection, not a browser profile or an authenticated account. Two tabs, two desktop windows, or two connections to the same endpoint are separate contenders.

## Why enforcement lives on the robot host

Previously, `useRos` created a separate ROSLIB connection for every session. Pads published directly; local behavior trees and external panels called services and sent action goals on that connection. rosbridge shared publishers between clients and ran services and action goals in separate threads. There was no application-wide ownership check. A local rosapi queue only serialized discovery within one browser; persistent-tree rejection only prevented two persistent trees, not pad commands or local trees from overlapping them.

The ROS stack now runs `infra/ros/control_gateway.py` on the existing public rosbridge port (default **9090**). Caddy's `/websocket`, direct web connections, Tauri, and Electron all reach that gateway. The actual rosbridge listens only on **127.0.0.1:9092**, with the port optionally selected through `ROSBRIDGE_INTERNAL_PORT`. Each external connection has a private upstream connection, preserving ROSLIB subscriptions, service responses, action IDs, binary telemetry, and cleanup. A separate private subscription monitors the persistent runner.

The gateway is the single authority. Admission, lease changes, pending-work recording, and upstream writes occur synchronously on one Tornado event loop. There is no database, shared browser storage, distributed election, or per-panel lock. Tornado is already part of the rosbridge runtime and is explicitly installed by the ROS image.

The lock covers the **whole endpoint**, including every namespace and robot reachable through it. This is intentionally conservative: a navigation action, a velocity topic, and a gripper service can affect the same mechanism. Topic names and panel boundaries cannot prove resource independence. Multiple commands and parallel tree nodes from the same owner remain supported; the gateway prevents interference from other sessions rather than rescheduling the owner's program.

## Operator workflow

1. Connect normally. The workspace starts **read-only**; there is no automatic acquisition, takeover, or retry of a blocked command.
2. Open **Read-only** in the top bar, optionally set a session name, and select **Request control**. Requests are atomic and first processed wins. A losing session sees the owner and remains an observer.
3. Use pads, services, actions, and trees normally. All built-in panels and permission-approved external panel operations share the connection's lease.
4. Select **Release control** to revoke the lease and request cancellation of browser actions and persistent trees. Outstanding work must finish before the endpoint becomes available.
5. **Transfer control** selects a connected session. It is allowed only when no service, action, or persistent tree remains outstanding. Topic queues drain before the new session gets a fresh token. A recipient that disconnects during handover does not receive control.

The owner is shown in every session's top bar. The menu explains readiness, pending work, recovery blocks, and transfer restrictions. Rejected topic commands visibly show **Command blocked** and a reason; service and action requests also receive immediate failure responses through their normal ROSLIB transports. Session names are display labels, not identity or authorization claims.

A single user needs one explicit control request after connecting. Reconnection starts a new observer session and never resumes old control or replays a rejected command.

## Leases and recovery

The owner sends a heartbeat every **2 seconds**. A lease expires after **10 seconds** without renewal, measured by the server's monotonic clock. Every incoming request checks expiry before admission, even between timer ticks. Tokens change on acquisition and transfer, belong to one server-generated connection ID, and are never sent to observers. A copied token cannot authorize a different connection.

WebSocket transport pings run every **3 seconds**, using Tornado's default pong timeout. This keeps observer and controller connections alive independently of ownership. A transport socket remaining open never extends the control lease without the owner's application heartbeat.

A heartbeat only proves connectivity. After **120 seconds** without an accepted mutating command, control releases automatically, provided no work is outstanding. A long action or persistent run keeps the reservation while it runs. Continuous publishers count as command activity, including publishers emitting neutral values. Ownership is not tied to whether a panel is visible or a browser pointer is moving.

| Event | Expected behavior |
| --- | --- |
| Explicit release | Fence the old token immediately; cancel tracked actions and stop the persistent tree; drain outstanding work. |
| Owner closes, crashes, or loses the network | Fence the lease on close or expiry. Retry cancellation of browser-owned actions. Preserve explicitly persistent trees. |
| No outstanding work | Recover automatically. Topic publishers first pass a same-socket rosapi response barrier so buffered commands leave rosbridge before handover. |
| Service already running | Services cannot be cancelled generically. Keep the reservation until a successful transport response confirms completion. |
| Action already running | Feedback and cancellation acknowledgements do not release it. Wait for terminal ROS goal status 4, 5, or 6. Retry cancellation because the goal may still be registering. |
| Action/service reports an uncertain transport failure | Keep its reservation. rosbridge's generic failure response, including its service timeout, does not establish that the robot stopped. |
| Runner status missing or more than 10 seconds old | Block acquisition and new mutations; continue subscriptions and discovery. |
| Upstream lost with pending work, runner restarts with work, or gateway restarts with an unconfirmed-work journal | Fail closed; require operator recovery after verifying the robot is stopped. |

A disconnected session's upstream socket stays alive while a tracked request is outstanding. The gateway continues consuming terminal results even when the viewer is gone or slow. This allows ordinary disconnect recovery without discarding the only completion notification. Mutating service/action results are requested without compression or fragmentation so the gateway can inspect them. Request IDs cannot be reused within a connection.

### Persistent behavior trees

Persistent runs retain their existing promise to survive a browser disconnect, standby, or app close. Their reservation continues until the tree and its actual ROS work finish. A paused tree also reserves control.

When only the persistent tree remains, another session can explicitly select **Manage running tree**. This atomically adopts the reservation. That owner can pause, resume, or stop the existing tree, but cannot send new pad commands, services, action goals, or start another tree until it finishes. Competing adoption requests still produce exactly one owner. After completion, the adopting session has ordinary control. Explicit **Release control** stops the tree; connection loss preserves it.

`behavior_tree_runner.py` reports `activeWork` and a process-specific `runnerId` in its existing version-1 status payload. `robot_work.py` retains ROS clients until real completion, cancels late-accepted goals after a local timeout, and fences uncertain futures. Timeout-node workers remain counted until they actually exit. Thus `state: idle` alone cannot release control, and a runner restart cannot erase a pending robot operation. The gateway also reserves a start before forwarding it, requires a fresh tree session ID, and waits for matching status; a stale idle snapshot cannot acknowledge a new start.

### Operator recovery from uncertainty

There is deliberately no web **force unlock** button. A timeout is not evidence that motors or an action have stopped. First use robot-native stop/recovery tools to cancel outstanding goals, stop persistent execution, and verify a safe state. Then stop the ROS stack, clear its recovery journal, and restart it. With the default Compose deployment:

```bash
docker compose stop ros-stack
docker compose run --rm --no-deps --entrypoint /bin/sh ros-stack \
  -c 'rm -f /var/lib/roboboy-control/unconfirmed'
docker compose up -d ros-stack
```

The `control-journal` named volume survives container replacement. A marker is flushed before forwarding tracked work and removed only when confirmed safe. Do not remove that volume or journal as routine crash recovery. Standalone deployments must similarly preserve the directory selected with `--journal`.

## Panel and integration contract

- Use the `Ros` instance owned by `useRos`, or the existing permission-checked panel SDK operations. `ControlSession` attaches each lease token and wraps outgoing ROSLIB operations in `roboboy_frame`. Panels should not create an independent command socket, acquire control automatically, queue rejected writes, or store tokens. Subscriptions continue independently of ownership.
- Use absolute canonical ROS names. Relative, private, duplicate-slash, and deprecated `#` action aliases are rejected so reserved names have one meaning.
- Use ROS 2 `send_action_goal` / `cancel_action_goal` for actions. Direct calls to `/_action/` services are rejected because a send-goal service response does not establish action completion.
- Only a positive allowlist of rosapi discovery/read services is available to observers. `set_param`, `delete_param`, and arbitrary robot services require control. The read-only inspection request topic and persistent-tree `status` requests remain available to observers. Recorder status and folder listings remain readable; start, stop, pause, resume, and split require control.
- Publisher advertisement can occur while observing; actual publishes require ownership. Status-topic publishing, latched command publishers, service/action server advertisement, and unknown rosbridge operations are rejected. Cleanup, unsubscription, and unadvertisement remain allowed.
- The reserved `/roboboy/control/status` topic is synthesized per connection by the gateway, including `selfId`, owner label, state, readiness, pending count, adoption availability, and that connection's token when appropriate. It is never forwarded from ROS. `roboboy_control` supports `identify`, `status`, `acquire`, `heartbeat`, `release`, `transfer`, and `adopt`. Only the owner with a valid token can release, transfer, or renew.
- Topic publishing is fire-and-forget. A FIFO barrier proves admission to ROS, not physical stopping. Robot controllers **must provide their own command watchdog/deadman and emergency-stop behavior**; no generic UI can infer a safe neutral message for every topic. Integrations that start asynchronous work through opaque topic messages or services that return before physical completion need a tracked ROS action or the persistent runner. Do not use a quick service response as proof that a background actuator job finished.

New panels can therefore use existing ROS operations without implementing a second lock. An integration exposing a new asynchronous command transport must add its lifetime tracking at the gateway/robot boundary before relying on handover safety.

## Deployment boundary and compatibility

Rebuild the ROS stack with the frontend upgrade:

```bash
docker compose up -d --build ros-stack
```

Endpoint URLs and Caddy routes are unchanged. An old frontend can still observe the gateway but cannot issue unchecked writes. An updated frontend connected to raw legacy rosbridge receives no authority status and its command envelopes are rejected; it does not fall back to unsafe control. The upgraded runner is required for acquisition, including when no tree panel is open. Local recording replay does not connect to the gateway.

Run **one authority for a shared control domain**. Two independent gateways to the same hardware would have independent leases; exposing the private rosbridge or other command paths would bypass this boundary. Use the deployment's existing network access controls/authentication for trusted users. This change coordinates sessions; it does not add accounts or roles, and it cannot arbitrate unrelated native ROS publishers, shell tools, or trusted loopback/DDS peers.

## Verification

`python -m unittest discover -s infra/ros -v` runs policy tests, RobotWork lifetime tests, and real Tornado WebSocket tests with a scripted rosbridge. Tests cover simultaneous contenders, observers, token fencing, transfers, topic barriers, disconnects, expired/idle leases, terminal action results, uncertain service responses, runner restarts, persistent adoption, and durable recovery.

Frontend tests cover command envelopes, status updates, heartbeats, stale status, cleanup, and ownership UI. `e2e/robot-control.spec.ts` checks the observer/acquire/release workflow in the browser; existing feature tests use an established controller in the shared ROS mock. These tests do not certify a specific robot's stopping behavior; deployment acceptance should exercise that robot's real ROS actions and watchdog with two clients.

An optional smoke test runs real rosbridge, the upgraded persistent runner, and dummy ROS topics,
services, and actions inside a disposable, network-isolated container. With a local ROS stack image:

```bash
docker run --rm --network none --entrypoint /bin/bash \
  -e ROS_DOMAIN_ID=231 -e ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST \
  -v "$PWD/infra/ros:/control:ro" robo-boy-ros-stack:latest \
  -lc 'source /opt/ros/${ROS_DISTRO}/setup.bash && python3 /control/control_ros_smoke.py'
```

It checks two competing clients, observer rejection, topic forwarding and drain, actual action
cancellation, service completion, and a persistent run surviving disconnect, being adopted, and stopped.
