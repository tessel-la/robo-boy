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


class NativeBehaviorTreeRunner(Node):
    def __init__(self):
        super().__init__('robo_boy_native_behavior_tree_runner')
        group = ReentrantCallbackGroup()
        qos = QoSProfile(depth=100, reliability=ReliabilityPolicy.RELIABLE)
        self.publisher = self.create_publisher(String, '/robo_boy/bt/events', qos)
        self.commands = queue.Queue(maxsize=128)
        self.create_subscription(String, '/robo_boy/bt/command', self.receive, qos, callback_group=group)
        self.stopping = threading.Event()
        self.bridge = RosActionBridge(self, group)
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

    def publish(self, event):
        self.publisher.publish(String(data=json.dumps(event)))

    def run_manager(self):
        manager = RuntimeManager(self.publish, self.bridge)
        try:
            while not self.stopping.is_set():
                try:
                    request = self.commands.get(timeout=0.05)
                    manager.command(request)
                except queue.Empty:
                    pass
                manager.tick()
                # Retire cancelled clients even when the tree is no longer ticking.
                if not manager.session or manager.session['state'] != 'running':
                    self.bridge.poll()
        finally:
            manager.close()

    def shutdown_runtime(self):
        self.stopping.set()
        self.thread.join(timeout=15)


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
        node.shutdown_runtime()
        executor.shutdown()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
