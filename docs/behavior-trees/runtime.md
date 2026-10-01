# Behavior Tree execution on a ROS host

Robo Boy supports native **BehaviorTree.CPP** and **py_trees 2.6** execution.
The Behavior Tree panel uses one menu, toolbar, palette and canvas for JSON
and both native XML formats. The engine selector changes the available node
library; **New** creates a tree for that engine. **Open file** and repository loading
use the same menu for every format. The engine pill automatically follows detected tree syntax: `BTCPP_format="4"` identifies
C++; Python controls with `memory`/`policy` and distinctive built-ins identify py_trees.
Shared marker-free syntax (for example, a lone custom `Wait`) still requires an explicit engine choice. XML source retains native ports, subtrees and metadata. Visual editing composes native XML using the selected engine’s node definitions; it does not translate between engines. Layout-only edits leave the executable XML unchanged.
The shared tree menu opens, saves and exports both JSON and XML trees. **Open
local folder** lists JSON/XML tree files from a folder or checked-out repository. Files show their name, subfolder and format; search filters the list. GitHub browsing is not part of the tree panel. XML export
preserves source, while browser saves also retain the chosen runtime and main tree.

1. Connect to the ROS host. Runtime discovery happens automatically.
2. Open XML from a file, repository or saved tree. The matching engine is selected automatically when syntax identifies it; choose an engine for
   ambiguous marker-free XML. Select the main tree when a multi-tree document does not
   specify one; a single tree is inferred automatically.
3. Press **Run**. Robo Boy loads the current XML on the host and starts execution.
   The menu offers **Check tree** to validate on ROS without executing. Run handles loading automatically.
4. The canvas shows idle/running/success/failure. The palette lists this engine's
   registered nodes, saved documents and subtrees in the current XML. Click
   **View** next to a subtree to inspect its definition without changing the executable main tree. Tap the subtree entry to append an instance, or drag it onto the canvas and connect it. During execution,
   the main graph stays collapsed and subtree nodes show their live states. Double-click a
   subtree node to open that exact instance and its running leaves. **Parent tree** returns
   one level; repeated and nested subtree instances keep separate native state bindings.
   Loading on the host, reset and rerun preserve the current view. Manual zoom/pan turns off **Follow**;
   incoming ticks do not fit or rearrange the canvas.
   Click a node to inspect its ports, native status and execution details.
   **XML source** in the menu opens an inspector in the same canvas; Escape
   closes it. There is no permanent feedback/results log. Nodes retain their
   last observed result when native controls reset them to idle within a tick.
   Reset clears these results.
5. **Stop** or **Cancel** halts the tree and requests cancellation of active goals.
   **Reset** reconstructs the original tree and blackboard. **Run** after a terminal
   result resets it automatically before rerunning.

Switching engines preserves the open document. Run is disabled until the
selected engine matches the document and is available and enabled on the host.
Both native engines support dragging, connections, port/attribute editing, child priority, branch deletion, layout, and undo/redo (toolbar or Ctrl/Cmd+Z). Tap palette entries to append to the root control; drag to place disconnected nodes, then connect the bottom parent handle to the top child handle. Click a node to edit ports; braced values such as `{target}` bind to the native blackboard. **Earlier/Later** changes child execution order. Execution locks editing. AI generation and pause remain unavailable for native trees.

To compose a tree from a repository, select an engine and choose **New**. In the menu, **+ Add** next to a folder's XML file or **Import subtree file** adds all of its definitions, nested dependencies and port metadata to the current document. Add those definitions from the palette, configure their ports, and choose **Tree to run** before running. Libraries must use the same engine and be self-contained; includes/imports must be inlined. Conflicting IDs are rejected atomically. An optional **Library prefix** explicitly renames definitions and references; Python subtree namespaces may change. Repeat to combine several files.

**Save** retains disconnected drafts and node positions in browser storage. **Export** downloads executable native XML, so all definitions must have one connected root and valid control/decorator arity. JSON envelopes containing native documents also retain drafts when opened. Editing **XML source** replaces the visual draft; save first to retain unconnected nodes. Unknown custom node ports/arity remain owned by the host and are checked through **Check tree**. Subtree browsing remains available during execution.

Runtime availability/version and failure reasons are visible. An unavailable
backend never causes execution with the other backend. A lost ROS connection
leaves remote ownership unchanged; the panel reports lost visibility and cannot
claim cancellation succeeded. Reconnect/Discover retrieves host status; **Open
host tree** in the menu adopts an existing remote document. Cancellation acknowledgement
means native halt completed and ROS goal cancellation was requested; the ROS
action server owns the physical stop and may acknowledge it asynchronously.

The menu's **Execution engines · ROS host** has separate switches for
BehaviorTree.CPP and py_trees. Both are enabled initially. Disabling an engine
halts its tree, requests cancellation of its ROS goals and closes its worker;
the engine disappears from the toolbar selector and its palette entries are disabled. The open document is preserved. Re-enable it and **Run** to reset
and rerun. The execution pill beside Run shows Ready, Running, Succeeded, Failed or a connection/engine issue; a hover explains the state. Subtree navigation sits above the canvas, and host-tree recovery is in the menu. These settings belong to the connected host and last until its
executor restarts. **Discover engines** refreshes availability manually.

## Installation and ROS interfaces

The standard `infra/docker/Dockerfile.ros` installs both runtimes and
py_trees_ros. It pins py_trees 2.6 in a ROS-compatible venv. The entrypoint starts
`native_behavior_tree_runner.py` next to rosbridge. Use one endpoint per ROS
graph; `ROBOBOY_NATIVE_BT_RUNTIME=0` disables it when Genesis supplies the endpoint.
The executor host must source the robot's interface overlays.

When updating an existing Docker deployment, rebuild and recreate `ros-stack`
using the same Compose files and interface overlays as the running deployment.
Restarting the frontend or restarting an old ROS image does not install the new
executors. If discovery receives no acknowledgement, check that
`native_behavior_tree_runner.py` is running on the connected ROS host.

For an existing ROS installation, install BehaviorTree.CPP v4, nlohmann_json,
py_trees 2.6, py_trees_ros and rclpy. Build `infra/ros/bt_cpp` with CMake and put
`robo-boy-btcpp` in `/usr/local/bin` (or set `ROBOBOY_BTCPP_WORKER`). Run
`infra/ros/native_behavior_tree_runner.py` from the sourced ROS environment.
The worker's Python interpreter must include the newer XML/ports parser.
Discovery probes the executors themselves and reports missing libraries/parser.

Protocol v2 uses standard `std_msgs/msg/String` JSON over
`/robo_boy/bt/command` and `/robo_boy/bt/events`. Both backends expose
`discover`, `set_enabled`, `validate`, `load`, `start`, `stop`, `cancel`, `reset`, `status`.
Request IDs, session IDs, monotonic sequences and host boot IDs keep state
synchronized. The host serializes mutations and rejects replacement during a
run, stale sessions and unsafe XML. See [the design](design.md) for the schema.

## XML semantics and nodes

Native factories/parsers are authoritative for registered nodes, ports and
behavior. Both support self-contained documents with multiple subtrees.
Remote uploads reject includes/imports, DTDs and entities; inline library files
explicitly. Uploads are bounded at 512 KiB, 2048 expanded nodes and depth 64.

For py_trees' built-in composites, memory must be `true` or `false`; Parallel
supports `success_on_all` and `success_on_one`. Unknown control attributes and
policies are rejected because the experimental upstream parser otherwise ignores
some options or substitutes a policy. `success_on_selected` is unsupported until
the native XML parser can identify selected children. Registered host classes own
their constructor arguments and ports.

Included nodes are `Wait(seconds)`, `RosAction`, `JsonGet` and `JsonSet` plus native framework nodes.
py_trees' Success/Failure/Running/Dummy leaves are PortsMixin wrappers around
the native behavior classes, required by its upstream XML parser. Runtime
Discovery returns actual node registration IDs. `RosAction` accepts:

| Port | Meaning |
| --- | --- |
| `action_name` | Absolute ROS action server name |
| `action_type` | ROS action interface, e.g. `genesis_manipulator_interfaces/action/MoveEndEffector` |
| `goal` | JSON object string from a blackboard port reference |
| `goal_b64` | Base64 UTF-8 JSON object; use for literal XML goals |
| `timeout` | Deadline in seconds, greater than zero and at most 3600 |
| `result` | Optional JSON result output port |

Both native parsers interpret braced port values as blackboard references.
Literal JSON therefore uses the explicit `goal_b64` port in both XML formats. This preserves the parser's remapping semantics and does not
rewrite user source. `goal_b64` takes precedence when
provided. Encode with `base64.b64encode(json.dumps(goal).encode()).decode()`.

`JsonGet` reads a top-level `field` from an input JSON object (`json`) and writes
its JSON-serialized value to `value`. Missing fields return FAILURE; invalid JSON
or a non-object input raises a native execution error. `JsonSet` starts with an
empty object when `json` is omitted, parses the JSON-serialized `value`, assigns
`field`, and writes the object to `result`. It raises an error for malformed data.
Strings therefore retain JSON quotes when extracted; the paired setter parses
them back into strings. These are registered native leaves in each worker.
Snapshots preserve configured runtime port wiring (including py_trees absolute
blackboard namespaces); the source inspector retains exact original attributes.

Trusted host operators can register additional node implementations:
`ROBOBOY_BTCPP_PLUGINS` is a colon-separated list of shared-library paths;
`ROBOBOY_PY_TREES_MODULES` is a colon-separated list of Python module names.
The graph-based AI proposal editor remains available for Robo Boy JSON trees;
native XML offers visual port editing and source editing while preserving framework semantics.

These execute trusted host code and cannot be selected by uploaded XML.
py_trees_ros setup passes a ROS node and spins callbacks for registered ROS
behaviors. Its native action behavior can be combined with PortsMixin in such
a module. BT.CPP ROS2 plugins can likewise register native middleware behaviors.
Both workers isolate session blackboards and propagate native exceptions.

## Genesis and tests

Equivalent native examples live in `examples/behavior_trees` and in Genesis's
examples directory. Genesis's `docker-compose.bt.yml` overlay supplies an
optional ROS executor sidecar, using its existing ROS action servers and shared
interface overlay. Its guide documents how to avoid duplicate endpoints.

```sh
./scripts/test-native-bt-genesis.sh
```

This builds both real libraries, generates Genesis action interfaces, launches
Genesis's deterministic mock API, its real ROS action bridge, rosbridge and the
native host runner in an isolated container. It exercises both backends through
actual ROS command/event topics: discovery, native validation/loading,
RUNNING/success/failure, live action feedback/results, cancellation, reset/rerun,
and reconnect. Native worker tests also exercise backend-specific control flow,
subtrees/scripting, invalid XML, missing nodes, crashes and stale commands.

For browser integration against this image:

```sh
docker run --rm -p 9091:9090 --name robo-boy-genesis-bt-browser \
  robo-boy-genesis-bt:test sleep infinity
ROBOBOY_BT_E2E_URL=ws://localhost:9091 npm run e2e -- e2e/native-bt-genesis.spec.ts --project=chromium --workers=1
```

When the frontend is served from `127.0.0.1`, `localhost` selects the direct-host
route; same-host connections normally use the deployment proxy.

The regular frontend suite tests format preservation and remote state
synchronization without a ROS installation. Real Genesis physics can use the
same XML and optional Compose overlay; mock validation does not prove collision
planning or GPU rendering behavior.

### Validation recorded on 1 October 2026

The integration image runs BehaviorTree.CPP **4.10.0**, py_trees **2.6.0** and
py_trees_ros on ROS Jazzy. All **31 native/ROS tests** pass, including both richer
example pairs, explicit subtree ports, JSON goal construction, recovery,
reset/rerun and C-level stdout isolation. Both pairs execute and rerun through
real ROS actions in the deterministic Genesis mock environment.

All **260 frontend Behavior Tree tests** and **35 Chromium workflows** pass across JSON editor regressions, shared
repository loading and ten native runtime/example workflows. Repository tests
verify the shell stays mounted, source survives engine switching, saved engine
metadata persists, and mobile inspectors/menu fit the viewport. Native tests
verify independent engine switches, cancellation, reconnect, node details and
four richer action trees. Authoring tests cover pointer-based dragging/connections, saved disconnected drafts, undo/redo, atomic library imports with explicit prefixes, native ports and child priority, validation/execution, reset/rerun, and XML export/reimport for both engines. Screenshots confirm shared toolbar/canvas styling.

The frontend suite, type check, lint and production build pass. Genesis's
**22 tests** pass. The connected live ROS executor was discovered before its
idle service was updated, retaining domain 14, CycloneDDS and the Genesis
interface overlay. Both engines acknowledge commands and validate all four
new examples on that host without replacing its existing session.

The simulation tests use Genesis's mock backend; actual GPU physics, collision
planning and rendering have not been validated. CI runs the native/ROS suite
and Chromium workflows in its native BT job.
