"""Discover independent py_trees_ros trees through native ROS introspection."""
import time
import uuid
import threading
from functools import wraps
from rclpy.callback_groups import MutuallyExclusiveCallbackGroup

from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
from py_trees_ros_interfaces.msg import BehaviourTree
from py_trees_ros_interfaces.srv import OpenSnapshotStream, CloseSnapshotStream
from .observations import observation, py_ros_graph


def serialized(method):
    @wraps(method)
    def call(self, *args, **kwargs):
        with self.lock:
            return method(self, *args, **kwargs)
    return call


class PyRosMonitor:
    def __init__(self, node, receive, enabled):
        self.node, self.group, self.receive, self.enabled = node, MutuallyExclusiveCallbackGroup(), receive, enabled
        self.lock = threading.RLock()
        self.closed = False
        self.subscriptions, self.streams = {}, {}
        self.token = uuid.uuid4().hex[:12]
        self.qos = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        self.timer = node.create_timer(1.0, self.discover, callback_group=self.group)

    @serialized
    def subscribe(self, topic):
        if self.closed or topic in self.subscriptions or len(self.subscriptions) >= 16: return
        slot = {'record': None, 'subscription': None}
        def receive(message):
            with self.lock:
                self.receive_message(topic, slot, message)
        slot['subscription'] = self.node.create_subscription(BehaviourTree, topic, receive, self.qos, callback_group=self.group)
        self.subscriptions[topic] = slot

    def receive_message(self, topic, slot, message):
        if self.closed or not self.enabled('py_trees'): return
        try:
            name, nodes = py_ros_graph(message)
            record = observation('py_trees', 'py_trees:' + nodes[0]['id'], name, topic, nodes)
            slot['record'] = record
            self.receive(record)
        except (ValueError, TypeError, AttributeError) as exc:
            self.node.get_logger().warning('Invalid py_trees telemetry: ' + str(exc))
            if slot['record']:
                slot['record'] = {**slot['record'], 'connected': False, 'error': 'Invalid py_trees telemetry: ' + str(exc)}
                self.receive(slot['record'])

    @serialized
    def remove(self, topic, reason):
        slot = self.subscriptions.pop(topic)
        self.node.destroy_subscription(slot['subscription'])
        if slot['record']:
            self.receive({**slot['record'], 'connected': False, 'error': reason})

    @serialized
    def discover(self):
        if self.closed: return
        if not self.enabled('py_trees'):
            for topic in list(self.subscriptions): self.remove(topic, 'Engine monitoring is disabled')
            self.close_streams()
            return
        topics = {name for name, types in self.node.get_topic_names_and_types()
                  if not name.startswith('/robo_boy_py_trees_worker_') and 'py_trees_ros_interfaces/msg/BehaviourTree' in types and self.node.count_publishers(name) > 0}
        for topic in list(self.subscriptions):
            if topic not in topics: self.remove(topic, 'py_trees snapshot publisher is no longer available')
        for topic in sorted(topics)[:16]:
            if topic not in self.subscriptions: self.subscribe(topic)
        services = {name for name, types in self.node.get_service_names_and_types()
                    if not name.startswith('/robo_boy_py_trees_worker_') and 'py_trees_ros_interfaces/srv/OpenSnapshotStream' in types}
        for service in sorted(services)[:16]:
            if not service.endswith('/snapshot_streams/open'): continue
            base = service[:-len('/snapshot_streams/open')]
            slot = self.streams.get(service)
            if slot:
                if slot.get('future') and time.monotonic() - slot['requested'] > 10:
                    slot['abandoned'] = True
                    self.streams.pop(service)
                    self.close_stream(slot)
                continue
            if any(topic.startswith(base + '/') for topic in topics): continue
            client = self.node.create_client(OpenSnapshotStream, service, callback_group=self.group)
            request = OpenSnapshotStream.Request()
            request.topic_name = base + '/snapshot_streams/robo_boy_' + self.token
            request.parameters.snapshot_period = .1
            request.parameters.blackboard_data = False
            request.parameters.blackboard_activity = False
            future = client.call_async(request)
            slot = dict(client=client, future=future, requested=time.monotonic(), topic=request.topic_name, close=base + '/snapshot_streams/close')
            self.streams[service] = slot
            def opened(done, slot=slot, service=service):
                with self.lock:
                    slot['future'] = None
                    try:
                        response = done.result()
                        if not response or not response.topic_name:
                            raise ValueError('No snapshot topic returned')
                        slot['topic'] = response.topic_name
                        if self.closed or slot.get('abandoned') or not self.enabled('py_trees'):
                            self.close_stream(slot)
                        elif response.topic_name not in self.subscriptions:
                            self.subscribe(response.topic_name)
                    except Exception as exc:
                        self.node.get_logger().warning('Could not open py_trees snapshot stream: ' + str(exc))
                        if self.streams.get(service) is slot: self.streams.pop(service)
                    finally:
                        self.node.destroy_client(slot['client'])
            future.add_done_callback(opened)
        for service in list(self.streams):
            if service not in services:
                slot = self.streams.pop(service)
                slot['abandoned'] = True
                if not slot.get('future'): self.close_stream(slot)

    def close_stream(self, slot):
        # Only close streams created by this monitor. Existing streams belong to the robot.
        client = self.node.create_client(CloseSnapshotStream, slot['close'], callback_group=self.group)
        request = CloseSnapshotStream.Request()
        request.topic_name = slot['topic']
        if not client.service_is_ready():
            self.node.destroy_client(client)
            return None
        future = client.call_async(request)
        future.add_done_callback(lambda _: self.node.destroy_client(client))
        return future

    @serialized
    def close_streams(self):
        futures = []
        for slot in self.streams.values():
            slot['abandoned'] = True
            closing = self.close_stream(slot)
            if closing is not None: futures.append(closing)
            # A late open response closes its own stream again, without subscribing.
            if slot.get('future'): futures.append(slot['future'])
        self.streams.clear()
        return futures

    @serialized
    def close(self):
        self.closed = True
        self.node.destroy_timer(self.timer)
        for topic in list(self.subscriptions): self.remove(topic, 'ROS host monitoring stopped')
        return self.close_streams()
