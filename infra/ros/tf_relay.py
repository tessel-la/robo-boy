#!/usr/bin/env python3
"""Coalesce /tf into one message per display frame for remote clients.

A cell's /tf commonly runs at 1-2 kHz as several drivers publish disjoint frame
subsets. Forwarded one-for-one, that is a WebSocket message per TF message:
rosbridge saturates a CPU core, and on a VPN link its write queue fills and it
starts dropping outgoing messages, service responses included.

This node keeps the newest transform per child frame and publishes, at a fixed
rate, only the frames that changed since the last publish. Every transform keeps
its original header, so a browser still sees each frame's true stamp and can
tell when a publisher stops. It subscribes to /tf only while /roboboy/tf has a
subscriber, so an idle robot pays nothing.

  ROBOBOY_TF_RELAY_HZ   publish rate (default 60; 0 disables the relay)
"""
import os
import time

OUTPUT = '/roboboy/tf'
IDLE_GRACE_SECONDS = 5.0


class LatestPerFrame:
    """Newest transform per child frame since the last take()."""

    def __init__(self):
        self.pending = {}

    def add(self, transforms):
        for transform in transforms:
            self.pending[transform.child_frame_id] = transform

    def take(self):
        transforms, self.pending = list(self.pending.values()), {}
        return transforms


class Demand:
    """Follow /tf while anyone reads the relay, and for a grace period after the last leaves,
    so a browser reload does not drop and re-create the /tf subscription."""

    def __init__(self, grace=IDLE_GRACE_SECONDS):
        self.grace = grace
        self.active = False
        self.idle_since = None

    def wanted(self, readers, now):
        if readers > 0:
            self.active, self.idle_since = True, None
        elif self.active:
            self.idle_since = now if self.idle_since is None else self.idle_since
            if now - self.idle_since >= self.grace:
                self.active, self.idle_since = False, None
        return self.active


def main():
    rate = float(os.environ.get('ROBOBOY_TF_RELAY_HZ', '60') or 0)
    if rate <= 0:
        print('[tf_relay] disabled (ROBOBOY_TF_RELAY_HZ=0)', flush=True)
        return

    import rclpy
    from rclpy.executors import ExternalShutdownException
    from rclpy.node import Node
    from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
    from tf2_msgs.msg import TFMessage

    class TfRelay(Node):
        def __init__(self):
            super().__init__('roboboy_tf_relay')
            self.latest = LatestPerFrame()
            self.demand = Demand()
            self.source = None
            self.publisher = self.create_publisher(TFMessage, OUTPUT, 10)
            self.create_timer(1.0 / rate, self.flush)
            self.create_timer(0.5, self.follow_demand)

        def follow_demand(self):
            # rosbridge holds one subscription per topic for all of its clients.
            wanted = self.demand.wanted(self.publisher.get_subscription_count(), time.monotonic())
            if wanted and self.source is None:
                # Same QoS as tf2's TransformListener, so every publisher matches.
                qos = QoSProfile(depth=100, reliability=ReliabilityPolicy.RELIABLE,
                                 durability=DurabilityPolicy.VOLATILE)
                self.source = self.create_subscription(TFMessage, '/tf', self.receive, qos)
            elif not wanted and self.source is not None:
                self.destroy_subscription(self.source)
                self.source = None
                self.latest.take()

        def receive(self, message):
            self.latest.add(message.transforms)

        def flush(self):
            transforms = self.latest.take()
            if transforms:
                self.publisher.publish(TFMessage(transforms=transforms))

    rclpy.init()
    node = TfRelay()
    try:
        # The C++ events executor costs far less per message than the Python executors.
        try:
            from rclpy.experimental import EventsExecutor
            executor = EventsExecutor()
        except ImportError:
            from rclpy.executors import SingleThreadedExecutor
            executor = SingleThreadedExecutor()
        executor.add_node(node)
        executor.spin()
    except (KeyboardInterrupt, ExternalShutdownException):
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
