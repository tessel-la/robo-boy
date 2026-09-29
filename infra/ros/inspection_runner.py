#!/usr/bin/env python3
"""Read-only ROS inspection: graph snapshots and leased, raw topic measurements.

All wire messages are protocol-v1 JSON in std_msgs/String. No robot services or
actions are called. A probe is a real subscriber; its presence remains visible.
"""
from collections import deque
import json
import math
import re
import threading
import time

PREFIX = '/roboboy/inspection'
MAX_PROBES = 32
LEASE_SECONDS = 7
MAX_RESOURCES = 2000
SCHEMA_FIELD_BUDGET = 400
SCHEMA_DEPTH = 4


def full_name(name, namespace):
    return (namespace.rstrip('/') + '/' + name).replace('//', '/')


class RateWindow:
    def __init__(self, now):
        self.started = now
        self.buckets = deque()
        self.last = None
        self.count = 0
        self.total_bytes = 0

    def receive(self, now, size):
        # 100 ms buckets bound memory independently of topic frequency.
        tick = int(now * 10)
        interval = None if self.last is None else max(0, now - self.last)
        if not self.buckets or self.buckets[-1]['tick'] != tick:
            self.buckets.append(dict(tick=tick, count=0, bytes=0, maxBytes=0,
                                     intervals=0, total=0, squares=0, minimum=None, maximum=0))
        bucket = self.buckets[-1]
        bucket['count'] += 1
        bucket['bytes'] += size
        bucket['maxBytes'] = max(bucket['maxBytes'], size)
        if interval is not None:
            bucket['intervals'] += 1
            bucket['total'] += interval
            bucket['squares'] += interval * interval
            bucket['minimum'] = min(bucket['minimum'] if bucket['minimum'] is not None else interval, interval)
            bucket['maximum'] = max(bucket['maximum'], interval)
        self.last = now
        self.count += 1
        self.total_bytes += size
        self.trim(now)

    def trim(self, now):
        while self.buckets and self.buckets[0]['tick'] < int((now - 10) * 10):
            self.buckets.popleft()

    def snapshot(self, now):
        self.trim(now)
        duration = min(10, max(0, now - self.started))
        count = sum(b['count'] for b in self.buckets)
        payload = sum(b['bytes'] for b in self.buckets)
        intervals = sum(b['intervals'] for b in self.buckets)
        elapsed = sum(b['total'] for b in self.buckets)
        mean = elapsed / intervals if intervals else None
        # Window throughput falls toward zero during silence. Inter-arrival rate is
        # separate, so an old pair of messages cannot appear to be streaming forever.
        return dict(rate=count / duration if duration >= 1 else None,
                    intervalRate=intervals / elapsed if elapsed else None,
                    bytesPerSec=payload / duration if duration >= 1 else None,
                    meanBytes=payload / count if count else None,
                    maxBytes=max((b['maxBytes'] for b in self.buckets), default=0),
                    intervalMean=mean,
                    intervalMin=min((b['minimum'] for b in self.buckets if b['minimum'] is not None), default=None),
                    intervalMax=max((b['maximum'] for b in self.buckets), default=0),
                    jitter=math.sqrt(max(0, sum(b['squares'] for b in self.buckets) / intervals - mean * mean)) if mean is not None else None,
                    age=None if self.last is None else max(0, now - self.last),
                    count=self.count, window=duration, source='host', warming=duration < 10)


class Leases:
    def __init__(self):
        self.clients = {}

    def update(self, command, now):
        if not isinstance(command, dict) or command.get('version') != 1:
            raise ValueError('Unsupported inspection protocol')
        client = command.get('client')
        if not isinstance(client, str) or not 1 <= len(client) <= 128:
            raise ValueError('Invalid client id')
        if command.get('release'):
            self.clients.pop(client, None)
            return
        topics = command.get('watch', [])
        details = command.get('details', [])
        if not isinstance(topics, list) or not isinstance(details, list):
            raise ValueError('Invalid watch list')
        if any(not isinstance(t, str) or not t.startswith('/') or len(t) > 512 for t in topics):
            raise ValueError('Invalid topic')
        if any(not isinstance(t, str) or len(t) > 600 for t in details):
            raise ValueError('Invalid detail selection')
        if len(self.clients) >= 64 and client not in self.clients:
            raise ValueError('Inspection client limit reached')
        self.clients[client] = (now + LEASE_SECONDS, set(topics[:MAX_PROBES]), set(details[:16]))

    def active(self, now):
        self.clients = {key: value for key, value in self.clients.items() if value[0] > now}
        watch, details = set(), set()
        for _, topics, selected in self.clients.values():
            watch.update(topics)
            details.update(selected)
        ordered = sorted(watch)
        return ordered[:MAX_PROBES], ordered[MAX_PROBES:], sorted(details)[:64]


def build_graph(node, action_graph, details):
    resources = {}
    errors = []

    def resource(kind, name, types=()):
        key = kind + ':' + name
        if key not in resources:
            resources[key] = dict(id=key, kind=kind, name=name, types=list(types), providers=[], consumers=[])
        else:
            resources[key]['types'] = sorted(set(resources[key]['types']) | set(types))
        return resources[key]

    nodes = node.get_node_names_and_namespaces()
    for name, namespace in nodes[:500]:
        fq = full_name(name, namespace)
        entry = resource('node', fq)
        entry['instances'] = entry.get('instances', 0) + 1
        methods = [
            ('topic', 'providers', node.get_publisher_names_and_types_by_node),
            ('topic', 'consumers', node.get_subscriber_names_and_types_by_node),
            ('service', 'providers', node.get_service_names_and_types_by_node),
            ('service', 'consumers', node.get_client_names_and_types_by_node),
            ('action', 'providers', lambda n, ns: action_graph.get_action_server_names_and_types_by_node(node, n, ns)),
            ('action', 'consumers', lambda n, ns: action_graph.get_action_client_names_and_types_by_node(node, n, ns)),
        ]
        for kind, role, method in methods:
            try:
                for topic, types in method(name, namespace):
                    item = resource(kind, topic, types)
                    if fq not in item[role]:
                        item[role].append(fq)
            except Exception as error:
                errors.append(f'{fq}: {error}')
    for name, types in node.get_topic_names_and_types():
        resource('topic', name, types)
    for name, types in node.get_service_names_and_types():
        resource('service', name, types)
    for item in resources.values():
        kind, name = item['kind'], item['name']
        try:
            if kind == 'topic':
                item.update(publishers=node.count_publishers(name), subscribers=node.count_subscribers(name), countKind='endpoints')
            elif kind == 'service' and hasattr(node, 'count_clients') and hasattr(node, 'count_services'):
                item.update(servers=node.count_services(name), clients=node.count_clients(name), countKind='endpoints')
            elif kind in ('service', 'action'):
                item.update(servers=len(item['providers']), clients=len(item['consumers']), countKind='nodes')
            if item['id'] in details:
                if kind == 'topic':
                    item['endpoints'], item['compatibility'] = describe_endpoints(node, name)
                if kind != 'node' and len(item['types']) == 1:
                    item['schemas'], item['constants'] = describe_schema(kind, item['types'][0])
        except Exception as error:
            item['error'] = str(error)
    ordered = sorted(resources.values(), key=lambda item: (item['kind'], item['name']))
    # Selected items remain inspectable even if the graph exceeds the resource budget.
    selected = [item for item in ordered if item['id'] in details]
    others = [item for item in ordered if item['id'] not in details]
    return dict(resources=(selected + others)[:MAX_RESOURCES], truncated=len(ordered) > MAX_RESOURCES or len(nodes) > 500,
                errors=errors[:10])


def describe_endpoints(node, topic):
    from rclpy.qos import qos_check_compatible
    publishers = node.get_publishers_info_by_topic(topic)
    subscribers = node.get_subscriptions_info_by_topic(topic)
    endpoints = []
    for role, items in [('publisher', publishers), ('subscriber', subscribers)]:
        for endpoint in items[:256]:
            qos = endpoint.qos_profile
            node_name = full_name(endpoint.node_name, endpoint.node_namespace)
            endpoints.append(dict(id=bytes(endpoint.endpoint_gid).hex(), node=node_name, role=role,
                                  type=endpoint.topic_type, observer=node_name.startswith('/roboboy_') or 'rosbridge' in node_name,
                                  qos=dict(reliability=qos.reliability.name, durability=qos.durability.name,
                                           history=qos.history.name, depth=qos.depth, deadlineNs=qos.deadline.nanoseconds,
                                           lifespanNs=qos.lifespan.nanoseconds, liveliness=qos.liveliness.name)))
    compatibility = []
    for publisher in publishers[:32]:
        for subscriber in subscribers[:32]:
            result, reason = qos_check_compatible(publisher.qos_profile, subscriber.qos_profile)
            if result.value:
                compatibility.append(dict(publisher=full_name(publisher.node_name, publisher.node_namespace),
                                          subscriber=full_name(subscriber.node_name, subscriber.node_namespace),
                                          level='error' if result.value == 2 else 'warning', reason=reason))
    return endpoints, compatibility[:64]


def nested_type(field_type):
    """The message type inside a field type, or None for a primitive.

    'geometry_msgs/Pose', 'sequence<geometry_msgs/Point>', 'geometry_msgs/Point[3]' and
    'sequence<geometry_msgs/Point, 10>' all name geometry_msgs/Point-like nested messages.
    """
    base = field_type
    if base.startswith('sequence<'):
        base = base[len('sequence<'):-1].split(',')[0].strip()
    base = re.sub(r'\[\d*\]$', '', base).split('<=')[0]
    return base if '/' in base else None


def message_constants(message_type):
    """Constants (e.g. GoalStatus.STATUS_ABORTED) live on the generated metaclass."""
    meta = type(message_type)
    constants = getattr(meta, '_' + meta.__name__.lstrip('_') + '__constants', {}) or {}
    return [dict(name=name, value=value if isinstance(value, (bool, int, float, str)) else repr(value))
            for name, value in list(constants.items())[:100]]


def describe_fields(message_type, get_message, depth=0, budget=None, seen=frozenset()):
    """Nested field tree, bounded in depth and total fields; recursive types are not expanded twice."""
    budget = budget if budget is not None else [SCHEMA_FIELD_BUDGET]
    fields = []
    for name, field_type in message_type.get_fields_and_field_types().items():
        if budget[0] <= 0:
            fields.append(dict(name='…', type='more fields omitted'))
            break
        budget[0] -= 1
        entry = dict(name=name, type=field_type)
        nested = nested_type(field_type)
        if nested and depth < SCHEMA_DEPTH and nested not in seen:
            try:
                entry['fields'] = describe_fields(get_message(nested), get_message, depth + 1, budget, seen | {nested})
            except Exception as error:
                entry['unresolved'] = str(error)[:200]
        fields.append(entry)
    return fields


def describe_schema(kind, type_name):
    from rosidl_runtime_py.utilities import get_action, get_message, get_service
    if kind == 'topic':
        parts = {'Message': get_message(type_name)}
    elif kind == 'service':
        interface = get_service(type_name)
        parts = {'Request': interface.Request, 'Response': interface.Response}
    else:
        interface = get_action(type_name)
        parts = {'Goal': interface.Goal, 'Result': interface.Result, 'Feedback': interface.Feedback}
    budget = [SCHEMA_FIELD_BUDGET]
    schemas = {part: describe_fields(message_type, get_message, budget=budget) for part, message_type in parts.items()}
    constants = {part: message_constants(message_type) for part, message_type in parts.items()}
    return schemas, {part: items for part, items in constants.items() if items}


def main():
    import rclpy
    from rclpy.node import Node
    from rclpy.action import graph as action_graph
    from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
    from rosidl_runtime_py.utilities import get_message
    from std_msgs.msg import String

    class Inspector(Node):
        def __init__(self):
            super().__init__('roboboy_inspector')
            self.leases = Leases()
            self.probes = {}
            self.graph = dict(resources=[], errors=[], truncated=False)
            self.revision = 0
            self.last_graph = 0
            self.last_reconcile = 0
            self.published_revision = -1
            self.graph_text = ''
            self.republish = False
            self.lock = threading.Lock()
            self.halt = threading.Event()
            self.force = threading.Event()
            self.errors = {}
            self.graph_publisher = self.create_publisher(String, PREFIX + '/graph', QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL))
            self.metrics_publisher = self.create_publisher(String, PREFIX + '/metrics', 1)
            self.create_subscription(String, PREFIX + '/request', self.request, 10)
            self.create_timer(0.5, self.tick)
            self.thread = threading.Thread(target=self.graph_loop, daemon=True)
            self.thread.start()

        def request(self, message):
            try:
                if len(message.data) > 32768:
                    return
                command = json.loads(message.data)
                with self.lock:
                    before = self.leases.active(time.monotonic())[2]
                    known = command.get('client') in self.leases.clients
                    self.leases.update(command, time.monotonic())
                    after = self.leases.active(time.monotonic())[2]
                    # A new client, or one that missed the graph, gets the current graph again.
                    if not known or command.get('refresh'):
                        self.republish = True
                if before != after or command.get('refresh'):
                    self.force.set()
            except (ValueError, TypeError):
                pass

        def graph_loop(self):
            while not self.halt.is_set():
                try:
                    with self.lock:
                        active = bool(self.leases.clients)
                        details = self.leases.active(time.monotonic())[2]
                    if active:
                        graph = build_graph(self, action_graph, details)
                        text = json.dumps(graph, sort_keys=True)
                        with self.lock:
                            # Rebuilt every ~2 s, but only a changed graph gets a new revision and is sent.
                            if text != self.graph_text:
                                self.graph = graph
                                self.graph_text = text
                                self.revision += 1
                            self.last_graph = time.monotonic()
                except Exception as error:
                    with self.lock:
                        self.graph = dict(resources=[], errors=[str(error)], truncated=False)
                self.force.wait(2)
                self.force.clear()

        def tick(self):
            now = time.monotonic()
            with self.lock:
                watch, refused, _ = self.leases.active(now)
                graph = self.graph
                revision = self.revision
                age = now - self.last_graph if self.last_graph else None
                active = bool(self.leases.clients)
                republish = self.republish
                self.republish = False
            desired = set(watch)
            available = {item['name']: item for item in graph['resources'] if item['kind'] == 'topic'}
            for topic in list(self.probes):
                if topic not in desired or available.get(topic, {}).get('types') != [self.probes[topic][2]]:
                    self.destroy_subscription(self.probes.pop(topic)[0])
                    self.errors.pop(topic, None)
            self.errors = {topic: error for topic, error in self.errors.items() if topic in desired}
            for topic in watch:
                if topic in self.probes:
                    continue
                try:
                    item = available.get(topic)
                    if not item or len(item['types']) != 1:
                        raise ValueError('Topic missing or has ambiguous types')
                    if topic.startswith(PREFIX + '/'):
                        raise ValueError('Inspector transport topics cannot be monitored')
                    window = RateWindow(now)
                    qos = QoSProfile(depth=100, reliability=ReliabilityPolicy.BEST_EFFORT)
                    sub = self.create_subscription(get_message(item['types'][0]), topic,
                        lambda data, target=window: target.receive(time.monotonic(), len(data)), qos, raw=True)
                    self.probes[topic] = (sub, window, item['types'][0])
                    self.errors.pop(topic, None)
                except Exception as error:
                    self.errors[topic] = str(error)
            # Send the large graph once per revision, not at the metrics cadence.
            if active and (revision != self.published_revision or republish):
                self.graph_publisher.publish(String(data=json.dumps(dict(version=1, revision=revision, age=age, **graph))))
                self.published_revision = revision
            if active:
                metrics = {topic: window.snapshot(now) for topic, (_, window, _) in self.probes.items()}
                self.metrics_publisher.publish(String(data=json.dumps(dict(
                    version=1, metrics=metrics, refused=refused, errors=self.errors,
                    graphRevision=revision, graphAge=age))))

        def close(self):
            self.halt.set()
            self.force.set()
            self.thread.join()
            for sub, _, _ in self.probes.values():
                self.destroy_subscription(sub)

    rclpy.init()
    node = Inspector()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, rclpy.executors.ExternalShutdownException):
        pass
    finally:
        node.close()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
