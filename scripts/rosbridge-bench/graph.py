#!/usr/bin/env python3
"""Synthetic ROS graph shaped like a busy robotic cell, for rosbridge load tests.

Defaults mirror a busy two-arm cell measured on 2026-09-30: /tf at ~1500 Hz from four publishers
(two 250 Hz arm drivers, two 500 Hz aggregators), ~50 nodes, ~330 topics,
~540 services and 10 action servers.

  graph.py tf <name> <rate_hz> <frames>   one TF publisher (run one process each)
  graph.py static                          the latched /tf_static set
  graph.py graph <nodes>                   idle nodes with topics, services and actions
  graph.py cloud <rate_hz> <points>        an XYZRGB PointCloud2 on /bench/points
"""
import math
import sys
import time

import rclpy
from rclpy.action import ActionServer
from rclpy.executors import SingleThreadedExecutor
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile
from geometry_msgs.msg import TransformStamped
from sensor_msgs.msg import PointCloud2, PointField
from std_msgs.msg import String
from std_srvs.srv import Trigger
from tf2_msgs.action import LookupTransform
from tf2_msgs.msg import TFMessage


def transform(parent, child, stamp, t):
    msg = TransformStamped()
    msg.header.stamp = stamp
    msg.header.frame_id = parent
    msg.child_frame_id = child
    msg.transform.translation.x = 0.1 * math.sin(t)
    msg.transform.rotation.z = math.sin(t / 2)
    msg.transform.rotation.w = math.cos(t / 2)
    return msg


def tf_publisher(name, rate, frames):
    node = Node(name)
    publisher = node.create_publisher(TFMessage, '/tf', 100)
    links = [f'{name}_link_{i}' for i in range(frames + 1)]
    period = 1.0 / rate
    # A timer at 250-500 Hz drifts under load; pace against a deadline instead.
    deadline = time.monotonic()
    while rclpy.ok():
        now = time.monotonic()
        stamp = node.get_clock().now().to_msg()
        publisher.publish(TFMessage(transforms=[transform(links[i], links[i + 1], stamp, now + i)
                                                for i in range(frames)]))
        deadline += period
        delay = deadline - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        elif delay < -1:
            deadline = time.monotonic()


def static_publisher():
    node = Node('bench_static_tf')
    qos = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
    publisher = node.create_publisher(TFMessage, '/tf_static', qos)
    stamp = node.get_clock().now().to_msg()
    publisher.publish(TFMessage(transforms=[transform('world', f'fixture_{i}', stamp, i) for i in range(40)]))
    rclpy.spin(node)


def cloud_publisher(rate, points):
    import numpy as np
    node = Node('bench_cloud')
    publisher = node.create_publisher(PointCloud2, '/bench/points', 2)
    # A depth-camera-like surface: smooth depth with sensor noise, packed XYZ + RGB.
    side = int(math.sqrt(points))
    u, v = np.meshgrid(np.linspace(-1, 1, side), np.linspace(-1, 1, side))
    fields = [PointField(name=n, offset=4 * i, datatype=PointField.FLOAT32, count=1)
              for i, n in enumerate(['x', 'y', 'z', 'rgb'])]
    rng = np.random.default_rng(0)
    while rclpy.ok():
        depth = 1.5 + 0.2 * np.sin(3 * u + time.monotonic()) + rng.normal(0, 0.004, u.shape)
        data = np.stack([u * depth, v * depth, depth, np.full(u.shape, 1.0e-38)], axis=-1).astype(np.float32)
        msg = PointCloud2(height=side, width=side, fields=fields, is_bigendian=False, point_step=16,
                          row_step=16 * side, is_dense=True, data=data.tobytes())
        msg.header.frame_id = 'camera'
        msg.header.stamp = node.get_clock().now().to_msg()
        publisher.publish(msg)
        time.sleep(1.0 / rate)


def graph(count):
    executor = SingleThreadedExecutor()
    nodes = []
    for index in range(count):
        node = Node(f'bench_node_{index}', namespace=f'/cell/unit_{index}')
        # Rarely published topics, like most of a cell's graph.
        node.bench_topics = [node.create_publisher(String, f'status_{k}', 1) for k in range(6)]
        node.bench_services = [node.create_service(Trigger, f'command_{k}', lambda _req, res: res)
                               for k in range(3)]
        if index < 10:
            def execute(goal):
                goal.succeed()
                return LookupTransform.Result()
            node.bench_action = ActionServer(node, LookupTransform, f'/cell/unit_{index}/move', execute)
        executor.add_node(node)
        nodes.append(node)
    executor.spin()


if __name__ == '__main__':
    rclpy.init()
    mode = sys.argv[1]
    try:
        if mode == 'tf':
            tf_publisher(sys.argv[2], float(sys.argv[3]), int(sys.argv[4]))
        elif mode == 'static':
            static_publisher()
        elif mode == 'graph':
            graph(int(sys.argv[2]))
        elif mode == 'cloud':
            cloud_publisher(float(sys.argv[2]), int(sys.argv[3]))
    except KeyboardInterrupt:
        pass
