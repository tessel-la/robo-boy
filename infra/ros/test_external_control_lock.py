"""Native robot-side switch; source ROS before running this test module."""
import json
import unittest
from unittest.mock import patch

try:
    import rclpy
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

    def tearDown(self):
        self.node.destroy_node()

    def test_default_closed_state_has_no_session_credentials(self):
        self.assertFalse(self.node.get_parameter('allow_control').value)
        with patch.object(self.node, 'state_publisher') as publisher:
            self.node.heartbeat()
            state = json.loads(publisher.publish.call_args[0][0].data)
        self.assertFalse(state['allowControl'])
        self.assertNotIn('token', state)
        self.assertEqual(state['controllerId'], self.node.controller_id)

    def test_native_parameter_enables_and_disables_state(self):
        with patch.object(self.node, 'state_publisher') as publisher:
            for allowed in (True, False, True):
                result = self.node.set_parameters([Parameter('allow_control', value=allowed)])[0]
                self.assertTrue(result.successful, result.reason)
                self.node.heartbeat()
                state = json.loads(publisher.publish.call_args[0][0].data)
                self.assertEqual(state['allowControl'], allowed)
        sequences = [json.loads(call[0][0].data)['sequence'] for call in publisher.publish.call_args_list]
        self.assertEqual(sequences, sorted(set(sequences)))

    def test_replacement_policy_defaults_closed_with_new_identity(self):
        original = self.node.controller_id
        self.node.set_parameters([Parameter('allow_control', value=True)])
        replacement = ExternalControlLock()
        try:
            self.assertNotEqual(replacement.controller_id, original)
            self.assertFalse(replacement.get_parameter('allow_control').value)
        finally:
            replacement.destroy_node()


if __name__ == '__main__':
    unittest.main()
