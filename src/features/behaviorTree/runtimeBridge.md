# Behavior Tree Runtime Bridge

Robo Boy treats external behavior tree engines as runtime publishers. The UI
does not need to know whether the runtime is py_trees, BehaviorTree.CPP, a
simulator, or a robot stack. It subscribes to generic ROS `std_msgs/msg/String`
topics and expects JSON when a bridge is available.

The standalone ROS2 implementation lives in:

```text
/home/riccardo/code/behaviour_bridge
```

That package can be mounted or added to any colcon workspace. The manipulator
simulation can mount it from `../behaviour_bridge`; its `py_trees_runner` also
publishes this same contract directly while ticking a tree.

## Topics

Default topics:

- `/behavior_tree/runtime/nodes`: published catalog of currently available
  runtime nodes and trees.
- `/behavior_tree/runtime/capabilities`: supported node types, constraints, and
  optional tree list for the selected engine.
- `/behavior_tree/runtime/trees`: available behavior tree specs for the engine.
- `/behavior_tree/runtime/spec`: editable tree spec sent from Robo Boy to the
  runtime.
- `/behavior_tree/runtime/command`: JSON command input for `load`, `run`,
  `load_and_run`, and `stop`.
- `/behavior_tree/runtime/status`: live node status updates.
- `/behavior_tree/runtime/tree`: optional full runtime tree payload.

Per-runtime namespaces can expose the same topics under a namespace, for
example `/arm_1/behavior_tree/runtime/nodes`.

## Node Catalog

Publish a JSON string:

```json
{
  "trees": [
    {
      "id": "main_tree",
      "name": "Main Tree",
      "nodes": [
        {
          "id": "root",
          "name": "Root",
          "type": "Sequence",
          "status": "RUNNING"
        },
        {
          "id": "approach",
          "name": "Approach Object",
          "type": "ApproachObject",
          "parentId": "root",
          "status": "SUCCESS"
        }
      ]
    }
  ]
}
```

Node fields:

- `id`: stable runtime id, uid, or full path.
- `name`: display name.
- `type`: engine node kind or registered BT.CPP node type.
- `status`: `IDLE`, `RUNNING`, `SUCCESS`, or `FAILURE`.
- `treeId`: optional when the node is not nested inside a `trees[]` entry.
- `parentId`: optional parent runtime node id.
- `path`: optional fully-qualified path.

## Status Updates

The status topic may publish the full catalog again, or a compact map:

```json
{
  "nodes": {
    "root": "RUNNING",
    "approach": "SUCCESS"
  }
}
```

## Commands

Robo Boy publishes command JSON to `/behavior_tree/runtime/command`:

```json
{
  "command": "load_and_run",
  "treeId": "inspection_tree",
  "name": "Inspection Tree",
  "engine": "py_trees",
  "format": "yaml"
}
```

Supported commands are runtime-defined, but the common set is:

- `load`: build the selected tree without starting it.
- `run`: start the currently loaded tree.
- `load_and_run`: load the latest spec and execute it.
- `stop`: stop the active tree.

## Capabilities

Runtimes publish node types and constraints:

```json
{
  "engine": "py_trees",
  "nodeTypes": [
    {
      "id": "move_relative",
      "label": "Move Relative",
      "category": "action",
      "params": [
        { "name": "up", "type": "number", "default": 0.05 }
      ]
    }
  ],
  "constraints": ["Exactly one root node is required"]
}
```

## Engine Adapters

For py_trees, a ROS2 adapter can translate py_trees snapshots into the catalog.
Robo Boy also accepts ascii tree/snapshot strings as a best-effort fallback.

The manipulator simulation includes a `behavior_tree_runtime_server` node that
publishes capabilities, tree specs, runtime catalogs, and accepts specs/commands
under each arm namespace, e.g. `/arm_1/behavior_tree/runtime/*`.

For BehaviorTree.CPP, a bridge can read Groot/ZMQ telemetry in Python or C++ and
republish the catalog/status JSON over ROS. Robo Boy also accepts BT.CPP XML
tree payloads on the tree topic and flattens them into selectable runtime nodes.
