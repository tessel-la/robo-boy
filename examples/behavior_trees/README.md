# Native XML examples

Open these files using the shared Behavior Tree **Import**, **Open local folder**
or **Browse repository** menu. C++ XML declares `BTCPP_format="4"`; choose
**py_trees** in the engine selector for Python XML. Enable each host engine with
its separate menu switch. Execution and actions run on the connected ROS host.

| Pair (`_btcpp.xml` and `_py_trees.xml`) | Demonstrates |
| --- | --- |
| `genesis` | One 1 cm ROS motion, result output and settling wait |
| `genesis_transfer` | Detect blue cube, extract its name, approach, grasp, transfer, release; `Pick` and `Place` subtrees with remapped input/output ports |
| `genesis_recovery` | Failed detection of `missing_cube`, fallback detection of `blue_cube`, then the same reusable pick/place workflow |

The larger examples use `JsonGet` and `JsonSet` to construct action goals from
live detection results. Blackboard values carry serialized JSON: extracting a
name preserves its quotes, and setting `object_id` decodes it back to a string.
Transfer distance is also passed as serialized data, avoiding C++ implicit
numeric subtree port inference. Subtree inputs (`object`, `offset`) and outputs
(`picked`, `released`) are explicit; intermediate goals remain local to the
subtree. C++ includes `TreeNodesModel` port metadata. py_trees uses explicit
`memory="true"` and its native `Selector`; C++ uses native `Sequence` and
`Fallback`. Files retain their own framework semantics and are not translated.

Press **Run** to load and execute. Open the palette to browse `Main`, `Pick` and
`Place`; browsing does not change the execution entrypoint. Click nodes to inspect
ports and execution details. The menu's **XML source** opens a source inspector
within the same canvas. Stop/Cancel halt active goals; Reset reconstructs the
native tree and blackboard. Run after completion resets before rerunning.

The Genesis interface overlay must be sourced on the executor host. See
[the runtime guide](../../docs/behavior-trees/runtime.md) for installation and
isolated tests. The richer examples move, grasp and release simulation objects;
use the mock simulation for deterministic protocol validation. Actual physics
may require tuning motion, standoff and grasp distance for the current scene.
