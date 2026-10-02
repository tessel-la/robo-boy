"""Pure telemetry contract tests plus independent native executor / ROS integration."""
import copy
import os
import struct
import subprocess
import unittest
from types import SimpleNamespace as NS
from bt_runtime.observations import groot_graph, groot_status, observation, py_ros_graph, validate_graph

XML = '''<root BTCPP_format="4"><BehaviorTree ID="Main"><Sequence _uid="0"><SubTree ID="Phase" _fullpath="a" _uid="1"/><SubTree ID="Phase" _fullpath="b" _uid="3"/></Sequence></BehaviorTree><BehaviorTree ID="Phase" _fullpath="a"><AlwaysSuccess _uid="2"/></BehaviorTree><BehaviorTree ID="Phase" _fullpath="b"><AlwaysSuccess _uid="4"/></BehaviorTree></root>'''

def uid(n): return NS(uuid=[0] * 15 + [n])
def py_node(n, parent, children, status=2):
    return NS(own_id=uid(n), parent_id=uid(parent), child_ids=[uid(c) for c in children], name='Same name', class_name='robot.Wait', status=status, message='Moving', additional_detail='WithMemory', blackbox_level=2)


class ObservationContracts(unittest.TestCase):
    def test_groot_instance_identity_and_status(self):
        name, nodes = groot_graph(XML)
        self.assertEqual(name, 'Main')
        self.assertEqual([n['parentId'] for n in nodes], [None, '0', '1', '0', '3'])
        self.assertTrue(nodes[1]['subtree'])
        updates = groot_status(nodes, b''.join(struct.pack('<HB', n, s) for n, s in [(0, 1), (1, 2), (2, 12), (3, 3), (4, 4)]))
        self.assertEqual(updates[2]['status'], 'idle')
        self.assertEqual(updates[2]['lastResult'], 'success')
        self.assertEqual(updates[4]['nativeStatus'], 'SKIPPED')
        terminal = groot_status(nodes, b''.join(struct.pack('<HB', n, 12) for n in range(5)))
        self.assertEqual(observation('btcpp', 'id', name, 'source', terminal)['result'], 'success')

    def test_reject_malformed_groot(self):
        for xml in ('<bad', XML.replace('_uid="2"', '_uid="1"'), XML.replace('_fullpath="a" _uid', '_fullpath="missing" _uid'), '<!DOCTYPE root>' + XML):
            with self.subTest(xml=xml), self.assertRaises(ValueError): groot_graph(xml)
        _, nodes = groot_graph(XML)
        for payload in (b'', b'\x00' * 15, b''.join(struct.pack('<HB', i, 9) for i in range(5))):
            with self.assertRaises(ValueError): groot_status(nodes, payload)

    def test_py_uuid_child_order_feedback_and_blackbox(self):
        message = NS(behaviours=[py_node(2, 1, [], 4), py_node(1, 0, [3, 2]), py_node(3, 1, [], 3)])
        _, nodes = py_ros_graph(message)
        self.assertEqual([n['id'][-2:] for n in nodes], ['01', '03', '02'])
        self.assertEqual(nodes[2]['status'], 'failure')
        self.assertEqual(nodes[0]['feedback'], 'Moving')
        self.assertTrue(nodes[0]['subtree'])
        message.behaviours[1].child_ids = [uid(3), uid(3)]
        with self.assertRaises(ValueError): py_ros_graph(message)

    def test_graph_validation_and_registry_ownership(self):
        from bt_runtime.manager import RuntimeManager
        from test_native_bt_runtime import NullBridge
        class Adapter:
            id = "btcpp"
            def discover(self): return dict(id=self.id, available=False)
        events = []
        manager = RuntimeManager(events.append, NullBridge(), [Adapter()])
        _, nodes = groot_graph(XML)
        record = observation('btcpp', 'external', 'Robot', 'groot', nodes, XML)
        manager.observe(record)
        self.assertIsNone(manager.session)
        manager.session = dict(id='owned', runtime='btcpp', state='loaded', nodes=[], xml='source')
        owned = copy.deepcopy(manager.session)
        manager.observe(record)
        self.assertEqual(manager.session, owned)
        self.assertNotIn('session', events[-1])
        manager.session = None
        manager.dispatch(dict(command='set_enabled', runtime='btcpp', enabled=False))
        self.assertFalse(manager.observations['external']['connected'])
        manager.dispatch(dict(command='set_enabled', runtime='btcpp', enabled=True))
        invalid = copy.deepcopy(record); invalid['nodes'][0]['parentId'] = '4'
        with self.assertRaises(ValueError): manager.observe(invalid)
        self.assertEqual(len(manager.observations), 1)
        new = {**record, 'id': 'restarted'}
        manager.observe(new)
        self.assertEqual(list(manager.observations), ['restarted'])
        self.assertIsNone(manager.worker)
        for nodes in ([None], [{**record['nodes'][0], 'parentId': 'missing'}]):
            with self.assertRaises(ValueError): validate_graph(nodes)


    def test_observed_topology_travels_once_then_only_changed_nodes(self):
        from bt_runtime.manager import RuntimeManager
        from test_native_bt_runtime import NullBridge
        class Adapter:
            id = 'btcpp'
            def discover(self): return dict(id=self.id, available=False)
        events = []
        manager = RuntimeManager(events.append, NullBridge(), [Adapter()])
        _, nodes = groot_graph(XML)
        manager.observe(observation('btcpp', 'robot', 'Main', 'groot', nodes, XML))
        self.assertEqual((events[-1]['observation']['version'], len(events[-1]['observation']['nodes'])), (1, 5))
        running = copy.deepcopy(nodes)
        running[2].update(status='running', nativeStatus='RUNNING', feedback='Moving')
        manager.observe(observation('btcpp', 'robot', 'Main', 'groot', running, XML))
        delta = events[-1]['observationDelta']
        self.assertNotIn('observation', events[-1])
        self.assertEqual((delta['baseVersion'], delta['version'], delta['state']), (1, 2, 'loaded'))
        self.assertEqual(delta['changes'], [{'id': '2', 'status': 'running', 'nativeStatus': 'RUNNING', 'feedback': 'Moving'}])
        self.assertEqual(manager.observations['robot']['nodes'][2]['feedback'], 'Moving')  # Full state kept for status.
        self.assertEqual(manager.dispatch({'command': 'status'})['observations'][0]['version'], 2)
        manager.observe(observation('btcpp', 'robot', 'Main', 'groot', running, XML))
        self.assertEqual(events[-1]['observationDelta']['changes'], [])
        renamed = copy.deepcopy(running)
        renamed[2]['label'] = 'Other'
        manager.observe(observation('btcpp', 'robot', 'Main', 'groot', renamed, XML))
        self.assertEqual(events[-1]['observation']['version'], 4)  # New topology: whole tree again.
        self.assertNotIn('xml', events[-1]['observation'])

    def test_observed_trees_beyond_authoring_limits(self):
        nodes = [{'id': 'root', 'parentId': None, 'label': 'Root', 'type': 'Sequence', 'status': 'running', 'nativeStatus': 'RUNNING', 'feedback': ''}]
        nodes += [{**nodes[0], 'id': str(i), 'parentId': 'root', 'type': 'Wait'} for i in range(6000)]
        self.assertEqual(observation('py_trees', 'id', 'Big', 'topic', nodes)['state'], 'running')

    def test_registry_capacity_eviction_and_failed_replacement_are_atomic(self):
        from bt_runtime.manager import RuntimeManager
        from test_native_bt_runtime import NullBridge
        class Adapter:
            id = 'btcpp'
            def discover(self): return dict(id=self.id, available=False)
        manager = RuntimeManager(lambda _: None, NullBridge(), [Adapter()])
        _, nodes = groot_graph(XML)
        for index in range(16):
            manager.observe(observation('btcpp', str(index), 'Tree', 'source-' + str(index), nodes))
        newcomer = observation('btcpp', 'new', 'Tree', 'new-source', nodes)
        previous = copy.deepcopy(manager.observations)
        with self.assertRaises(ValueError): manager.observe(newcomer)
        self.assertEqual(manager.observations, previous)
        huge = observation('btcpp', 'replacement', 'Tree', 'source-0', copy.deepcopy(nodes))
        for node in huge['nodes']:
            node['ports'] = {str(i): 'x' * 4096 for i in range(128)}
        huge['nodes'] += [{**huge['nodes'][4], 'id': str(i), 'parentId': '0'} for i in range(5, 64)]  # Over 24 MB.
        with self.assertRaises(ValueError): manager.observe(huge)
        self.assertEqual(manager.observations, previous)
        manager.observe({**previous['0'], 'connected': False})
        manager.observe(newcomer)
        self.assertEqual(len(manager.observations), 16)
        self.assertNotIn('0', manager.observations)


if os.environ.get('GENESIS_BT_E2E') == '1':
    from test_genesis_bt_e2e import RosRuntimeHarness
    class ExternalExecutorE2E(RosRuntimeHarness):

        def test_external_frameworks_discovery_live_results_loss_restart(self):
            for runtime, command in [('btcpp', ['/usr/local/bin/robo-boy-external-btcpp']), ('py_trees', ['python3', '/ros_ws/external_py_tree.py'])]:
                with self.subTest(runtime=runtime):
                    process = subprocess.Popen(command)
                    try:
                        def match(event, **fields):
                            record = event.get('observation', {})
                            return record.get('runtime') == runtime and all(record.get(k) == v for k, v in fields.items())
                        live = self.next_event(lambda e: match(e, state='running', connected=True))['observation']
                        identity = live['id']
                        self.assertTrue(any(n['subtree'] for n in live['nodes']))
                        self.assertTrue(any(n['status'] == 'running' for n in live['nodes']))
                        session = self.session and self.session['id']
                        listing = self.command('discover')
                        self.assertIn(identity, [o['id'] for o in listing['observations']])
                        if session: self.assertEqual(listing['session']['id'], session)
                        self.next_event(lambda e: match(e, result='success'), timeout=15)
                        failure = self.next_event(lambda e: match(e, result='failure'), timeout=15)['observation']
                        if runtime == 'py_trees': self.assertTrue(any('Robot result' in n['feedback'] for n in failure['nodes']))
                        self.command('set_enabled', runtime=runtime, enabled=False)
                        self.assertIsNone(process.poll(), 'Monitoring must never stop the robot')
                        self.command('set_enabled', runtime=runtime, enabled=True)
                        self.next_event(lambda e: match(e, connected=True))
                        process.terminate(); process.wait(timeout=5)
                        self.next_event(lambda e: match(e, connected=False), timeout=10)
                        process = subprocess.Popen(command)
                        restarted = self.next_event(lambda e: match(e, connected=True) and e['observation']['id'] != identity)['observation']
                        self.assertNotEqual(restarted['id'], identity)
                    finally:
                        if process.poll() is None: process.terminate(); process.wait(timeout=5)

    class ObservationQueueIsolation(unittest.TestCase):
        def test_telemetry_cannot_fill_the_command_queue(self):
            import json, queue, threading
            from native_behavior_tree_runner import NativeBehaviorTreeRunner
            host = NS(commands=queue.Queue(maxsize=1), pending_observations={}, observation_lock=threading.Lock())
            for index in range(500):
                NativeBehaviorTreeRunner.receive_observation(host, dict(source=str(index % 24), counter=index))
            NativeBehaviorTreeRunner.receive(host, NS(data=json.dumps(dict(command='discover'))))
            self.assertEqual(host.commands.get_nowait()['command'], 'discover')
            self.assertEqual(len(host.pending_observations), 24)
            self.assertTrue(all(record['counter'] > 450 for record in host.pending_observations.values()))



if __name__ == '__main__': unittest.main()
