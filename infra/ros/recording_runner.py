#!/usr/bin/env python3
"""ROS-side MCAP recording. Raw CDR never crosses the browser connection.

Protocol v1: std_msgs/String JSON on /roboboy/recorder/{command,status}.
The writer thread owns rosbag2; the ROS executor only discovers and queues raw bytes.
"""
import json
import math
import os
from pathlib import Path
import re
import signal
import tempfile
import threading
import time
from collections import deque


def validate_options(value, root):
    if not isinstance(value, dict):
        raise ValueError('Recording options must be an object')
    name = value.get('name', '')
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', name):
        raise ValueError('Use a recording name with letters, numbers, dots, dashes or underscores')
    base = (root / str(value.get('path', ''))).resolve()
    if not base.is_relative_to(root):
        raise ValueError('Choose a directory inside the recording root')
    destination = base / name
    if destination.exists():
        raise ValueError('That recording already exists. Choose a new name.')
    result = dict(value, destination=str(destination))
    for key, default, maximum in [('frequency', 0, 100000), ('maxSizeMiB', 0, 1048576),
                                  ('maxDurationSec', 0, 604800), ('cacheMiB', 64, 1024)]:
        number = value.get(key, default)
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or not 0 <= number <= maximum:
            raise ValueError(f'Invalid {key}')
        result[key] = number
    if result['cacheMiB'] < 1:
        raise ValueError('The queue must be at least 1 MiB')
    if value.get('compression', 'zstd') not in ('none', 'zstd'):
        raise ValueError('Unknown compression')
    if value.get('qos', 'auto') not in ('auto', 'reliable', 'best_effort'):
        raise ValueError('Unknown QoS policy')
    for key in ('allTopics', 'includeHidden', 'useSimTime'):
        if not isinstance(value.get(key, False), bool):
            raise ValueError(f'Invalid {key}')
    topics = value.get('topics', [])
    if not isinstance(topics, list) or len(topics) > 4096 or any(not isinstance(t, str) or not t.startswith('/') for t in topics):
        raise ValueError('Invalid topic selection')
    for key in ('include', 'exclude'):
        expression = value.get(key, '')
        if not isinstance(expression, str) or len(expression) > 256:
            raise ValueError('Topic expressions must be at most 256 characters')
        re.compile(expression)
    if not value.get('allTopics') and not topics and not value.get('include'):
        raise ValueError('Select at least one topic or an include expression')
    return result


class WriteQueue:
    """A byte-bounded queue. Overflow is visible and never blocks a ROS callback."""
    def __init__(self, limit):
        self.limit = limit
        self.bytes = 0
        self.items = deque()
        self.closed = False
        self.condition = threading.Condition()

    def put(self, item, size=0):
        with self.condition:
            if self.closed or self.bytes + size > self.limit:
                return False
            self.items.append((item, size))
            self.bytes += size
            self.condition.notify()
            return True

    def get(self):
        with self.condition:
            self.condition.wait_for(lambda: self.items or self.closed)
            if not self.items:
                return None
            item, size = self.items.popleft()
            self.bytes -= size
            return item

    def close(self):
        with self.condition:
            self.closed = True
            self.condition.notify_all()


def main():
    import rclpy
    import rosbag2_py
    from rclpy.node import Node
    from rclpy.parameter import Parameter
    from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
    from rosbag2_py._storage import QoS as BagQoS  # Not re-exported by rosbag2_py in Jazzy.
    from rosidl_runtime_py.utilities import get_message
    from std_msgs.msg import String

    class Recorder(Node):
        def __init__(self):
            super().__init__('roboboy_recorder')
            self.root = Path(os.environ.get('ROBOBOY_RECORDINGS_ROOT', '/recordings')).resolve()
            self.root.mkdir(parents=True, exist_ok=True)
            self.options = {}
            self.subs = {}
            self.last_sample = {}
            self.queue = None
            self.thread = None
            self.started = 0
            self.seen_requests = deque(maxlen=128)
            self.status = dict(version=1, state='idle', root=str(self.root), path='', messages=0,
                               bytes=0, dropped=0, elapsed=0, topics=[])
            qos = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
            self.publisher = self.create_publisher(String, '/roboboy/recorder/status', qos)
            self.create_subscription(String, '/roboboy/recorder/command', self.command, 10)
            self.create_timer(0.5, self.tick)

        def publish(self):
            # The writer thread updates counters; copying first keeps json.dumps off a changing dict.
            self.publisher.publish(String(data=json.dumps(dict(self.status))))

        def command(self, message):
            request = {}
            try:
                if len(message.data) > 65536:
                    raise ValueError('Command is too large')
                request = json.loads(message.data)
                if not isinstance(request, dict) or request.get('version') != 1 or not isinstance(request.get('id'), str):
                    raise ValueError('Unsupported recorder protocol')
                if request['id'] in self.seen_requests:
                    self.publish()
                    return
                self.seen_requests.append(request['id'])
                self.status.pop('requestError', None)
                action = request.get('action')
                if action == 'start':
                    if self.thread and self.thread.is_alive():
                        raise ValueError('A recording is already running')
                    self.start(request.get('options'))
                elif action == 'stop':
                    self.stop()
                elif action in ('pause', 'resume'):
                    if self.status['state'] not in ('recording', 'paused'):
                        raise ValueError('No active recording')
                    self.status['state'] = 'paused' if action == 'pause' else 'recording'
                elif action == 'split':
                    if self.status['state'] not in ('recording', 'paused') or not self.queue:
                        raise ValueError('No active recording')
                    self.queue.put(('split',))
                elif action == 'folders':
                    directory = (self.root / str(request.get('path', ''))).resolve()
                    if not directory.is_relative_to(self.root) or not directory.is_dir():
                        raise ValueError('Choose a directory inside the recording root')
                    self.status['directory'] = str(directory.relative_to(self.root))
                    entries = [p for p in directory.iterdir() if p.is_dir() and p.resolve().is_relative_to(self.root)]
                    # A bag is a directory too; list it separately so nobody records into one.
                    self.status['folders'] = sorted(p.name for p in entries if not (p / 'metadata.yaml').exists())[:500]
                    self.status['recordings'] = sorted(p.name for p in entries if (p / 'metadata.yaml').exists())[:500]
                elif action != 'status':
                    raise ValueError('Unknown recorder command')
            except Exception as error:
                self.status['requestError'] = str(error)
            self.status['requestId'] = request.get('id') if isinstance(request, dict) else None
            self.publish()

        def start(self, options):
            self.options = validate_options(options, self.root)
            self.cleanup_subscriptions()
            self.last_sample.clear()
            self.set_parameters([Parameter('use_sim_time', value=bool(options.get('useSimTime')))])
            Path(self.options['destination']).parent.mkdir(parents=True, exist_ok=True)
            self.queue = WriteQueue(int(self.options['cacheMiB'] * 1024 * 1024))
            self.status.update(state='recording', path=self.options['destination'], messages=0,
                               bytes=0, dropped=0, elapsed=0, topics=[])
            self.status.pop('error', None)
            self.started = time.monotonic()
            self.thread = threading.Thread(target=self.write, name='mcap-writer', daemon=False)
            self.thread.start()

        def write(self):
            writer = None
            config_path = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as config:
                    config.write('compression: ' + ('Zstd' if self.options.get('compression') == 'zstd' else 'None') + '\ncompressionLevel: Fast\nchunkSize: 1048576\n')
                    config_path = config.name
                writer = rosbag2_py.SequentialWriter()
                writer.open(rosbag2_py.StorageOptions(
                    uri=self.options['destination'], storage_id='mcap',
                    max_bagfile_size=int(self.options['maxSizeMiB'] * 1024 * 1024),
                    max_bagfile_duration=int(self.options['maxDurationSec']),
                    storage_config_uri=config_path,
                ), rosbag2_py.ConverterOptions('', ''))
                while True:
                    item = self.queue.get()
                    if item is None:
                        break
                    if item[0] == 'topic':
                        writer.create_topic(item[1])
                    elif item[0] == 'split':
                        writer.split_bagfile()
                    else:
                        _, topic, data, stamp = item
                        writer.write(topic, data, stamp)
                        self.status['messages'] += 1
                        self.status['bytes'] += len(data)
                writer.close()
                writer = None
                self.hand_over(self.options['destination'])
                self.status['state'] = 'idle'
            except Exception as error:
                self.status.update(state='error', error=str(error))
                self.queue.close()
            finally:
                if writer is not None:
                    try:
                        writer.close()
                    except Exception:
                        pass
                    self.hand_over(self.options['destination'])
                if config_path:
                    os.unlink(config_path)

        def hand_over(self, destination):
            """Give a finished bag to whoever owns the recording root: the host user on a bind mount.

            The container writes as root, and snap browsers only open files their user owns.
            """
            owner = self.root.stat()
            if (owner.st_uid, owner.st_gid) == (os.getuid(), os.getgid()):
                return
            try:
                path = Path(destination)
                for directory, _, files in os.walk(path):
                    for name in [directory, *(os.path.join(directory, file) for file in files)]:
                        os.chown(name, owner.st_uid, owner.st_gid)
                parent = path.parent  # Folders created for the destination path.
                while parent != self.root and parent.is_relative_to(self.root):
                    os.chown(parent, owner.st_uid, owner.st_gid)
                    parent = parent.parent
            except OSError as error:
                self.status['error'] = f'Saved, but the files still belong to the container user: {error}'

        def cleanup_subscriptions(self):
            for sub in self.subs.values():
                self.destroy_subscription(sub)
            self.subs.clear()

        def stop(self):
            self.cleanup_subscriptions()
            if self.thread and self.thread.is_alive():
                self.status['state'] = 'stopping'
                self.queue.close()

        def tick(self):
            if self.status['state'] in ('recording', 'paused', 'stopping'):
                self.status['elapsed'] = time.monotonic() - self.started
            if self.status['state'] in ('recording', 'paused'):
                self.discover()
            elif self.subs:
                self.cleanup_subscriptions()
            self.publish()

        def discover(self):
            options = self.options
            for topic, types in self.get_topic_names_and_types():
                if topic in self.subs or topic.startswith('/roboboy/recorder/') or len(types) != 1:
                    continue
                if not options.get('includeHidden') and any(part.startswith('_') for part in topic.split('/')):
                    continue
                selected = options.get('allTopics') or topic in options.get('topics', []) or (options.get('include') and re.search(options['include'], topic))
                if not selected or (options.get('exclude') and re.search(options['exclude'], topic)):
                    continue
                try:
                    message_type = get_message(types[0])
                    publishers = self.get_publishers_info_by_topic(topic)
                    reliable = bool(publishers) and all(p.qos_profile.reliability == ReliabilityPolicy.RELIABLE for p in publishers)
                    durable = bool(publishers) and all(p.qos_profile.durability == DurabilityPolicy.TRANSIENT_LOCAL for p in publishers)
                    if options.get('qos') != 'auto':
                        reliable = options.get('qos') == 'reliable'
                    qos = QoSProfile(depth=100, reliability=ReliabilityPolicy.RELIABLE if reliable else ReliabilityPolicy.BEST_EFFORT,
                                     durability=DurabilityPolicy.TRANSIENT_LOCAL if durable else DurabilityPolicy.VOLATILE)
                    offered = []
                    for publisher in publishers:
                        profile = BagQoS(publisher.qos_profile.depth or 1)
                        profile.reliable() if publisher.qos_profile.reliability == ReliabilityPolicy.RELIABLE else profile.best_effort()
                        profile.transient_local() if publisher.qos_profile.durability == DurabilityPolicy.TRANSIENT_LOCAL else profile.durability_volatile()
                        offered.append(profile)
                    metadata = rosbag2_py.TopicMetadata(id=len(self.subs), name=topic, type=types[0], serialization_format='cdr', offered_qos_profiles=offered)
                    if not self.queue.put(('topic', metadata)):
                        return
                    self.subs[topic] = self.create_subscription(message_type, topic,
                        lambda data, name=topic: self.record(name, data), qos, raw=True)
                    self.status['topics'] = sorted(self.subs)
                except Exception as error:
                    self.status['error'] = f'{topic}: {error}'

        def record(self, topic, data):
            if self.status['state'] != 'recording':
                return
            stamp = self.get_clock().now().nanoseconds
            if self.options.get('useSimTime') and stamp == 0:
                return  # Wait for the first /clock before mixing clock domains.
            rate = self.options['frequency']
            if rate:
                # Keep a fixed schedule so arrival jitter does not push the kept rate below N Hz.
                now, due, period = time.monotonic(), self.last_sample.get(topic, -math.inf), 1 / rate
                if now < due:
                    return
                self.last_sample[topic] = due + period if now - due < period else now + period
            if not self.queue.put(('message', topic, data, stamp), len(data)):
                self.status['dropped'] += 1

    rclpy.init()
    node = Recorder()
    try:
        rclpy.spin(node)
    except (KeyboardInterrupt, rclpy.executors.ExternalShutdownException):
        pass
    finally:
        node.stop()
        if node.thread:
            node.thread.join()  # Drain queued bytes and finalize MCAP/metadata before exit.
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
