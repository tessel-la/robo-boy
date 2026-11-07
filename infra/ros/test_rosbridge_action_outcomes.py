"""Exercise the patched rosbridge handlers without sending any ROS goals.

Run inside the ROS image after applying rosbridge_action_outcomes.patch.
The ordinary host suite skips these tests when ROS is not installed.
"""
from concurrent.futures import Future
from contextlib import ExitStack
from importlib.util import find_spec
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

if find_spec('rosbridge_library'):
    from rosbridge_library.internal import actions
    from rosbridge_library.capabilities.send_action_goal import SendActionGoal
else:
    actions = None


@unittest.skipIf(actions is None, 'Requires the patched ROS image')
class RosbridgeActionOutcomeTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.client = Mock()
        self.client.wait_for_server.return_value = True
        self.stack.enter_context(patch.object(actions, 'ActionClient', return_value=self.client))
        self.load_type = self.stack.enter_context(patch.object(actions, 'get_action_class', return_value=object()))
        self.stack.enter_context(patch.object(actions, 'get_action_goal_instance', return_value=object()))
        self.populate = self.stack.enter_context(patch.object(actions, 'args_to_action_goal_instance'))
        self.stack.enter_context(patch.object(actions, 'expand_topic_name', return_value='/move'))
        self.responses = []
        protocol = SimpleNamespace(log=Mock(), send=self.responses.append)
        capability = SimpleNamespace(protocol=protocol)
        self.handler = actions.ActionClientHandler(
            '/move', 'example/action/Move', {}, Mock(),
            lambda exc: SendActionGoal._failure(capability, 'goal', '/move', exc), None, Mock())

    def assert_not_started(self):
        self.handler.run()
        self.assertEqual(len(self.responses), 1)
        self.assertEqual(self.responses[0]['roboboyWorkOutcome'], 'not_started')
        self.assertIs(self.responses[0]['result'], False)
        self.assertEqual(self.responses[0]['status'], 0)
        self.assertEqual(self.responses[0]['id'], 'goal')
        self.assertEqual(self.responses[0]['action'], '/move')

    def test_missing_type_never_submits_and_reports_not_started(self):
        self.load_type.side_effect = ImportError('No module named nav2_msgs')
        self.assert_not_started()
        self.client.send_goal_async.assert_not_called()
        self.assertIsNotNone(self.handler.send_goal_helper.result)

    def test_invalid_arguments_never_submit_and_report_not_started(self):
        self.populate.side_effect = ValueError('Invalid goal fields')
        self.assert_not_started()
        self.client.send_goal_async.assert_not_called()

    def test_missing_server_never_submits_and_disposes_client(self):
        self.client.wait_for_server.return_value = False
        self.assert_not_started()
        self.client.send_goal_async.assert_not_called()
        self.client.destroy.assert_called_once()

    def test_rejected_goal_reports_not_started(self):
        rejected = Future()
        rejected.set_result(SimpleNamespace(accepted=False))
        self.client.send_goal_async.return_value = rejected
        self.assert_not_started()
        self.client.send_goal_async.assert_called_once()
        self.client.destroy.assert_called_once()

    def test_failure_during_submission_never_claims_not_started(self):
        self.client.send_goal_async.side_effect = RuntimeError('Transport lost during send')
        self.handler.run()
        self.assertEqual(len(self.responses), 1)
        self.assertNotIn('roboboyWorkOutcome', self.responses[0])

    def test_failure_after_acceptance_never_claims_not_started(self):
        accepted, result = Future(), Future()
        result.set_result(RuntimeError('Result transport lost'))
        accepted.set_result(SimpleNamespace(accepted=True, get_result_async=lambda: result))
        self.client.send_goal_async.return_value = accepted
        self.handler.run()
        self.assertEqual(len(self.responses), 1)
        self.assertNotIn('roboboyWorkOutcome', self.responses[0])
        self.client.destroy.assert_called_once()
