"""Generic ROS action leaves shared by both native frameworks."""
from __future__ import annotations

import queue
import threading
import time

from rclpy.action import ActionClient
from rosidl_runtime_py.utilities import get_action
from rosidl_runtime_py.set_message import set_message_fields
from rosidl_runtime_py.convert import message_to_ordereddict


class RosActionBridge:
    def __init__(self, node, callback_group):
        self.node = node
        self.group = callback_group
        self.lock = threading.RLock()
        self.records = {}
        self.events = queue.SimpleQueue()
        self.feedback = {}

    def emit(self, event):
        with self.lock:
            if event['type'] == 'feedback':
                self.feedback[event['id']] = event  # Coalesce, preserving terminal results.
            else:
                self.events.put(event)

    def start(self, action):
        node_id = action['id']
        try:
            with self.lock:
                if len(self.records) >= 2048:
                    raise RuntimeError('Too many pending ROS goals; wait for cancellation acknowledgements')
            action_type = get_action(action['action_type'])
            goal = action_type.Goal()
            set_message_fields(goal, action['goal'])
            client = ActionClient(self.node, action_type, action['action_name'], callback_group=self.group)
            record = {'id': node_id, 'client': client, 'goal': goal, 'handle': None,
                      'deadline': time.monotonic() + action['timeout'], 'cancelled': False,
                      'sent': False, 'terminal': False}
            with self.lock:
                self.records[node_id] = record
        except Exception as exc:
            self.emit({'type': 'result', 'id': node_id, 'success': False, 'error': str(exc), 'message': str(exc)})

    def _feedback(self, record, message):
        if not record['cancelled'] and not record['terminal']:
            self.emit({'type': 'feedback', 'id': record['id'], 'feedback': message_to_ordereddict(message.feedback)})

    def _accepted(self, record, future):
        try:
            handle = future.result()
            with self.lock:
                record['handle'] = handle
                if not handle.accepted:
                    self._finish(record, False, message='ROS action goal rejected')
                    return
                if record['cancelled']:
                    handle.cancel_goal_async()
                handle.get_result_async().add_done_callback(lambda f: self._result(record, f))
        except Exception as exc:
            self._finish(record, False, message=str(exc))

    def _result(self, record, future):
        try:
            result = future.result()
            self._finish(record, result.status == 4, result=message_to_ordereddict(result.result),
                         message=f'ROS action status {result.status}', rosStatus=result.status)
        except Exception as exc:
            self._finish(record, False, message=str(exc))

    def _finish(self, record, success, **fields):
        with self.lock:
            if record['terminal']:
                return
            record['terminal'] = True
            if not record['cancelled']:
                self.emit({'type': 'result', 'id': record['id'], 'success': success, **fields})

    def poll(self):
        with self.lock:
            for record in list(self.records.values()):
                if record['terminal']:
                    # Destroying a client inside its result callback is unsafe.
                    record['client'].destroy()
                    if self.records.get(record['id']) is record:
                        del self.records[record['id']]
                    continue
                if not record['cancelled'] and time.monotonic() >= record['deadline']:
                    self.emit({'type': 'result', 'id': record['id'], 'success': False,
                               'message': 'ROS action timed out', 'error': 'timeout'})
                    self.cancel(record['id'])
                elif not record['sent'] and not record['cancelled'] and record['client'].server_is_ready():
                    record['sent'] = True
                    future = record['client'].send_goal_async(record['goal'], feedback_callback=lambda m, r=record: self._feedback(r, m))
                    future.add_done_callback(lambda f, r=record: self._accepted(r, f))
        with self.lock:
            events = list(self.feedback.values())
            self.feedback.clear()
        while not self.events.empty():
            try:
                events.append(self.events.get_nowait())
            except queue.Empty:
                break
        return events

    def cancel(self, node_id):
        with self.lock:
            record = self.records.get(node_id)
            if record:
                record['cancelled'] = True
                if record['handle'] and record['handle'].accepted:
                    record['handle'].cancel_goal_async()
                elif not record['sent']:
                    record['terminal'] = True

    def cancel_all(self):
        with self.lock:
            for node_id in list(self.records):
                self.cancel(node_id)
            self.feedback.clear()
        # Discard feedback/results from a retired run; late callbacks consult cancelled.
        while not self.events.empty():
            try:
                self.events.get_nowait()
            except queue.Empty:
                break
