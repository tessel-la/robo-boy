"""Run inside Dockerfile.genesis-bt-test: real ROS host, real native trees, Genesis mock actions."""
import base64
import json
import os
import queue
import threading
import time
import unittest
import uuid
from pathlib import Path

try:
    import rclpy
    from rclpy.executors import MultiThreadedExecutor
    from std_msgs.msg import String
except ImportError:
    rclpy = None


@unittest.skipUnless(rclpy is not None and os.environ.get('GENESIS_BT_E2E') == '1',
                     'Run in the isolated Genesis integration image')
class GenesisRuntimeE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rclpy.init()
        cls.node = rclpy.create_node('robo_boy_native_bt_e2e_client')
        cls.events = queue.Queue()
        cls.history = []
        cls.subscription = cls.node.create_subscription(String, '/robo_boy/bt/events',
            lambda m: cls.events.put(json.loads(m.data)), 100)
        cls.publisher = cls.node.create_publisher(String, '/robo_boy/bt/command', 100)
        cls.executor = MultiThreadedExecutor(num_threads=2)
        cls.executor.add_node(cls.node)
        cls.thread = threading.Thread(target=cls.executor.spin, daemon=True)
        cls.thread.start()
        deadline = time.monotonic() + 45
        while cls.publisher.get_subscription_count() == 0 and time.monotonic() < deadline:
            time.sleep(.1)
        if cls.publisher.get_subscription_count() == 0:
            raise RuntimeError('Native runtime ROS endpoint did not appear')
        cls.session = None

    @classmethod
    def tearDownClass(cls):
        try:
            if cls.session: cls.command('stop', sessionId=cls.session['id'])
        finally:
            cls.executor.shutdown(timeout_sec=3)
            cls.thread.join(timeout=3)
            cls.node.destroy_node()
            rclpy.shutdown()

    @classmethod
    def next_event(cls, predicate, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try: event = cls.events.get(timeout=max(.01, deadline - time.monotonic()))
            except queue.Empty: break
            cls.history.append(event)
            if event.get('session'): cls.session = event['session']
            if predicate(event): return event
        raise AssertionError('Timed out waiting for ROS runtime event: ' + repr(cls.session))

    @classmethod
    def command(cls, name, **fields):
        request_id = str(uuid.uuid4())
        cls.publisher.publish(String(data=json.dumps(dict(protocolVersion=2, requestId=request_id, command=name, **fields))))
        response = cls.next_event(lambda e: e.get('requestId') == request_id)
        if not response.get('ok'): raise AssertionError(response.get('error'))
        return response

    def source(self, runtime, goal=None):
        source = Path('/examples/behavior_trees/genesis_' + ('btcpp' if runtime == 'btcpp' else 'py_trees') + '.xml').read_text()
        if goal is not None:
            import re
            source = re.sub(r'goal_b64="[^"]*"', 'goal_b64="' + base64.b64encode(json.dumps(goal).encode()).decode() + '"', source)
        return source

    def load(self, runtime, source):
        if self.session and self.session['state'] == 'running':
            self.command('cancel', sessionId=self.session['id'])
        return self.command('load', runtime=runtime, xml=source, mainTreeId='Move')['session']

    def test_01_discover_both_actual_runtimes(self):
        descriptors = self.command('discover')['runtimes']
        self.assertEqual({d['id'] for d in descriptors}, {'btcpp', 'py_trees'})
        for d in descriptors:
            self.assertTrue(d['available'], d.get('reason'))
            self.assertIn('RosAction', d['nodes'])
            self.assertTrue(d['version'])

    def test_02_equivalent_motion_feedback_result_reset_rerun(self):
        for runtime in ('btcpp', 'py_trees'):
            with self.subTest(runtime=runtime):
                loaded = self.load(runtime, self.source(runtime))
                for run in range(2):
                    if run: self.command('reset', sessionId=loaded['id'])
                    self.history.clear()
                    self.command('start', sessionId=loaded['id'])
                    final = self.next_event(lambda e: e.get('session', {}).get('state') in ('completed', 'error'))['session']
                    self.assertEqual(final['result'], 'success', final.get('error'))
                    self.assertTrue(all(n.get('lastResult') == 'success' for n in final['nodes']))
                    self.assertTrue(any(n['status'] == 'running' for e in self.history for n in e.get('session', {}).get('nodes', [])))
                    self.assertTrue(any(e.get('log', {}).get('type') == 'feedback' for e in self.history))
                    result = next(e['log'] for e in self.history if e.get('log', {}).get('type') == 'result')
                    self.assertTrue(result['success']); self.assertTrue(result['result']['success'])

    def test_03_cancel_motion_and_rerun(self):
        for runtime in ('btcpp', 'py_trees'):
            with self.subTest(runtime=runtime):
                loaded = self.load(runtime, self.source(runtime, {'x': .01, 'duration': 3., 'timeout': 8.}))
                self.command('start', sessionId=loaded['id'])
                self.next_event(lambda e: e.get('log', {}).get('type') == 'feedback')
                cancelled = self.command('cancel', sessionId=loaded['id'])['session']
                self.assertEqual(cancelled['state'], 'cancelled')
                self.assertTrue(all(n['status'] == 'idle' for n in cancelled['nodes']))
                self.command('reset', sessionId=loaded['id'])
                self.command('start', sessionId=loaded['id'])
                self.next_event(lambda e: e.get('log', {}).get('type') == 'feedback')
                stopped = self.command('stop', sessionId=loaded['id'])['session']
                self.assertEqual(stopped['state'], 'stopped')

    def test_04_ros_failure_and_unavailable_action(self):
        for runtime in ('btcpp', 'py_trees'):
            with self.subTest(runtime=runtime):
                source = self.source(runtime).replace('genesis_manipulator_interfaces/action/MoveEndEffector', 'missing_package/action/Missing')
                loaded = self.load(runtime, source)
                self.command('start', sessionId=loaded['id'])
                final = self.next_event(lambda e: e.get('session', {}).get('state') in ('completed', 'error'))['session']
                self.assertEqual(final['result'], 'failure')
                source = self.source(runtime, {'x': .01, 'duration': .2, 'timeout': 2.}).replace('/arm_1/move_end_effector', '/missing_action').replace('timeout="8"', 'timeout="0.2"')
                loaded = self.load(runtime, source)
                self.command('start', sessionId=loaded['id'])
                final = self.next_event(lambda e: e.get('session', {}).get('state') in ('completed', 'error'))['session']
                self.assertEqual(final['result'], 'failure')

    def test_05_reconnect_observes_host_owned_execution(self):
        for runtime in ('btcpp', 'py_trees'):
            with self.subTest(runtime=runtime):
                loaded = self.load(runtime, self.source(runtime, {'x': .01, 'duration': 3., 'timeout': 8.}))
                self.command('start', sessionId=loaded['id'])
                self.next_event(lambda e: e.get('log', {}).get('type') == 'feedback')
                # An observer leaves and returns; ownership is deliberately on the ROS host.
                self.node.destroy_subscription(self.subscription)
                time.sleep(.1)
                self.subscription = self.node.create_subscription(String, '/robo_boy/bt/events', lambda m: self.events.put(json.loads(m.data)), 100)
                state = self.command('status')['session']
                self.assertEqual(state['id'], loaded['id']); self.assertEqual(state['state'], 'running')
                self.command('cancel', sessionId=loaded['id'])


if __name__ == '__main__': unittest.main()
