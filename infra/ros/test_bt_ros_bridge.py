"""Cancellation acceptance races and bounded feedback without a physical robot."""
from concurrent.futures import Future
from types import SimpleNamespace
import unittest
from unittest.mock import patch

try:
    from bt_runtime.ros_bridge import RosActionBridge
except ImportError:
    RosActionBridge = None


class Client:
    def __init__(self, *args, **kwargs):
        self.acceptance = Future()
        self.ready = True
        self.destroyed = False
    def server_is_ready(self): return self.ready
    def send_goal_async(self, goal, feedback_callback):
        self.feedback_callback = feedback_callback
        return self.acceptance
    def destroy(self): self.destroyed = True


class Handle:
    accepted = True
    def __init__(self):
        self.cancel_count = 0
        self.result = Future()
    def cancel_goal_async(self): self.cancel_count += 1
    def get_result_async(self): return self.result


@unittest.skipUnless(RosActionBridge, 'ROS dependencies are tested in the required native image')
class RosBridgeTests(unittest.TestCase):
    def setUp(self):
        self.patches = [patch('bt_runtime.ros_bridge.ActionClient', Client),
                        patch('bt_runtime.ros_bridge.get_action', lambda _: SimpleNamespace(Goal=lambda: SimpleNamespace())),
                        patch('bt_runtime.ros_bridge.set_message_fields', lambda goal, fields: None),
                        patch('bt_runtime.ros_bridge.message_to_ordereddict', lambda message: message)]
        for p in self.patches: p.start()
        self.bridge = RosActionBridge(SimpleNamespace(), SimpleNamespace())
    def tearDown(self):
        self.bridge.cancel_all()
        for p in self.patches: p.stop()
    def start(self, id='invocation'):
        self.bridge.start(dict(id=id, action_name='/test', action_type='test/action/Test', goal={}, timeout=5))
        client = self.bridge.records[id]['client']
        self.bridge.poll()
        return client
    def test_cancel_before_acceptance_cancels_late_goal(self):
        client = self.start()
        self.bridge.cancel('invocation')
        handle = Handle()
        client.acceptance.set_result(handle)
        self.assertEqual(handle.cancel_count, 1)
        handle.result.set_result(SimpleNamespace(status=5, result={'message': 'cancelled'}))
        self.assertEqual(self.bridge.poll(), [])
        self.assertTrue(client.destroyed)
    def test_cancelled_invocation_cannot_replace_new_run_results(self):
        old = self.start('old')
        self.bridge.cancel_all()
        new = self.start('new')
        old_handle, new_handle = Handle(), Handle()
        old.acceptance.set_result(old_handle)
        new.acceptance.set_result(new_handle)
        old_handle.result.set_result(SimpleNamespace(status=4, result={'run': 'old'}))
        new_handle.result.set_result(SimpleNamespace(status=4, result={'run': 'new'}))
        events = self.bridge.poll()
        self.assertEqual([e['id'] for e in events], ['new'])
        self.assertEqual(events[0]['result']['run'], 'new')
    def test_coalesces_feedback_without_losing_terminal_results(self):
        for i in range(5000): self.bridge.emit(dict(type='feedback', id='node', feedback={'progress': i}))
        self.bridge.emit(dict(type='result', id='node', success=True, result='done'))
        events = self.bridge.poll()
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]['feedback']['progress'], 4999)
        self.assertEqual(events[1]['result'], 'done')
    def test_unavailable_server_deadline_reports_failure(self):
        with patch('bt_runtime.ros_bridge.time.monotonic', return_value=0):
            self.bridge.start(dict(id='node', action_name='/missing', action_type='test/action/Test', goal={}, timeout=1))
        client = self.bridge.records['node']['client']; client.ready = False
        with patch('bt_runtime.ros_bridge.time.monotonic', return_value=2): events = self.bridge.poll()
        self.assertEqual(events[0]['error'], 'timeout')
        self.assertFalse(events[0]['success'])
        self.bridge.poll(); self.assertTrue(client.destroyed)
    def test_ros_aborted_and_rejected_goals_are_failures(self):
        client = self.start()
        handle = Handle(); client.acceptance.set_result(handle)
        handle.result.set_result(SimpleNamespace(status=6, result={'message': 'aborted'}))
        self.assertFalse(self.bridge.poll()[0]['success'])
        client = self.start('second'); handle = Handle(); handle.accepted = False
        client.acceptance.set_result(handle)
        self.assertIn('rejected', self.bridge.poll()[0]['message'])


if __name__ == '__main__': unittest.main()
