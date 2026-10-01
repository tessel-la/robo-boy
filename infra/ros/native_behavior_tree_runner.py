#!/usr/bin/env python3
"""ROS host endpoint for both native Behavior Tree runtimes (protocol v2)."""
import json
import queue
import threading

import rclpy
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from rclpy.signals import SignalHandlerOptions
from rclpy.qos import QoSProfile, ReliabilityPolicy
from std_msgs.msg import String

from bt_runtime.manager import RuntimeManager
from bt_runtime.ros_bridge import RosActionBridge
from bt_runtime.groot_monitor import GrootMonitor


class NativeBehaviorTreeRunner(Node):
    def __init__(self):
        super().__init__('robo_boy_native_behavior_tree_runner')
        group = ReentrantCallbackGroup()
        qos = QoSProfile(depth=100, reliability=ReliabilityPolicy.RELIABLE)
        self.publisher = self.create_publisher(String, '/robo_boy/bt/events', qos)
        self.commands = queue.Queue(maxsize=128)
        self.observation_lock = threading.Lock()
        self.pending_observations = {}
        self.create_subscription(String, '/robo_boy/bt/command', self.receive, qos, callback_group=group)
        self.stopping = threading.Event()
        self.engine_enabled = {'btcpp': True, 'py_trees': True}
        self.bridge = RosActionBridge(self, group)
        import importlib.util
        if importlib.util.find_spec('zmq') is None:
            self.get_logger().warning('python3-zmq unavailable; external C++ monitoring disabled')
        self.groot_monitor = GrootMonitor(self.receive_observation, lambda runtime: self.engine_enabled[runtime])
        try:
            from bt_runtime.py_ros_monitor import PyRosMonitor
            self.py_monitor = PyRosMonitor(self, self.receive_observation, lambda runtime: self.engine_enabled[runtime])
        except ImportError:
            self.py_monitor = None
            self.get_logger().warning('py_trees_ros introspection interfaces unavailable; external Python monitoring disabled')
        self.thread = threading.Thread(target=self.run_manager, daemon=True)
        self.thread.start()

    def receive(self, message):
        if len(message.data) > 1024 * 1024:
            return
        try:
            request = json.loads(message.data)
            self.commands.put_nowait(request)
        except (ValueError, queue.Full):
            self.get_logger().warning('Ignoring malformed or excessive BT requests')

    def receive_observation(self, record):
        # Coalesce native snapshots separately: telemetry must never fill the
        # command queue or delay a robot application waiting on ROS callbacks.
        with self.observation_lock:
            source = record['source']
            if source in self.pending_observations or len(self.pending_observations) < 24:
                self.pending_observations[source] = record

    def publish(self, event):
        self.publisher.publish(String(data=json.dumps(event)))

    def run_manager(self):
        manager = RuntimeManager(self.publish, self.bridge)
        self.engine_enabled = manager.enabled
        try:
            while not self.stopping.is_set():
                try:
                    manager.command(self.commands.get(timeout=0.05))
                except queue.Empty:
                    pass
                with self.observation_lock:
                    records = list(self.pending_observations.values())
                    self.pending_observations.clear()
                for record in records:
                    try: manager.observe(record)
                    except (ValueError, KeyError, TypeError) as exc:
                        self.get_logger().warning('Invalid external BT observation: ' + str(exc))
                manager.tick()
                # Retire cancelled clients even when the tree is no longer ticking.
                if not manager.session or manager.session['state'] != 'running':
                    self.bridge.poll()
        finally:
            manager.close()

    def shutdown_runtime(self):
        self.groot_monitor.close()
        futures = self.py_monitor.close() if self.py_monitor else []
        self.stopping.set()
        self.thread.join(timeout=15)
        return futures


def main():
    # Keep ROS valid until tree halt and goal cancellation have been sent.
    rclpy.init(signal_handler_options=SignalHandlerOptions.NO)
    import signal
    def stop_signal(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGINT, stop_signal)
    signal.signal(signal.SIGTERM, stop_signal)
    node = NativeBehaviorTreeRunner()
    executor = MultiThreadedExecutor(num_threads=4)
    executor.add_node(node)
    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        futures = node.shutdown_runtime()
        import time
        deadline = time.monotonic() + 2
        while any(not future.done() for future in futures) and time.monotonic() < deadline:
            executor.spin_once(timeout_sec=.1)
        executor.shutdown()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
