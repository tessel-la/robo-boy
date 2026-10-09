"""Native reference policy; source ROS before running this test module."""
import json
import time
import unittest
from unittest.mock import patch

try:
    import rclpy
    from std_msgs.msg import String
    from rclpy.parameter import Parameter
    from external_control_lock import ExternalControlLock
except ImportError:
    rclpy = None


@unittest.skipUnless(rclpy, 'Native ROS runtime required')
class NativePolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rclpy.init()

    @classmethod
    def tearDownClass(cls):
        rclpy.shutdown()

    def setUp(self):
        self.node = ExternalControlLock()
        self.request = dict(requestId='request-1', label='Remote session', intent='acquire', ownerApproved=True)
        self.receive([self.request])

    def tearDown(self):
        self.node.destroy_node()

    def receive(self, requests, owner=None):
        self.node.receive_requests(String(data=json.dumps(dict(version=1, requests=requests, owner=owner, ownerLabel='Owner' if owner else None))))

    def switch(self, allowed):
        result = self.node.set_parameters([Parameter('allow_control', value=allowed)])[0]
        self.assertTrue(result.successful, result.reason)
        self.node.heartbeat()

    def test_default_closed_and_enable_requires_separate_approval(self):
        self.assertFalse(self.node.get_parameter('allow_control').value)
        with self.assertRaisesRegex(ValueError, 'disabled'):
            self.node.decide('request-1', True)
        self.switch(True)
        self.assertFalse(self.node.decisions)
        self.node.decide('request-1', True)
        self.assertEqual(self.node.decisions, {'request-1': True})

    def test_deny_while_closed_and_stale_decision_cannot_approve_new_request(self):
        self.node.decide('request-1', False)
        self.receive([dict(self.request, requestId='request-2')])
        self.assertFalse(self.node.decisions)
        with self.assertRaisesRegex(ValueError, 'no longer pending'):
            self.node.decide('request-1', True)

    def test_disable_erases_decisions_and_cannot_replay_after_reenable(self):
        self.switch(True)
        self.node.decide('request-1', True)
        self.switch(False)
        self.switch(True)
        self.assertFalse(self.node.decisions)

    def test_gateway_loss_erases_requests_and_decisions(self):
        self.switch(True)
        self.node.decide('request-1', True)
        with patch('external_control_lock.time.monotonic', return_value=time.monotonic() + 11):
            with self.assertRaisesRegex(ValueError, 'no longer pending'):
                self.node.decide('request-1', True)
            self.node.heartbeat()
        self.assertFalse(self.node.requests)
        self.assertFalse(self.node.decisions)
        self.assertIsNone(self.node.requests_seen)

    def test_native_log_tracks_confirmed_owner(self):
        with patch.object(self.node, 'get_logger') as logger:
            self.receive([], owner='session')
            logger.return_value.info.assert_any_call('Control owner: Owner.')
        self.assertEqual(self.node.owner, 'session')

    def test_invalid_decisions_do_not_change_policy(self):
        for invalid in ('true', 1, None):
            with self.assertRaises(ValueError):
                self.node.decide('request-1', invalid)
        self.assertFalse(self.node.get_parameter('allow_control').value)
        self.assertFalse(self.node.decisions)

    def test_native_ros_command_uses_same_approval_path(self):
        self.switch(True)
        self.node.receive_command(String(data=json.dumps(dict(version=1, requestId='request-1', approve=True))))
        self.assertEqual(self.node.decisions, {'request-1': True})
        self.node.receive_command(String(data=json.dumps(dict(version=1, requestId='missing', approve=True))))
        self.assertEqual(self.node.decisions, {'request-1': True})


if __name__ == '__main__':
    unittest.main()
