#!/usr/bin/env python3
"""ROS-owned behavior-tree runner used for sessions that outlive the browser.

The wire protocol deliberately uses std_msgs/String JSON so Robo-Boy can ship
without asking robot workspaces to build an additional interface package.
"""

from __future__ import annotations

import copy
import json
import math
import operator
import threading
import time
from typing import Any, Callable, Optional

import rclpy
from action_msgs.msg import GoalStatus
from rclpy.action import ActionClient
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from rosidl_runtime_py.set_message import set_message_fields
from rosidl_runtime_py.utilities import get_action, get_message, get_service
from std_msgs.msg import String


PROTOCOL_VERSION = 1
COMMAND_TOPIC = '/robo_boy/behavior_tree/command'
STATUS_TOPIC = '/robo_boy/behavior_tree/status'


def now_ms() -> int:
    return int(time.time() * 1000)


def timeout_seconds(data: dict[str, Any], default_ms: float) -> float:
    """Match the browser executor: zero/unset timeouts use the node default."""
    raw_timeout = data.get('timeout') or default_ms
    try:
        return max(0.001, float(raw_timeout) / 1000.0)
    except (TypeError, ValueError):
        return default_ms / 1000.0


def value_at(source: Any, path: str) -> Any:
    value = source
    for part in filter(None, path.split('.')):
        if isinstance(value, dict):
            value = value.get(part)
        else:
            value = getattr(value, part, None)
    return value


def set_at(target: dict[str, Any], path: str, value: Any) -> None:
    parts = list(filter(None, path.split('.')))
    cursor = target
    for part in parts[:-1]:
        child = cursor.get(part)
        if not isinstance(child, dict):
            child = {}
            cursor[part] = child
        cursor = child
    if parts:
        cursor[parts[-1]] = value


def apply_inputs(payload: Any, bindings: list[dict[str, Any]], blackboard: dict[str, Any]) -> Any:
    result = copy.deepcopy(payload)
    if not isinstance(result, dict):
        result = {}
    for binding in bindings or []:
        variable = binding.get('variable', '')
        if variable in blackboard:
            set_at(result, binding.get('targetPath', ''), copy.deepcopy(blackboard[variable]))
    return result


def unwrap(value: Any) -> Any:
    if isinstance(value, dict):
        if 'value' in value:
            return value['value']
        if set(value) == {'data'}:
            return value['data']
    return value


def normalize_message_fields(message: Any, payload: dict[str, Any]) -> dict[str, Any]:
    """Coerce editor JSON values using the generated ROS message defaults."""
    normalized: dict[str, Any] = {}
    for name, raw_value in payload.items():
        if not hasattr(message, name):
            continue
        value = unwrap(raw_value)
        current = getattr(message, name)
        if hasattr(current, 'get_fields_and_field_types') and isinstance(value, dict):
            normalized[name] = normalize_message_fields(current, value)
        elif isinstance(current, bool):
            if isinstance(value, str):
                normalized[name] = value.strip().lower() in ('true', '1', 'yes', 'on')
            else:
                normalized[name] = bool(value)
        elif isinstance(current, float):
            normalized[name] = float(value)
        elif isinstance(current, int) and not isinstance(current, bool):
            normalized[name] = int(float(value))
        elif isinstance(current, str):
            normalized[name] = str(value)
        else:
            normalized[name] = value

    orientation = normalized if {'x', 'y', 'z', 'w'}.issubset(normalized) else None
    if orientation and all(isinstance(orientation[key], (int, float)) for key in ('x', 'y', 'z', 'w')):
        norm = math.sqrt(sum(float(orientation[key]) ** 2 for key in ('x', 'y', 'z', 'w')))
        if norm < 1e-12:
            orientation.update({'x': 0.0, 'y': 0.0, 'z': 0.0, 'w': 1.0})
        else:
            for key in ('x', 'y', 'z', 'w'):
                orientation[key] = float(orientation[key]) / norm
    return normalized


class BehaviorTreeRunner(Node):
    def __init__(self) -> None:
        super().__init__('robo_boy_behavior_tree_runner')
        qos = QoSProfile(depth=10, reliability=ReliabilityPolicy.RELIABLE)
        status_qos = QoSProfile(
            depth=20,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )
        self._group = ReentrantCallbackGroup()
        self._publisher = self.create_publisher(String, STATUS_TOPIC, status_qos)
        self.create_subscription(String, COMMAND_TOPIC, self._on_command, qos, callback_group=self._group)
        self.create_timer(1.0, self._publish_snapshot, callback_group=self._group)
        self._lock = threading.RLock()
        self._pause_condition = threading.Condition(self._lock)
        self._state = 'idle'
        self._session_id: Optional[str] = None
        self._tree: Optional[dict[str, Any]] = None
        self._started_at: Optional[int] = None
        self._active_node_id: Optional[str] = None
        self._active_node_label: Optional[str] = None
        self._statuses: dict[str, str] = {}
        self._blackboard: dict[str, Any] = {}
        self._stop = threading.Event()
        self._active_goals: list[Any] = []
        self._last_error: Optional[str] = None
        self.get_logger().info('Persistent behavior-tree runner ready')

    def _on_command(self, message: String) -> None:
        try:
            try:
                command = json.loads(message.data)
            except (TypeError, json.JSONDecodeError):
                self.get_logger().warning('Ignoring malformed behavior-tree command')
                return
            if command.get('protocolVersion') != PROTOCOL_VERSION:
                return

            name = command.get('command')
            if name == 'status':
                self._publish_snapshot(include_tree=True)
            elif name == 'start':
                self._start(command)
            elif name == 'pause':
                self._pause(command.get('sessionId'))
            elif name == 'resume':
                self._resume(command.get('sessionId'))
            elif name == 'stop':
                self._stop_execution(command.get('sessionId'))
        except Exception as exc:
            self.get_logger().exception(f'Behavior-tree command failed: {exc}')
            self._publish_error(str(exc))

    def _matches(self, session_id: Optional[str]) -> bool:
        return session_id is None or session_id == self._session_id

    def _start(self, command: dict[str, Any]) -> None:
        tree = command.get('tree')
        if not isinstance(tree, dict) or not isinstance(tree.get('nodes'), list):
            self._publish_error('A valid tree is required to start execution')
            return
        with self._lock:
            if self._state != 'idle':
                self._publish_error('Another persistent behavior tree is already running')
                return
            self._session_id = str(command.get('sessionId') or f'bt-{now_ms()}')
            self._tree = copy.deepcopy(tree)
            self._started_at = now_ms()
            self._state = 'running'
            self._active_node_id = None
            self._active_node_label = 'Starting'
            self._statuses = {}
            self._blackboard = copy.deepcopy(tree.get('blackboardDefaults') or {})
            self._last_error = None
            self._stop.clear()
        self._publish_event('started')
        threading.Thread(target=self._run, name='persistent-bt', daemon=True).start()

    def _pause(self, session_id: Optional[str]) -> None:
        with self._pause_condition:
            if self._state != 'running' or not self._matches(session_id):
                return
            self._state = 'paused'
        self._publish_event('paused')

    def _resume(self, session_id: Optional[str]) -> None:
        with self._pause_condition:
            if self._state != 'paused' or not self._matches(session_id):
                return
            self._state = 'running'
            self._pause_condition.notify_all()
        self._publish_event('resumed')

    def _stop_execution(self, session_id: Optional[str]) -> None:
        with self._pause_condition:
            if self._state == 'idle' or not self._matches(session_id):
                return
            self._stop.set()
            self._state = 'running'
            self._pause_condition.notify_all()
            goals = list(self._active_goals)
        for goal in goals:
            try:
                goal.cancel_goal_async()
            except Exception:  # best effort during shutdown/transport loss
                pass
        self._publish_event('stopped')

    def _run(self) -> None:
        result = 'failure'
        error: Optional[str] = None
        try:
            tree = self._tree or {}
            root = self._root(tree)
            if root is None:
                raise RuntimeError('No root node found in behavior tree')
            result = self._execute(root, tree, [])
        except Exception as exc:  # keep the ROS process alive on invalid user trees
            error = str(exc)
            self.get_logger().exception('Persistent behavior tree failed')

        stopped = self._stop.is_set()
        if error:
            self._publish_event('error', error=error)
        elif not stopped:
            self._publish_event('completed', data={'result': result})
        with self._lock:
            self._state = 'idle'
            self._active_goals = []
            self._last_error = error
        self._publish_snapshot(include_tree=True)

    def _wait_if_paused(self) -> bool:
        with self._pause_condition:
            while self._state == 'paused' and not self._stop.is_set():
                self._pause_condition.wait(timeout=0.5)
        return not self._stop.is_set()

    @staticmethod
    def _root(tree: dict[str, Any]) -> Optional[dict[str, Any]]:
        incoming = {edge.get('target') for edge in tree.get('edges', [])}
        roots = [node for node in tree.get('nodes', []) if node.get('id') not in incoming]
        controls = {'sequence', 'selector', 'parallel', 'retry', 'repeat', 'timeout', 'ifElse'}
        return next((node for node in roots if node.get('type') in controls), roots[0] if roots else None)

    @staticmethod
    def _children(node: dict[str, Any], tree: dict[str, Any]) -> list[dict[str, Any]]:
        ids = [edge.get('target') for edge in tree.get('edges', []) if edge.get('source') == node.get('id')]
        by_id = {child.get('id'): child for child in tree.get('nodes', [])}
        return [by_id[node_id] for node_id in ids if node_id in by_id]

    def _execute(self, node: dict[str, Any], tree: dict[str, Any], path: list[str]) -> str:
        if not self._wait_if_paused():
            return 'failure'
        self._node_event(node, 'running', path)
        node_type = node.get('type')
        data = node.get('data') or {}

        if node_type == 'sequence':
            result = self._sequence(self._children(node, tree), tree, path)
        elif node_type == 'selector':
            result = 'failure'
            for child in self._children(node, tree):
                if self._execute(child, tree, path) == 'success':
                    result = 'success'
                    break
                if self._stop.is_set():
                    break
        elif node_type == 'parallel':
            children = self._children(node, tree)
            results: list[str] = ['failure'] * len(children)
            threads = [threading.Thread(target=lambda i=i, c=c: results.__setitem__(i, self._execute(c, tree, path))) for i, c in enumerate(children)]
            for thread in threads: thread.start()
            for thread in threads: thread.join()
            result = 'success' if results and all(item == 'success' for item in results) else 'failure'
        elif node_type in ('retry', 'repeat'):
            result = self._iterate(node, tree, path, retry=node_type == 'retry')
        elif node_type == 'timeout':
            result = self._timeout(node, tree, path)
        elif node_type == 'ifElse':
            result = self._if_else(node, tree, path)
        elif node_type == 'subtree':
            subtree = data.get('tree') or {}
            for key, value in (subtree.get('blackboardDefaults') or {}).items():
                self._blackboard.setdefault(key, copy.deepcopy(value))
            root = self._root(subtree)
            result = self._execute(root, subtree, path + [str(node.get('id'))]) if root else 'failure'
        elif node_type == 'action':
            result = self._action(data)
        elif node_type == 'service':
            result = self._service(data)
        elif node_type == 'topic':
            result = self._topic(data)
        elif node_type == 'subscriber':
            result = self._subscriber(data)
        else:
            result = 'failure'

        if not self._stop.is_set():
            self._node_event(node, result, path)
        return result

    def _sequence(self, children: list[dict[str, Any]], tree: dict[str, Any], path: list[str]) -> str:
        for child in children:
            if self._execute(child, tree, path) != 'success' or self._stop.is_set():
                return 'failure'
        return 'success'

    def _iterate(self, node: dict[str, Any], tree: dict[str, Any], path: list[str], retry: bool) -> str:
        limit = (node.get('data') or {}).get('iterationLimit', 3)
        limit = -1 if limit == -1 else max(1, int(limit) if isinstance(limit, (int, float)) and math.isfinite(limit) else 3)
        count = 0
        while not self._stop.is_set() and (limit == -1 or count < limit):
            outcome = self._sequence(self._children(node, tree), tree, path)
            count += 1
            if retry and outcome == 'success': return 'success'
            if not retry and outcome == 'failure': return 'failure'
            time.sleep(0)
        return 'failure' if retry else ('failure' if self._stop.is_set() else 'success')

    def _timeout(self, node: dict[str, Any], tree: dict[str, Any], path: list[str]) -> str:
        children = self._children(node, tree)
        if not children: return 'failure'
        result = ['failure']
        thread = threading.Thread(target=lambda: result.__setitem__(0, self._execute(children[0], tree, path)), daemon=True)
        thread.start()
        thread.join(timeout_seconds(node.get('data') or {}, 10000))
        return result[0] if not thread.is_alive() else 'failure'

    def _if_else(self, node: dict[str, Any], tree: dict[str, Any], path: list[str]) -> str:
        data = node.get('data') or {}
        exists = data.get('variable') in self._blackboard
        actual = self._blackboard.get(data.get('variable'))
        expected = data.get('expectedValue')
        operations: dict[str, Callable[[], bool]] = {
            'truthy': lambda: bool(actual), 'falsy': lambda: not actual,
            'equals': lambda: actual == expected, 'notEquals': lambda: actual != expected,
            'greaterThan': lambda: operator.gt(actual, expected),
            'greaterThanOrEqual': lambda: operator.ge(actual, expected),
            'lessThan': lambda: operator.lt(actual, expected),
            'lessThanOrEqual': lambda: operator.le(actual, expected), 'exists': lambda: exists,
        }
        try: condition = operations.get(data.get('operator'), lambda: False)()
        except (TypeError, ValueError): condition = False
        handle = 'then' if condition else 'else'
        edge = next((item for item in tree.get('edges', []) if item.get('source') == node.get('id') and item.get('sourceHandle') == handle), None)
        children = self._children(node, tree)
        child = next((item for item in tree.get('nodes', []) if edge and item.get('id') == edge.get('target')), None)
        child = child or (children[0 if condition else 1] if len(children) > (0 if condition else 1) else None)
        return self._execute(child, tree, path) if child else 'failure'

    def _wait_future(self, future: Any, timeout: float) -> Any:
        event = threading.Event()
        future.add_done_callback(lambda _: event.set())
        if not event.wait(timeout) or self._stop.is_set():
            return None
        try: return future.result()
        except Exception: return None

    def _action(self, data: dict[str, Any]) -> str:
        client: Any = None
        handle: Any = None
        try:
            action_type = get_action(data.get('actionType', ''))
            client = ActionClient(self, action_type, data.get('actionName', ''), callback_group=self._group)
            timeout = timeout_seconds(data, 60000)
            if not client.wait_for_server(timeout_sec=min(timeout, 5.0)): return 'failure'
            goal = action_type.Goal()
            payload = apply_inputs(data.get('parameters') or {}, data.get('inputBindings') or [], self._blackboard)
            set_message_fields(goal, normalize_message_fields(goal, payload))
            handle = self._wait_future(client.send_goal_async(goal), timeout)
            if handle is None:
                self.get_logger().error(f'Action {data.get("actionName", "")} did not accept a goal within {timeout:.3f}s')
                return 'failure'
            if not handle.accepted:
                self.get_logger().error(f'Action {data.get("actionName", "")} rejected the goal')
                return 'failure'
            with self._lock: self._active_goals.append(handle)
            response = self._wait_future(handle.get_result_async(), timeout)
            if response is None:
                handle.cancel_goal_async()
                self.get_logger().error(f'Action {data.get("actionName", "")} timed out after {timeout:.3f}s')
                return 'failure'
            if response.status == GoalStatus.STATUS_SUCCEEDED:
                self._apply_outputs(response.result, data.get('outputBindings') or [])
                return 'success'
            result_message = getattr(response.result, 'message', '')
            self.get_logger().error(
                f'Action {data.get("actionName", "")} ended with status {response.status}'
                + (f': {result_message}' if result_message else '')
            )
            return 'failure'
        except Exception as exc:
            self.get_logger().error(f'Action node failed: {exc}')
            return 'failure'
        finally:
            with self._lock:
                if handle in self._active_goals:
                    self._active_goals.remove(handle)
            if client is not None:
                client.destroy()

    def _service(self, data: dict[str, Any]) -> str:
        client: Any = None
        try:
            service_type = get_service(data.get('serviceType', ''))
            client = self.create_client(service_type, data.get('serviceName', ''), callback_group=self._group)
            timeout = timeout_seconds(data, 10000)
            if not client.wait_for_service(timeout_sec=min(timeout, 5.0)): return 'failure'
            request = service_type.Request()
            payload = apply_inputs(data.get('request') or {}, data.get('inputBindings') or [], self._blackboard)
            set_message_fields(request, normalize_message_fields(request, payload))
            response = self._wait_future(client.call_async(request), timeout)
            if response is None: return 'failure'
            self._apply_outputs(response, data.get('outputBindings') or [])
            return 'success'
        except Exception as exc:
            self.get_logger().error(f'Service node failed: {exc}')
            return 'failure'
        finally:
            if client is not None:
                self.destroy_client(client)

    def _topic(self, data: dict[str, Any]) -> str:
        publisher: Any = None
        try:
            message_type = get_message(data.get('messageType', ''))
            publisher = self.create_publisher(message_type, data.get('topicName', ''), 10)
            message = message_type()
            payload = apply_inputs(data.get('message') or {}, data.get('inputBindings') or [], self._blackboard)
            set_message_fields(message, normalize_message_fields(message, payload))
            frequency = float(data.get('frequencyHz') or 0)
            if frequency <= 0:
                publisher.publish(message)
                return 'success'
            deadline = time.monotonic() + max(0.0, float(data.get('durationMs', 1000)) / 1000.0)
            while not self._stop.is_set() and time.monotonic() < deadline:
                if not self._wait_if_paused(): return 'failure'
                publisher.publish(message)
                self._stop.wait(max(0.01, 1.0 / frequency))
            return 'failure' if self._stop.is_set() else 'success'
        except Exception as exc:
            self.get_logger().error(f'Topic node failed: {exc}')
            return 'failure'
        finally:
            if publisher is not None:
                self.destroy_publisher(publisher)

    def _subscriber(self, data: dict[str, Any]) -> str:
        event = threading.Event()
        received: list[Any] = []
        subscription: Any = None
        try:
            message_type = get_message(data.get('messageType', ''))
            subscription = self.create_subscription(message_type, data.get('topicName', ''), lambda msg: (received.append(msg), event.set()), 10, callback_group=self._group)
            event.wait(timeout_seconds(data, 10000))
            if not received or self._stop.is_set(): return 'failure'
            self._apply_outputs(received[0], data.get('outputBindings') or [])
            return 'success'
        except Exception as exc:
            self.get_logger().error(f'Subscriber node failed: {exc}')
            return 'failure'
        finally:
            if subscription is not None:
                self.destroy_subscription(subscription)

    def _apply_outputs(self, source: Any, bindings: list[dict[str, Any]]) -> None:
        changed = []
        with self._lock:
            for binding in bindings:
                variable = binding.get('variable', '')
                if variable:
                    self._blackboard[variable] = value_at(source, binding.get('sourcePath', ''))
                    changed.append(variable)
        if changed:
            self._publish_event('blackboardUpdated', data={'changedVariables': changed, 'blackboard': self._blackboard})

    def _node_event(self, node: dict[str, Any], status: str, path: list[str]) -> None:
        key = f"{'/'.join(path) or 'root'}::{node.get('id')}"
        with self._lock:
            self._statuses[key] = status
            if status == 'running':
                self._active_node_id = str(node.get('id'))
                self._active_node_label = str((node.get('data') or {}).get('label') or node.get('id'))
        event_type = {'running': 'nodeRunning', 'success': 'nodeSuccess', 'failure': 'nodeFailure'}[status]
        self._publish_event(event_type, node_id=str(node.get('id')), data={'status': status, 'treePath': path})

    def _publish_error(self, error: str) -> None:
        self._publish_event('error', error=error)

    def _publish_event(self, event_type: str, node_id: Optional[str] = None, data: Optional[dict[str, Any]] = None, error: Optional[str] = None) -> None:
        event: dict[str, Any] = {'type': event_type, 'timestamp': now_ms()}
        if node_id is not None: event['nodeId'] = node_id
        if data is not None: event['data'] = data
        if error is not None: event['error'] = error
        self._publish_snapshot(event=event, include_tree=event_type == 'started')

    def _publish_snapshot(self, event: Optional[dict[str, Any]] = None, include_tree: bool = False) -> None:
        with self._lock:
            payload: dict[str, Any] = {
                'protocolVersion': PROTOCOL_VERSION, 'state': self._state,
                'sessionId': self._session_id, 'treeName': (self._tree or {}).get('name', ''),
                'startedAt': self._started_at, 'activeNodeId': self._active_node_id,
                'activeNodeLabel': self._active_node_label, 'blackboard': self._blackboard,
                'nodeStatuses': self._statuses,
            }
            if include_tree and self._tree is not None: payload['tree'] = self._tree
            if event is not None: payload['event'] = event
            if self._last_error: payload['error'] = self._last_error
        self._publisher.publish(String(data=json.dumps(payload, separators=(',', ':'), default=str)))


def main() -> None:
    rclpy.init()
    node = BehaviorTreeRunner()
    executor = MultiThreadedExecutor(num_threads=6)
    executor.add_node(node)
    try:
        executor.spin()
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
