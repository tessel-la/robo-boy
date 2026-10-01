# Native XML examples

Import these XML files using the Behavior Tree menu. BehaviorTree.CPP is identified
by `BTCPP_format="4"`; choose **py_trees** for the marker-free Python file.
Both run the same Genesis `MoveEndEffector` action and then wait for 200 ms.
The real native sequence/ports/blackboard semantics are retained.

Connect ROS, open a file or repository tree, select its runtime and Run. Engines
are discovered automatically and can be enabled separately in the tree menu.
Run loads the current source on the host. Tree states shows native
node statuses; Feedback and results shows the action output. Stop/cancel halts
active ROS goals; reset constructs a fresh native tree with clean blackboards;
Run after completion resets before starting again.

The Genesis interface overlay must be sourced on the executor host. See
[the runtime guide](../../docs/behavior-trees/runtime.md) for installation and
isolated Genesis tests. These examples move the end effector; use the mock
simulation for deterministic integration testing.
