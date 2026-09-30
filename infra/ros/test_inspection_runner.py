"""Run with python3 -m unittest discover -s infra/ros -p test_inspection_runner.py."""
import unittest
from inspection_runner import RateWindow, Leases, build_graph, describe_fields, message_constants, nested_type


class InspectionTests(unittest.TestCase):
    def test_window_tracks_rate_size_jitter_and_silence(self):
        window = RateWindow(0)
        for index in range(1000):
            window.receive(index / 100, 128)
        metric = window.snapshot(10)
        self.assertAlmostEqual(metric['rate'], 100)
        self.assertAlmostEqual(metric['bytesPerSec'], 12800)
        self.assertAlmostEqual(metric['intervalMean'], .01)
        self.assertLess(metric['jitter'], .000001)
        self.assertFalse(metric['warming'])
        self.assertLessEqual(len(window.buckets), 101)
        self.assertEqual(window.snapshot(21)['rate'], 0)
        self.assertAlmostEqual(window.snapshot(21)['age'], 11.01)
        self.assertEqual(window.snapshot(21)['count'], 1000)

    def test_zero_messages_is_unknown_until_warm(self):
        window = RateWindow(100)
        self.assertIsNone(window.snapshot(100)['rate'])
        self.assertIsNone(window.snapshot(110)['age'])
        self.assertEqual(window.snapshot(110)['rate'], 0)

    def test_leases_union_release_expire_and_bound_probes(self):
        leases = Leases()
        leases.update(dict(version=1, client='a', watch=['/shared', '/one']), 0)
        leases.update(dict(version=1, client='b', watch=['/shared', '/two']), 2)
        self.assertEqual(leases.active(3)[0], ['/one', '/shared', '/two'])
        leases.update(dict(version=1, client='a', release=True), 3)
        self.assertEqual(leases.active(3)[0], ['/shared', '/two'])
        self.assertEqual(leases.active(9)[0], [])
        for index in range(3):
            leases.update(dict(version=1, client=str(index), watch=[f'/t{index}_{i}' for i in range(32)]), 10)
        watch, refused, _ = leases.active(10)
        self.assertEqual(len(watch), 32)
        self.assertEqual(len(refused), 64)
        with self.assertRaises(ValueError):
            leases.update(dict(version=1, client='bad', watch=[42]), 10)

    def test_graph_counts_endpoints_separately_from_participating_nodes(self):
        class FakeNode:
            def get_node_names_and_namespaces(self): return [('robot', '/'), ('ui', '/'), ('ui', '/')]
            def get_publisher_names_and_types_by_node(self, n, ns): return [('/speed', ['std_msgs/msg/Float64'])] if n == 'robot' else []
            def get_subscriber_names_and_types_by_node(self, n, ns): return [('/speed', ['std_msgs/msg/Float64'])] if n == 'ui' else []
            def get_service_names_and_types_by_node(self, n, ns): return [('/reset', ['std_srvs/srv/Trigger'])] if n == 'robot' else []
            def get_client_names_and_types_by_node(self, n, ns): return [('/reset', ['std_srvs/srv/Trigger'])] if n == 'ui' else []
            def get_topic_names_and_types(self): return [('/speed', ['std_msgs/msg/Float64'])]
            def get_service_names_and_types(self): return [('/reset', ['std_srvs/srv/Trigger'])]
            def count_publishers(self, n): return 2
            def count_subscribers(self, n): return 4
            def count_clients(self, n): return 3
            def count_services(self, n): return 1
        class FakeActions:
            @staticmethod
            def get_action_server_names_and_types_by_node(node, n, ns): return [('/move', ['example/action/Move'])] if n == 'robot' else []
            @staticmethod
            def get_action_client_names_and_types_by_node(node, n, ns): return [('/move', ['example/action/Move'])] if n == 'ui' else []
        graph = build_graph(FakeNode(), FakeActions, [])
        resources = {item['id']: item for item in graph['resources']}
        self.assertEqual(resources['topic:/speed']['publishers'], 2)
        self.assertEqual(resources['topic:/speed']['providers'], ['/robot'])
        self.assertEqual(resources['service:/reset']['clients'], 3)
        self.assertEqual(resources['service:/reset']['countKind'], 'endpoints')
        self.assertEqual(resources['action:/move']['clients'], 1)
        self.assertEqual(resources['action:/move']['countKind'], 'nodes')
        self.assertEqual(resources['node:/ui']['instances'], 2)
        FakeNode.count_clients = None
        del FakeNode.count_clients
        graph = build_graph(FakeNode(), FakeActions, [])
        service = next(item for item in graph['resources'] if item['id'] == 'service:/reset')
        self.assertEqual(service['countKind'], 'nodes')
        self.assertEqual(service['clients'], 1)


    def test_nested_types_are_recognised_through_sequences_arrays_and_bounds(self):
        self.assertEqual(nested_type('geometry_msgs/Pose'), 'geometry_msgs/Pose')
        self.assertEqual(nested_type('sequence<geometry_msgs/Point>'), 'geometry_msgs/Point')
        self.assertEqual(nested_type('sequence<geometry_msgs/Point, 10>'), 'geometry_msgs/Point')
        self.assertEqual(nested_type('geometry_msgs/Point[3]'), 'geometry_msgs/Point')
        for primitive in ('double', 'double[36]', 'sequence<double>', 'string<=10', 'sequence<string<=5, 3>'):
            self.assertIsNone(nested_type(primitive))

    def test_schema_tree_is_nested_bounded_and_survives_recursion(self):
        class Point:
            @staticmethod
            def get_fields_and_field_types():
                return {'x': 'double', 'y': 'double'}

        class Tree:
            @staticmethod
            def get_fields_and_field_types():
                return {'point': 'geometry_msgs/Point', 'points': 'sequence<geometry_msgs/Point>',
                        'children': 'sequence<example/Tree>', 'broken': 'missing/Type'}

        def lookup(name):
            if name == 'geometry_msgs/Point':
                return Point
            if name == 'example/Tree':
                return Tree
            raise LookupError(name)

        fields = describe_fields(Tree, lookup, seen=frozenset({'example/Tree'}))
        by_name = {field['name']: field for field in fields}
        self.assertEqual([f['name'] for f in by_name['point']['fields']], ['x', 'y'])
        self.assertEqual(by_name['points']['fields'][0]['type'], 'double')
        self.assertNotIn('fields', by_name['children'])  # A recursive type is not expanded again.
        self.assertIn('unresolved', by_name['broken'])
        bounded = describe_fields(Tree, lookup, budget=[3])
        self.assertEqual(bounded[-1]['name'], '…')

    def test_constants_come_from_the_generated_metaclass(self):
        class Metaclass_Status(type):
            _Metaclass_Status__constants = {'OK': 0, 'ERROR': 2, 'RAW': b'x'}

        class Status(metaclass=Metaclass_Status):
            pass

        self.assertEqual(message_constants(Status), [dict(name='OK', value=0), dict(name='ERROR', value=2), dict(name='RAW', value="b'x'")])


if __name__ == '__main__':
    unittest.main()
