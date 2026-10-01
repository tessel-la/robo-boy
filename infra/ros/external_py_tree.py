#!/usr/bin/env python3
"""Independent py_trees_ros application; Robo Boy discovers its snapshot services."""
import time
import rclpy
import py_trees
import py_trees_ros


class RobotWait(py_trees.behaviour.Behaviour):
    def initialise(self):
        self.deadline = time.monotonic() + 1.2

    def update(self):
        self.feedback_message = 'Waiting for robot operation'
        if time.monotonic() < self.deadline:
            return py_trees.common.Status.RUNNING
        self.feedback_message = 'Robot operation complete'
        return py_trees.common.Status.SUCCESS


class RobotOutcome(py_trees.behaviour.Behaviour):
    succeed = True
    def update(self):
        self.feedback_message = 'Robot result: ' + ('success' if self.succeed else 'failure')
        return py_trees.common.Status.SUCCESS if self.succeed else py_trees.common.Status.FAILURE


def main():
    rclpy.init()
    phases = []
    for name in ('Approach', 'Inspect'):
        phase = py_trees.composites.Sequence(name=name, memory=True, children=[RobotWait('Robot wait'), py_trees.behaviours.Success('Phase complete')])
        phase.blackbox_level = py_trees.common.BlackBoxLevel.COMPONENT
        phases.append(phase)
    outcome = RobotOutcome('Robot outcome')
    root = py_trees.composites.Sequence(name='ExternalPy', memory=True, children=[*phases, outcome])
    tree = py_trees_ros.trees.BehaviourTree(root=root)
    tree.setup(node_name='external_python_robot')  # default stream off; discover via OpenSnapshotStream
    try:
        while rclpy.ok():
            rclpy.spin_once(tree.node, timeout_sec=.01)
            tree.tick()
            if root.status != py_trees.common.Status.RUNNING:
                deadline = time.monotonic() + 1
                while time.monotonic() < deadline:
                    rclpy.spin_once(tree.node, timeout_sec=.05)
                root.stop(py_trees.common.Status.INVALID)
                outcome.succeed = not outcome.succeed
            time.sleep(.1)
    except (KeyboardInterrupt, rclpy.executors.ExternalShutdownException):
        pass
    finally:
        tree.shutdown()
        if rclpy.ok(): rclpy.shutdown()


if __name__ == '__main__': main()
