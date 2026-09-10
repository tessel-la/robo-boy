# Multi-connection architecture

This document defines how Robo-Boy owns multiple live ROS connections. The connection layer is the
foundation; the tab bar is only a view over it.

## Existing architecture

Before multi-connection support, `App` held one `ConnectionParams` value and mounted one
`RuntimeConfigProvider` and one `MainControlView`. `MainControlView` called `useRos`, then passed the
resulting `ROSLIB.Ros` object into every built-in and external panel.

That boundary is useful and remains intact:

- `useRos` owns one WebSocket, its ROSLIB listeners, visibility/online recovery, generation number,
  and final `close()`.
- `MainControlView` owns one workspace's in-memory state, topic discovery, and persistent behavior
  tree monitor.
- Each panel or feature hook owns the topics, publishers, services, streams, timers, animation
  frames, observers, and DOM listeners it creates.
- Unmounting a panel is its cleanup signal. Built-in panels unsubscribe/unadvertise and dispose
  visual resources; `ExternalPanelHost` disposes its iframe capability broker, which aborts network
  requests and removes ROS resources.

The global workspace local-storage keys were the main violation of this ownership model. Two
mounted workspaces would overwrite each other's panel definitions, layout, approved external-panel
topics, and panel state.

## Ownership model

```text
App
  ConnectionSession A (stable id + immutable params + runtime endpoint provider)
    useRos A (one ROSLIB.Ros / WebSocket)
    MainControlView A (one isolated workspace)
      active: mounted panel resource subtrees + top-bar connection navigation
      background: no panel resource subtrees; lightweight connection monitor only
  ConnectionSession B
    useRos B
    MainControlView B
```

Every connection session has immutable connection parameters. Changing a target means opening a new
session, not mutating an existing session underneath consumers. A canonical target key is derived
from the runtime-resolved ROS, video, and mesh endpoints. Only one live tab may own a canonical
target; asking to open the same target focuses the existing tab instead of creating a duplicate
socket and duplicate publishers.

The session owns its `RuntimeConfigProvider`, so camera, mesh, WebRTC, ROS bridge, and external-panel
endpoints always come from the same target as its ROS object.

## Lifecycle

| State | Connection owner | Workspace resources | Transition |
| --- | --- | --- | --- |
| Creating | Mounted; opens one ROSLIB socket | Active tab may show connecting state | New unique target |
| Active | Socket stays open; visibility/online recovery applies | Panel subtree mounted | Select tab |
| Background | Socket stays open; persistent ROS-owned execution monitor remains | Panel subtree unmounted; streams, subscriptions, publishers, timers, animation loops, and iframe brokers clean up | Select another tab or the add-connection view |
| Disconnected | Session remains addressable and can reconnect | No ROS-dependent panel resources | Bridge error/close |
| Closing | First becomes background so controls publish neutral values and local execution stops while the socket still exists | Cleanup completes before session removal | Close tab or workspace disconnect |
| Closed | `useRos` closes its socket and ignores stale callbacks | Session state is unreachable | Remove session |

Switching tabs never reconnects a healthy socket. Returning to an active tab remounts its panel
resources against the same ROS object. A dropped socket is not recreated merely because the user
switches tabs; the existing reconnect control remains explicit. Browser resume and network-online
recovery continue to recreate each affected session with its own saved parameters and increment its
connection generation.

Browser-local behavior-tree execution is stopped when its tab becomes background. It cannot safely
continue after its owning React controls and cancellation state are suspended. ROS-owned persistent
execution continues on the robot and is intentionally monitored by the lightweight session shell,
so the tab can report and regain control of it on return.

## State boundaries

Connection-specific state is namespaced by canonical target key:

- open workspace panels and recursive split layout;
- panel order, saved workspace layouts, and active layout;
- camera selection stored in panel definitions;
- visualization configuration stored by workspace panel id;
- external-panel storage and user-approved ROS topics.

The pre-multi-connection workspace is claimed once by the first canonical target that opens it. This
preserves an existing user's layout without cloning robot-specific state into every later target.

User-library and application state remains global because it is deliberately reusable across
robots: themes, custom pad definitions, saved behavior trees, panel installations/enabled state,
and connection history. Runtime values and ROS clients are never placed in those stores.

In-memory React state is isolated naturally because every tab has its own `MainControlView`
instance. ROS callbacks must still validate that their `Ros` instance/generation is current before
updating state.

## Cleanup invariants

1. Exactly one `useRos` owner exists for each live canonical target.
2. Selecting a tab changes activation only; it does not replace its `Ros` instance.
3. A background tab has no mounted panel resource subtree.
4. Closing is two-phase: deactivate first, then remove the session. This lets publisher cleanup send
   neutral control messages before the socket closes.
5. Removing a session always unmounts `useRos`, which closes the WebSocket even if the tab was
   already disconnected.
6. Stale ROS connection/error/close callbacks cannot update a replacement session generation.
7. External-panel broker cleanup aborts requests, unsubscribes topics, unadvertises publishers, and
   closes the message port.
8. Connection-specific storage keys never overlap between canonical targets.

## Responsiveness policy

Only the active tab renders camera streams, Three.js viewers, ROS visualization subscriptions,
gamepad publishers, TF tree updates, or external iframes. Background sessions retain one WebSocket,
connection listeners, one topic-discovery result, and (when supported) one persistent-execution
status monitor. This keeps switching fast without multiplying render loops or high-bandwidth ROS
subscriptions as tabs accumulate.

Connection navigation is part of the existing workspace top bar, not a second application bar. On
wide screens it exposes the open sessions as compact inline tabs. At 900px and below it collapses to
one active-connection button with a status indicator; activating that button opens a temporary
popover with every session's connected, connecting, or disconnected state plus switch, close, and
add actions. The add-connection screen uses the same compact header only while that screen is open,
so an existing session remains one quick selection away without permanently reducing workspace
height.

## Edge cases

- Closing the active tab activates the nearest remaining tab; closing the last tab returns to the
  connection screen.
- Closing a background tab does not disturb the active tab.
- Opening the connection screen backgrounds the current tab but does not close it; cancelling or
  selecting an existing tab restores it without reconnecting.
- A duplicate target request focuses the existing session.
- Connection failure is local to its tab. Other tabs and their status remain unchanged.
- A late callback from a closed socket is ignored by the owning `useRos` instance.
- Browser visibility restoration and `online` events operate per session and never borrow another
  tab's parameters.
- A tab label is derived from normalized host/domain data, while its accessible description includes
  ports so similarly named targets remain understandable.

## Incremental implementation plan

1. Add pure connection identity/label helpers and test canonicalization and duplicate detection.
2. Add accessible connection navigation and the session collection in `App`; keep each session's
   runtime provider and `MainControlView` mounted.
3. Add active/background behavior to `MainControlView` and status reporting to the tab shell.
4. Namespace workspace persistence and provide a one-time legacy workspace claim.
5. Verify switching does not create another ROSLIB instance, closing deactivates before `close()`,
   background panel resources unmount, and failures remain session-local.
6. Run focused lifecycle tests, the full unit suite, lint, and build.
