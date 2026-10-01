# Behavior Tree execution on a ROS host

Robo Boy supports native **BehaviorTree.CPP** and **py_trees 2.6** execution.
The Behavior Tree menu's **New XML tree** / **Import** opens a common XML
workspace. Choose a runtime for marker-free XML; `BTCPP_format="4"` identifies
C++. XML source is saved exactly, including ports, subtrees and metadata. Visual
node graphs show the native host topology and cannot change source semantics.
The shared tree menu opens, saves and exports both JSON and XML trees. **Open
local folder** lists tree files from a checked-out repository. **Browse repository**
opens a public GitHub repository with an optional branch, tag or commit; downloads
are pinned to blob IDs. Use a local checkout for private repositories. XML export
preserves source, while browser saves also retain the chosen runtime and main tree.

1. Connect to the ROS host. Runtime discovery happens automatically.
2. Open XML from a file, repository or saved tree. Choose its runtime for
   marker-free XML. Select the main tree when a multi-tree document does not
   specify one; a single tree is inferred automatically.
3. Press **Run**. Robo Boy loads the current XML on the host and starts execution.
   The menu also offers **Validate** and **Load on host** for separate checks.
4. Use **Tree states** for idle/running/success/failure and native status metadata.
   **Feedback and results** contains ROS feedback, output messages and errors.
   Nodes retain their last observed result separately when native controls reset
   them to idle within a tick. Reset clears these results.
5. **Stop** or **Cancel** halts the tree and requests cancellation of active goals.
   **Reset** reconstructs the original tree and blackboard. **Run** after a terminal
   result resets it automatically before rerunning.

Runtime availability/version and failure reasons are visible. An unavailable
backend never causes execution with the other backend. A lost ROS connection
leaves remote ownership unchanged; the panel reports lost visibility and cannot
claim cancellation succeeded. Reconnect/Discover retrieves host status; **Show
host tree** adopts an existing remote document. Cancellation acknowledgement
means native halt completed and ROS goal cancellation was requested; the ROS
action server owns the physical stop and may acknowledge it asynchronously.

The menu's **Execution engines · ROS host** has separate switches for
BehaviorTree.CPP and py_trees. Both are enabled initially. Disabling an engine
halts its tree, requests cancellation of its ROS goals and closes its worker;
the document remains available for editing. Re-enable it and **Run** to reset
and rerun. These settings belong to the connected host and last until its
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

Included nodes are `Wait(seconds)` and `RosAction` plus native framework nodes.
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

Trusted host operators can register additional node implementations:
`ROBOBOY_BTCPP_PLUGINS` is a colon-separated list of shared-library paths;
`ROBOBOY_PY_TREES_MODULES` is a colon-separated list of Python module names.
The graph-based AI proposal editor remains available for Robo Boy JSON trees;
native XML uses source editing to preserve framework semantics.

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
py_trees_ros on ROS Jazzy. The 27 native/ROS tests pass; shared tests exercise
both backends, including cancellation acceptance races, unavailable runtimes,
native exceptions, transactional loading and reset after a worker crash.
Both Chromium workflows pass against the actual ROS/rosbridge/Genesis action
bridge, including disabling an engine during a live action and original XML
recovery after reloading during execution. Two repository browser workflows pass
for shared JSON/XML local folders and public GitHub loading.
The 23 existing Behavior Tree editor browser tests also pass, covering JSON
editing, import, undo, responsive layouts and execution.

The frontend suite passes 1,492 tests across 191 files (10 existing skips);
lint and production build pass. Genesis's existing suite passes 21 tests and its
native executor Compose overlay validates. The simulation uses Genesis's mock
backend; actual GPU physics and rendering have not been validated.

CI runs the native/ROS suite and the Chromium workflows in its native BT job.
