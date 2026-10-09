# Shared robot control

By default, Robo-Boy gives one connected **session** control of the entire ROS graph behind a robot endpoint. Other sessions can observe telemetry, inspect the graph, and edit panels and trees. A session means one WebSocket connection, not a browser profile or an authenticated account. Two tabs, two desktop windows, or two connections to the same endpoint are separate contenders.

## Configure control at setup

Configure session locking on the robot host in Compose's `.env` file. These settings apply to
every web, Tauri, and Electron client using that gateway; they have no UI toggle.

| Setting | Default | Behavior |
| --- | --- | --- |
| `ROBOBOY_CONTROL_LOCKING_ENABLED` | `true` | Require one session to acquire exclusive control. Set `false` for shared control without acquisition, transfer, or ownership heartbeats. |
| `ROBOBOY_CONTROL_IDLE_SECONDS` | `120` | Release an idle owner after this many seconds without accepted commands and with no outstanding work. Set `0` for no idle expiry. Applies only when locking is enabled. |

For exclusive control with a 60 s idle timeout:

```dotenv
ROBOBOY_CONTROL_LOCKING_ENABLED=true
ROBOBOY_CONTROL_IDLE_SECONDS=60
```

For indefinite idle ownership, keep locking enabled and set `ROBOBOY_CONTROL_IDLE_SECONDS=0`.
The owner must still send heartbeats; disconnect, heartbeat loss, explicit release, and the
optional robot-side switch revoke control as before. A pending consent request still expires
after 60 s independently of the owner's idle setting.

To disable session locking:

```dotenv
ROBOBOY_CONTROL_LOCKING_ENABLED=false
```

Connected sessions can then send topics, services, and actions concurrently without requesting
control. The menu shows **Shared control** and hides ownership buttons. Sessions can still set
their display names. Disconnecting one session does not stop or block another session's work;
the gateway keeps a disconnected session's upstream alive until its tracked work finishes.
There is no exclusive handover or protection against conflicting commands in shared mode.

The gateway stays in the connection path in both modes. Origin filtering, reserved policy
namespaces, command validation, runner readiness, action lifetime tracking, and recovery fences
for uncertain work remain enforced. Disabling session locking cannot bypass a recovery journal.
The independent `ROBOBOY_EXTERNAL_CONTROL_LOCK` switch still blocks all commands when closed
or unavailable. Closing it cancels tracked actions, stops persistent trees, and drains all
clients' topic writes before reopening control.

Apply changes by recreating the ROS stack with the updated image:

```bash
docker compose up -d --build ros-stack
```

These are startup settings. Recreating the stack disconnects existing sessions; clients reconnect
under the new policy. Keep the recovery journal volume intact when changing modes.
Standalone gateways accept the same environment variables or `--control-locking true|false`
and `--idle-seconds 60` (use `0` for no idle expiry). Invalid booleans, negative timeouts, and
nonfinite timeouts fail startup instead of silently changing policy.

## Why enforcement lives on the robot host

Previously, `useRos` created a separate ROSLIB connection for every session. Pads published directly; local behavior trees and external panels called services and sent action goals on that connection. rosbridge shared publishers between clients and ran services and action goals in separate threads. There was no application-wide ownership check. A local rosapi queue only serialized discovery within one browser; persistent-tree rejection only prevented two persistent trees, not pad commands or local trees from overlapping them.

The ROS stack now runs `infra/ros/control_gateway.py` on the existing public rosbridge port (default **9090**). Caddy's `/websocket`, direct web connections, Tauri, and Electron all reach that gateway. The actual rosbridge listens only on **127.0.0.1:9092**, with the port optionally selected through `ROSBRIDGE_INTERNAL_PORT`. Each external connection has a private upstream connection, preserving ROSLIB subscriptions, service responses, action IDs, binary telemetry, and cleanup. A separate private subscription monitors the persistent runner.

The gateway is the single authority. Admission, lease changes, pending-work recording, and upstream writes occur synchronously on one Tornado event loop. There is no database, shared browser storage, distributed election, or per-panel lock. Tornado is already part of the rosbridge runtime and is explicitly installed by the ROS image.

The lock covers the **whole endpoint**, including every namespace and robot reachable through it. This is intentionally conservative: a navigation action, a velocity topic, and a gripper service can affect the same mechanism. Topic names and panel boundaries cannot prove resource independence. Multiple commands and parallel tree nodes from the same owner remain supported; the gateway prevents interference from other sessions rather than rescheduling the owner's program.

## Operator workflow with locking enabled

1. Connect normally. The workspace starts **read-only**; there is no automatic acquisition, takeover, or retry of a blocked command.
2. Open **Robot control** in the top bar (the lock icon on smaller screens, **Read-only** on desktop), optionally set a session name, and select **Request control**. When control is available, acquisition is atomic and first processed wins. When another session owns control, this sends that owner a consent request; it does not take over.
3. Use pads, services, actions, and trees normally. All built-in panels and permission-approved external panel operations share the connection's lease.
4. Select **Release control** to revoke the lease and request cancellation of browser actions and persistent trees. Outstanding work must finish before the endpoint becomes available.
5. **Transfer control** selects a connected session. It is allowed only when no service, action, or persistent tree remains outstanding. Topic queues drain before the new session gets a fresh token. A recipient that disconnects during handover does not receive control.

The top bar shows the control state, with the owner name in the menu and, when space permits, beside the icon. The menu explains readiness, pending work, recovery blocks, and transfer restrictions. Rejected commands flag the control button and show their reason in the menu; service and action requests also receive immediate failure responses through their normal ROSLIB transports. The menu closes with its close button, Escape, or a click outside, and scrolls within the available viewport on smaller screens. Session names are display labels, not identity or authorization claims.

A single user needs one explicit control request after connecting. Reconnection starts a new observer session and never resumes old control or replays a rejected command.

### Session names

Desktop sessions use the local account name when available: Electron reads the OS account,
and Tauri reads `USER` or `USERNAME` from the native process environment. Mobile apps and
ordinary web pages have no useful OS username API and keep the gateway's generated session
label. You can edit every label in **Session name**. A name confirmed by the gateway is
remembered in that app/browser profile and takes precedence over the native default on later
connections. Private browser profiles keep separate names, and unavailable storage does not
prevent naming a connected session. A delayed native lookup never overwrites a manual edit.

Names identify a display label only. They do not authenticate the person, distinguish two
sessions with the same name, or grant control automatically.

## Optional robot-side control switch

Set `ROBOBOY_EXTERNAL_CONTROL_LOCK=true` in the ROS stack environment and rebuild it
when a native robot operator needs a global switch for Robo-Boy control:

```dotenv
ROBOBOY_EXTERNAL_CONTROL_LOCK=true
```

```bash
docker compose up -d --build ros-stack
```

The environment flag defaults to `false`, preserving the normal session ownership workflow.
When enabled, the stack starts `infra/ros/external_control_lock.py` independently of the
frontend, under `/roboboy/control/external/controller`. Its boolean ROS parameter
**`allow_control` defaults to `false`** on every process start. The environment flag opts
into this policy; the ROS parameter enables or disables control while it runs.

Use a native ROS shell in the robot's domain. For the container:

```bash
docker compose exec ros-stack bash
source /opt/ros/${ROS_DISTRO}/setup.bash
ros2 param set /roboboy/control/external/controller allow_control true
```

With `allow_control=true`, Robo-Boy uses its normal **Request control**, **Release control**,
owner **Grant** / **Deny**, **Transfer control**, and **Manage running tree** workflow.
There is no additional robot-side approval of individual requests. Enabling access neither
assigns an owner nor retries blocked requests. One session still owns the entire endpoint,
and transfers still wait for running work and topic queues. Other sessions remain read-only.

Disable access with:

```bash
ros2 param set /roboboy/control/external/controller allow_control false
```

The node publishes the parameter value every 1 s. When the gateway observes `false`, it
fences the lease, cancels pending owner-consent requests and transfers, requests action
cancellation, and stops persistent trees. It retains its reservation until actual completion
is confirmed; services cannot be cancelled generically. Reopening access requires a fresh
control request and never restores an old token. This policy overrides a persistent tree's
usual promise to survive a browser disconnect.

Missing policy heartbeats for 10 s, a lost private ROS connection, or a policy process restart
has the same revocation behavior. A restart returns `allow_control` to `false`. Recovery
fences for uncertain robot work remain in force; the switch does not force-unlock them.

### ROS integration contract

The robot policy publishes **`/roboboy/control/external/state`** as `std_msgs/msg/String`
containing JSON with `version: 1`, a process-specific `controllerId`, a strictly increasing
integer `sequence`, boolean `allowControl`, and an optional `reason` of at most 256 characters.
Use a new controller ID at startup. Duplicate/out-of-order states do not renew freshness,
and retired controller IDs cannot restore access. Native node logs report access changes.

A custom robot integration can publish this state instead of running the reference node.
Run one policy publisher in the robot's trusted ROS domain. The former per-request
`requests`, `decision`, and `command` topics are no longer used; operators only set the
parameter. The public gateway reads policy state through its private rosbridge connection.

The public WebSocket gateway permits reads of the policy namespace but rejects writes,
advertisements, services, actions, and rosapi parameter writes in it, including from the owner.
Robo-Boy shows whether the switch is enabled, disabled, or unavailable. It provides no toggle
or bypass. Native DDS peers remain trusted; this policy is not authentication or an emergency
stop, and robot-native watchdogs and stopping tools remain required. For a standalone gateway,
use `--external-lock true` and start the policy node through the robot's ROS launch/supervision
system. Missing policy heartbeats keep control closed.

### Requesting control from another session

The current owner receives a bell badge and the control menu opens once for each new request, without moving keyboard focus away from robot controls. They can **Grant** or **Deny**. Grant uses the same safe handover as direct transfer: it requires a ready runner and no outstanding service, action, or persistent work, then drains topic writes before issuing a new token. Deny remains available while work runs. Approval never cancels running work; the owner must finish or stop it first.

Each connected requester can have one pending request. Repeated clicks reuse that request; the requester can cancel it or see a denial. Requests expire after **60 seconds**, and they never renew the owner's heartbeat lease or inactivity timer. Owner release, disconnect, expiry, or transfer cancels outstanding requests; requester disconnect cancels that session's request. There is no automatic takeover or acquisition queue. Competing approvals produce exactly one transfer, and stale decisions cannot approve a later request. Incoming requests are visible only to the current owner; each requester sees its own result.

## Leases and recovery

The owner sends a heartbeat every **2 seconds**. A lease expires after **10 seconds** without renewal, measured by the server's monotonic clock. Every incoming request checks expiry before admission, even between timer ticks. Tokens change on acquisition and transfer, belong to one server-generated connection ID, and are never sent to observers. A copied token cannot authorize a different connection.

WebSocket transport pings run every **3 seconds**, using Tornado's default pong timeout. This keeps observer and controller connections alive independently of ownership. A transport socket remaining open never extends the control lease without the owner's application heartbeat.

A heartbeat only proves connectivity. After the configured idle timeout (**120 seconds** by default) without an accepted mutating command, control releases automatically, provided no work is outstanding. A timeout of `0` disables only idle expiry. A long action or persistent run keeps the reservation while it runs. Continuous publishers count as command activity, including publishers emitting neutral values. Ownership is not tied to whether a panel is visible or a browser pointer is moving.

The configured inactivity timeout is **not a guaranteed minimum control duration**. Closing or refreshing the page closes its socket and fences ownership immediately; losing connectivity or browser suspension can stop heartbeats and expire the ten-second lease sooner. Switching tabs or workspaces preserves a connected socket when gateway status is fresh. Returning after status becomes stale recreates the connection as an observer. Browsers such as mobile Safari can suspend background timers and sockets, so background ownership cannot be guaranteed. Lease loss can leave telemetry connected; it does not itself disconnect the whole session.

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

Read-only forwarding failures retire the affected connection without fencing another session's control. Losing the owner's transport still releases its lease. A failed command write, lost transport with outstanding work, or a recovery-journal failure retains the robot-wide recovery fence because completion is uncertain. Action-cancellation write failures remain fenced and do not escape the recovery loop.

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
- Only a positive allowlist of rosapi discovery/read services is available to observers. `set_param`, `delete_param`, and arbitrary robot services require ownership when session locking is enabled. The read-only inspection request topic and persistent-tree `status` requests remain available to observers. Recorder status and folder listings remain readable; start, stop, pause, resume, and split require ownership when session locking is enabled.
- Publisher advertisement can occur while observing; actual publishes require ownership when session locking is enabled. Status-topic publishing, latched command publishers, service/action server advertisement, and unknown rosbridge operations are rejected. Cleanup, unsubscription, and unadvertisement remain allowed.
- The reserved `/roboboy/control/status` topic is synthesized per connection by the gateway, including `enabled` (session locking, defaults to `true` when absent), `idleMs` (`0` means no idle expiry, defaults to `120000` when absent), `selfId`, owner label, state, readiness, pending count, adoption availability, and that connection's token when appropriate. It is never forwarded from ROS. `roboboy_control` supports `identify`, `status`, `acquire`, `heartbeat`, `release`, `transfer`, `adopt`, `request`, `cancel_request`, `approve`, and `deny`. Only the owner with a valid token can release, transfer, renew, approve, or deny. `cancel_request`, `approve`, and `deny` require the exact `requestId`. Version-1 status adds optional `requests` entries (`id`, `clientId`, `label`) for the owner and a connection-specific `request` result (`id`, `state`, `message`), with states `pending`, `accepted`, `granted`, `denied`, `expired`, or `cancelled`.
- Topic publishing is fire-and-forget. A FIFO barrier proves admission to ROS, not physical stopping. Robot controllers **must provide their own command watchdog/deadman and emergency-stop behavior**; no generic UI can infer a safe neutral message for every topic. Integrations that start asynchronous work through opaque topic messages or services that return before physical completion need a tracked ROS action or the persistent runner. Do not use a quick service response as proof that a background actuator job finished.

New panels can therefore use existing ROS operations without implementing a second lock. An integration exposing a new asynchronous command transport must add its lifetime tracking at the gateway/robot boundary before relying on handover safety.

## Deployment boundary and compatibility

Rebuild the ROS stack with the frontend upgrade:

```bash
docker compose up -d --build ros-stack
```

Endpoint URLs and Caddy routes are unchanged. With session locking enabled, an old frontend can still observe the gateway but cannot issue unchecked writes. An updated frontend connected to raw legacy rosbridge receives no authority status and its command envelopes are rejected; it does not fall back to unsafe control. The upgraded runner is required for acquisition, including when no tree panel is open. Local recording replay does not connect to the gateway.

Run **one authority for a shared control domain**. Two independent gateways to the same hardware would have independent leases; exposing the private rosbridge or other command paths would bypass this boundary. Use the deployment's existing network access controls/authentication for trusted users. This change coordinates sessions; it does not add accounts or roles, and it cannot arbitrate unrelated native ROS publishers, shell tools, or trusted loopback/DDS peers.

### Optional browser-origin restriction

By default, the public gateway accepts cross-origin WebSockets for existing web and desktop deployments. To restrict which browser pages can connect, set `ROBOBOY_CONTROL_ALLOWED_ORIGINS` in Compose's environment file, then recreate the ROS stack:

```dotenv
ROBOBOY_CONTROL_ALLOWED_ORIGINS=https://robot.example,http://10.8.0.1,http://127.0.0.1:5173,tauri://localhost
```

Standalone gateways accept the same environment variable or `--allowed-origins` with a comma-separated list. Values match the exact browser `Origin` header: scheme, hostname, and port when present, with no path or trailing slash. There are no wildcard or subdomain matches, and unlisted origins receive HTTP 403 before a ROS connection or session is created. An empty setting preserves existing cross-origin behavior. Include every web address and the actual desktop webview origin used by the deployment. Opaque origins such as `null` are rejected unless explicitly listed; allowing `null` admits every opaque-origin browser page, not just one desktop app.

This is **browser-origin filtering, not user authentication**. Tornado permits clients without an `Origin` header, preserving native integrations, and non-browser clients can forge an allowed origin. Anyone with network access can still claim an available lease through those clients. Keep the endpoint behind the deployment's trusted network/VPN, firewall, or authenticated proxy; if using a proxy for authentication, restrict direct access to port 9090 as well. The UI's read-only/control states describe session ownership, not user permissions.

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

Add `-e CONTROL_SMOKE_EXTERNAL_LOCK=true` to the same isolated smoke command to exercise the
reference ROS policy node, its default-closed parameter, ordinary session acquisition, adoption,
action cancellation on disable, and policy heartbeat loss. No test targets real hardware.
