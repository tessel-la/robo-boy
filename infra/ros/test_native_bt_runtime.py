"""Host protocol and real framework tests. Image tests require both runtimes."""
import os
import tempfile
from pathlib import Path
import time
import unittest
from unittest.mock import patch

from bt_runtime.adapters import BehaviorTreeCppAdapter, PyTreesAdapter
from bt_runtime.manager import RuntimeManager
from bt_runtime.xml_safety import validate_upload


def xml(runtime, body, extra=''):
    marker = ' BTCPP_format="4"' if runtime == 'btcpp' else ''
    return f'<root{marker} main_tree_to_execute="Main"><BehaviorTree ID="Main">{body}</BehaviorTree>{extra}</root>'


class NullBridge:
    def __init__(self):
        self.cancelled = 0
        self.actions = []
        self.events = []
    def cancel_all(self): self.cancelled += 1
    def cancel(self, id): pass
    def start(self, action): self.actions.append(action)
    def poll(self):
        events, self.events = self.events, []
        return events


class XmlBoundaryTests(unittest.TestCase):
    def test_bad_xml_and_structure(self):
        for text in ['<', '<root/>', '<wrong/>', '<!DOCTYPE root><root/>', '<root><Import src="/etc/passwd"/></root>',
                     xml('btcpp', '<SubTree ID="Main"/>'), xml('py_trees', '<SubTree ID="Missing"/>'),
                     xml('py_trees', '<subtree ID="Main"/>'),
                     xml('py_trees', '<Success/><Failure/>'),
                     xml('py_trees', '<Success/>', '<BehaviorTree ID="Main"><Success/></BehaviorTree>')]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                validate_upload(text)
    def test_subtree_and_model_preserved(self):
        source = xml('btcpp', '<SubTree ID="Child" answer="{value}"/>', '<BehaviorTree ID="Child"><AlwaysSuccess/></BehaviorTree><TreeNodesModel/>')
        self.assertEqual(validate_upload(source), 'Main')
    def test_bounds(self):
        with self.assertRaises(ValueError): validate_upload(' ' * (512 * 1024 + 1))
        with self.assertRaises(ValueError): validate_upload(xml('py_trees', '<Sequence>' + '<Success/>' * 2048 + '</Sequence>'))
    def test_single_main_inference_and_explicit_multiple_main_selection(self):
        for runtime in ('btcpp', 'py_trees'):
            source = xml(runtime, '<Wait/>').replace(' main_tree_to_execute="Main"', '')
            self.assertEqual(validate_upload(source), 'Main')
            source = source.replace('</root>', '<BehaviorTree ID="Other"><Wait/></BehaviorTree></root>')
            with self.assertRaises(ValueError): validate_upload(source)
            self.assertEqual(validate_upload(source, 'Other'), 'Other')


class RealRuntimeTests(unittest.TestCase):
    def adapters(self):
        available = False
        for adapter in (BehaviorTreeCppAdapter(), PyTreesAdapter()):
            discovered = adapter.discover()
            if not discovered['available']:
                if os.environ.get('REQUIRE_BT_RUNTIMES') == '1':
                    self.fail(f'{adapter.id} unavailable: {discovered.get("reason")}')
                continue
            available = True
            yield adapter, discovered
        if not available:
            self.skipTest('Native dependencies absent; run the required Docker runtime suite')

    def test_discovery_and_registrations(self):
        for adapter, descriptor in self.adapters():
            with self.subTest(runtime=adapter.id):
                self.assertTrue(descriptor['version'])
                self.assertIn('RosAction', descriptor['nodes'])
                self.assertIn('Wait', descriptor['nodes'])
                self.assertTrue(descriptor['capabilities']['cancel'])

    def test_running_success_failure_halt(self):
        for adapter, _ in self.adapters():
            for terminal in ('success', 'failure'):
                with self.subTest(runtime=adapter.id, terminal=terminal):
                    leaf = ('AlwaysSuccess' if terminal == 'success' else 'AlwaysFailure') if adapter.id == 'btcpp' else terminal.capitalize()
                    source = xml(adapter.id, f'<Sequence name="seq"><Wait seconds="0.1"/><{leaf}/></Sequence>')
                    worker, loaded = adapter.open(source)
                    try:
                        self.assertTrue(all(n['status'] == 'idle' for n in loaded['nodes']))
                        self.assertEqual(worker.call('tick')['result'], 'running')
                        halted = worker.call('halt')
                        self.assertTrue(all(n['status'] == 'idle' for n in halted['nodes']))
                        self.assertEqual(worker.call('tick')['result'], 'running')
                        time.sleep(.15)
                        snapshot = worker.call('tick')
                        self.assertEqual(snapshot['result'], terminal)
                        self.assertTrue(any(t['status'] == terminal for t in snapshot['transitions']))
                    finally: worker.close()

    def test_invalid_unsupported_and_wrong_format(self):
        for adapter, _ in self.adapters():
            for source in (xml(adapter.id, '<NoSuchRegisteredNode/>'), '<root>', xml(adapter.id, '<SubTree ID="Main"/>')):
                with self.subTest(runtime=adapter.id, xml=source), self.assertRaises(Exception):
                    adapter.open(source)
            other = 'py_trees' if adapter.id == 'btcpp' else 'btcpp'
            with self.subTest(runtime=adapter.id), self.assertRaises(ValueError):
                adapter.open(xml(other, '<Wait/>'))

    def test_manager_load_run_cancel_reset_rerun(self):
        for adapter, _ in self.adapters():
            with self.subTest(runtime=adapter.id):
                events, bridge = [], NullBridge()
                manager = RuntimeManager(events.append, bridge, [adapter])
                def send(name, **fields):
                    request = {'protocolVersion': 2, 'requestId': str(len(events)), 'command': name, **fields}
                    if manager.session: request['sessionId'] = manager.session['id']
                    manager.command(request)
                    self.assertTrue(events[-1]['ok'], events[-1].get('error'))
                try:
                    send('discover')
                    send('validate', runtime=adapter.id, xml=xml(adapter.id, '<Wait seconds="0.1"/>'))
                    self.assertIsNone(manager.session)
                    send('load', runtime=adapter.id, xml=xml(adapter.id, '<Wait seconds="0.1"/>'))
                    self.assertEqual(manager.session['mainTreeId'], 'Main')
                    source = manager.session['xml']
                    send('start'); manager.tick()
                    self.assertEqual(manager.session['state'], 'running')
                    send('cancel'); self.assertEqual(manager.session['state'], 'cancelled')
                    send('reset'); self.assertEqual(manager.session['state'], 'loaded')
                    send('start'); manager.tick(); time.sleep(.15); manager.tick()
                    self.assertEqual(manager.session['result'], 'success')
                    self.assertTrue(any(n.get('lastResult') == 'success' for n in manager.session['nodes']))
                    send('reset')
                    self.assertTrue(all('lastResult' not in n for n in manager.session['nodes']))
                    send('start'); manager.tick(); send('stop')
                    self.assertEqual(manager.session['state'], 'stopped')
                    self.assertEqual(manager.session['xml'], source)
                finally: manager.close()

    def test_transactional_load_stale_sessions_busy_and_replay(self):
        for adapter, _ in self.adapters():
            events = []
            manager = RuntimeManager(events.append, NullBridge(), [adapter])
            def request(name, id, **fields):
                manager.command(dict(protocolVersion=2, requestId=id, command=name, **fields))
            try:
                request('load', 'one', runtime=adapter.id, xml=xml(adapter.id, '<Wait seconds="10"/>'))
                session_id = manager.session['id']
                request('load', 'bad', runtime=adapter.id, xml=xml(adapter.id, '<Unsupported/>'))
                self.assertFalse(events[-1]['ok']); self.assertEqual(manager.session['id'], session_id)
                request('start', 'stale', sessionId='stale'); self.assertFalse(events[-1]['ok'])
                request('start', 'start', sessionId=session_id); self.assertTrue(events[-1]['ok'])
                request('start', 'start', sessionId=session_id); self.assertTrue(events[-1]['ok'])
                request('load', 'busy', runtime=adapter.id, xml=xml(adapter.id, '<Wait/>')); self.assertFalse(events[-1]['ok'])
            finally: manager.close()

    def test_ros_action_feedback_result_cancellation_and_invalid_goal(self):
        for adapter, _ in self.adapters():
            events, bridge = [], NullBridge()
            manager = RuntimeManager(events.append, bridge, [adapter])
            try:
                source = xml(adapter.id, '<RosAction name="action" action_name="/test" action_type="test/action/Test"/>')
                manager.command(dict(protocolVersion=2, requestId='load', command='load', runtime=adapter.id, xml=source))
                manager.command(dict(protocolVersion=2, requestId='start', command='start', sessionId=manager.session['id']))
                manager.tick(); self.assertEqual(len(bridge.actions), 1)
                invocation = bridge.actions[0]['id']
                bridge.events = [dict(type='feedback', id=invocation, feedback={'progress': .5}),
                                 dict(type='result', id=invocation, success=True, result={'message': 'done'})]
                manager.tick(); self.assertEqual(manager.session['result'], 'success')
                self.assertTrue(any(e.get('log', {}).get('feedback') for e in events))
                # Literal goals take precedence over the blackboard/literal goal port.
                source = xml(adapter.id, '<RosAction action_name="/test" action_type="test/action/Test" goal="not-json" goal_b64="eyJ4IjoxfQ=="/>')
                manager.command(dict(protocolVersion=2, requestId='load-encoded', command='load', runtime=adapter.id, xml=source))
                manager.command(dict(protocolVersion=2, requestId='start-encoded', command='start', sessionId=manager.session['id']))
                manager.tick()
                self.assertEqual(bridge.actions[-1]['goal'], {'x': 1})
                manager.command(dict(protocolVersion=2, requestId='cancel', command='cancel', sessionId=manager.session['id']))
                source = xml(adapter.id, '<RosAction action_name="/test" action_type="test/action/Test" goal_b64="invalid!"/>')
                manager.command(dict(protocolVersion=2, requestId='load-invalid', command='load', runtime=adapter.id, xml=source))
                manager.command(dict(protocolVersion=2, requestId='start-invalid', command='start', sessionId=manager.session['id']))
                manager.tick()
                self.assertEqual(manager.session['state'], 'error')
            finally: manager.close()

    def test_json_ports_subtree_goal_and_runtime_metadata(self):
        for adapter, _ in self.adapters():
            with self.subTest(runtime=adapter.id):
                bridge, events = NullBridge(), []
                manager = RuntimeManager(events.append, bridge, [adapter])
                source = xml(adapter.id,
                    '<Sequence><JsonSet field="name" value="&quot;blue_cube&quot;" result="{detected}"/>'
                    '<JsonGet json="{detected}" field="name" value="{object}"/>'
                    '<SubTree ID="Child" object="{object}" action_result="{finished}"/></Sequence>',
                    '<BehaviorTree ID="Child"><Sequence>'
                    '<JsonSet field="object_id" value="{object}" result="{goal}"/>'
                    '<JsonSet json="{goal}" field="duration" value="0.4" result="{goal}"/>'
                    '<RosAction action_name="/test" action_type="test/action/Test" goal="{goal}" result="{action_result}"/>'
                    '</Sequence></BehaviorTree>')
                try:
                    manager.command(dict(protocolVersion=2, requestId='load', command='load', runtime=adapter.id, xml=source))
                    self.assertTrue(events[-1]['ok'], events[-1].get('error'))
                    configured = next(n for n in manager.session['nodes'] if n['type'] == 'JsonGet')
                    self.assertEqual(configured['ports']['field'], 'name')
                    self.assertIn('detected', configured['ports']['json'])
                    manager.command(dict(protocolVersion=2, requestId='start', command='start', sessionId=manager.session['id']))
                    manager.tick()
                    self.assertEqual(bridge.actions[0]['goal'], {'object_id': 'blue_cube', 'duration': .4})
                    bridge.events = [dict(type='result', id=bridge.actions[0]['id'], success=True, result={'success': True})]
                    manager.tick()
                    self.assertEqual(manager.session['result'], 'success')
                    manager.command(dict(protocolVersion=2, requestId='reset', command='reset', sessionId=manager.session['id']))
                    manager.command(dict(protocolVersion=2, requestId='rerun', command='start', sessionId=manager.session['id']))
                    manager.tick()
                    self.assertEqual(bridge.actions[-1]['goal'], {'object_id': 'blue_cube', 'duration': .4})
                finally: manager.close()

    def test_json_missing_field_is_failure_and_malformed_data_is_error(self):
        for adapter, _ in self.adapters():
            cases = [
                ('<Sequence><JsonSet field="present" value="true" result="{data}"/>'
                 '<JsonGet json="{data}" field="missing" value="{out}"/></Sequence>', 'failure'),
                ('<JsonGet json="[]" field="name" value="{out}"/>', 'error'),
                ('<JsonGet json="bad-json" field="name" value="{out}"/>', 'error'),
                ('<JsonSet field="name" value="bad-json" result="{out}"/>', 'error'),
                ('<JsonSet json="[]" field="name" value="true" result="{out}"/>', 'error'),
            ]
            for body, expected in cases:
                with self.subTest(runtime=adapter.id, body=body):
                    manager = RuntimeManager(lambda e: None, NullBridge(), [adapter])
                    try:
                        manager.command(dict(protocolVersion=2, requestId='load', command='load', runtime=adapter.id, xml=xml(adapter.id, body)))
                        self.assertIsNotNone(manager.session)
                        manager.command(dict(protocolVersion=2, requestId='start', command='start', sessionId=manager.session['id']))
                        manager.tick()
                        if expected == 'error':
                            self.assertEqual(manager.session['state'], 'error')
                            self.assertTrue(manager.session['error'])
                        else: self.assertEqual(manager.session['result'], expected)
                    finally: manager.close()

    def test_python_native_stdout_cannot_corrupt_worker_protocol(self):
        for adapter, _ in self.adapters():
            if adapter.id != 'py_trees': continue
            with tempfile.TemporaryDirectory() as directory:
                Path(directory, 'native_stdout_probe.py').write_text("import os\nos.write(1, b'native ROS log\\n')\n")
                with patch.dict(os.environ, {'ROBOBOY_PY_TREES_MODULES': 'native_stdout_probe',
                                            'PYTHONPATH': directory + ':' + os.environ.get('PYTHONPATH', '')}):
                    discovered = adapter.discover()
                    self.assertTrue(discovered['available'], discovered.get('reason'))
                    worker, loaded = adapter.open(xml('py_trees', '<Wait seconds="0"/>'))
                    try:
                        self.assertIn('native ROS log', loaded['output'])
                        self.assertEqual(worker.call('tick')['result'], 'success')
                    finally: worker.close()

    def test_native_backend_specific_semantics(self):
        for adapter, _ in self.adapters():
            if adapter.id == 'btcpp':
                body = '<Sequence><Script code="value:=7"/><SubTree ID="Child" expected="{value}"/></Sequence>'
                extra = '<BehaviorTree ID="Child"><ScriptCondition code="expected==7"/></BehaviorTree><TreeNodesModel/>'
            else:
                body = '<Parallel name="parallel" policy="success_on_one"><Success name="good"/><Wait name="slow" seconds="5"/></Parallel>'
                extra = ''
            worker, _ = adapter.open(xml(adapter.id, body, extra))
            try:
                self.assertEqual(worker.call('tick')['result'], 'success')
                nodes = worker.call('halt')['nodes']
                self.assertTrue(all(n['status'] == 'idle' for n in nodes))
            finally: worker.close()

    def test_worker_crash_becomes_execution_error(self):
        for adapter, _ in self.adapters():
            manager = RuntimeManager(lambda e: None, NullBridge(), [adapter])
            try:
                manager.command(dict(protocolVersion=2, requestId='load', command='load', runtime=adapter.id, xml=xml(adapter.id, '<Wait/>')))
                manager.command(dict(protocolVersion=2, requestId='start', command='start', sessionId=manager.session['id']))
                manager.worker.process.kill(); manager.worker.process.wait()
                manager.tick()
                self.assertEqual(manager.session['state'], 'error')
                self.assertTrue(manager.session['error'])
                manager.command(dict(protocolVersion=2, requestId='reset', command='reset', sessionId=manager.session['id']))
                self.assertEqual(manager.session['state'], 'loaded')
            finally: manager.close()

    def test_engine_enable_disable_stops_execution_and_allows_recovery(self):
        for adapter, _ in self.adapters():
            events = []
            manager = RuntimeManager(events.append, NullBridge())
            def send(name, **fields):
                manager.command(dict(protocolVersion=2, requestId=str(len(events)), command=name, **fields))
                return events[-1]
            try:
                send('load', runtime=adapter.id, xml=xml(adapter.id, '<Wait seconds="10"/>'))
                session_id = manager.session['id']
                send('start', sessionId=session_id); manager.tick()
                response = send('set_enabled', runtime=adapter.id, enabled=False)
                self.assertTrue(response['ok']); self.assertIsNone(manager.worker)
                self.assertEqual(manager.session['state'], 'stopped')
                self.assertTrue(all(d['enabled'] == (d['id'] != adapter.id) for d in response['runtimes']))
                self.assertFalse(send('start', sessionId=session_id)['ok'])
                self.assertFalse(send('load', runtime=adapter.id, xml=xml(adapter.id, '<Wait/>'))['ok'])
                self.assertFalse(send('reset', sessionId=session_id)['ok'])
                self.assertTrue(send('set_enabled', runtime=adapter.id, enabled=True)['ok'])
                self.assertTrue(send('reset', sessionId=session_id)['ok'])
                self.assertTrue(send('start', sessionId=session_id)['ok'])
                manager.tick(); self.assertEqual(manager.session['state'], 'running')
            finally: manager.close()

    def test_py_trees_rejects_ambiguous_control_flow_options(self):
        for adapter, _ in self.adapters():
            if adapter.id != 'py_trees': continue
            for body in ('<Sequence memory="maybe"><Success/></Sequence>',
                         '<Parallel policy="unknown"><Success/></Parallel>',
                         '<Parallel policy="success_on_selected"><Success/></Parallel>',
                         '<Parallel success_count="2"><Success/></Parallel>'):
                with self.subTest(xml=body), self.assertRaises(ValueError):
                    adapter.open(xml('py_trees', body))

    def test_native_tick_exceptions_are_errors_not_failure_results(self):
        for adapter, _ in self.adapters():
            manager = RuntimeManager(lambda e: None, NullBridge(), [adapter])
            try:
                manager.command(dict(protocolVersion=2, requestId='load', command='load', runtime=adapter.id,
                                     xml=xml(adapter.id, '<Wait seconds="-1"/>')))
                manager.command(dict(protocolVersion=2, requestId='start', command='start', sessionId=manager.session['id']))
                manager.tick()
                self.assertEqual(manager.session['state'], 'error')
                self.assertIsNone(manager.session['result'])
                self.assertIn('seconds', manager.session['error'])
            finally: manager.close()


class UnavailableTests(unittest.TestCase):
    def test_python_worker_missing_does_not_fall_back(self):
        with patch('bt_runtime.adapters.PyTreesAdapter.command', return_value=['/missing/python/worker']):
            adapter = PyTreesAdapter()
            descriptor = adapter.discover()
            self.assertFalse(descriptor['available']); self.assertTrue(descriptor['reason'])
            events = []
            manager = RuntimeManager(events.append, NullBridge(), [adapter])
            manager.command(dict(protocolVersion=2, requestId='load', command='load', runtime='py_trees', xml=xml('py_trees', '<Wait/>')))
            self.assertFalse(events[-1]['ok']); self.assertIsNone(manager.session)

    def test_cpp_missing_does_not_fall_back(self):
        with patch.dict(os.environ, {'ROBOBOY_BTCPP_WORKER': '/missing/native/worker'}):
            adapter = BehaviorTreeCppAdapter()
            descriptor = adapter.discover()
            self.assertFalse(descriptor['available']); self.assertTrue(descriptor['reason'])
            events = []
            manager = RuntimeManager(events.append, NullBridge(), [adapter])
            manager.command(dict(protocolVersion=2, requestId='load', command='load', runtime='btcpp', xml=xml('btcpp', '<Wait/>')))
            self.assertFalse(events[-1]['ok']); self.assertIsNone(manager.session)


if __name__ == '__main__': unittest.main()
