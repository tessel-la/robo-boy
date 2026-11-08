"""Reserved relay streams retain clouds even when DDS discovery is still empty."""
from importlib.util import find_spec
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

if find_spec('rosbridge_library'):
    from rclpy.qos import DurabilityPolicy, ReliabilityPolicy
    from rosbridge_library.internal.subscribers import MultiSubscriber
else:
    MultiSubscriber = None


@unittest.skipIf(MultiSubscriber is None, 'Requires the patched ROS image')
class CloudiniQoSTests(unittest.TestCase):
    def qos(self, topic, publishers=()):
        node = Mock()
        node.get_publishers_info_by_topic.return_value = publishers
        return MultiSubscriber._get_default_qos_profile(None, node, topic)

    def test_cloudini_before_publisher_discovery_is_retained_and_reliable(self):
        qos = self.qos('/roboboy/cloudini/fixture/points')
        self.assertEqual(qos.durability, DurabilityPolicy.TRANSIENT_LOCAL)
        self.assertEqual(qos.reliability, ReliabilityPolicy.RELIABLE)
        self.assertEqual(qos.depth, 1)

    def test_other_unknown_topics_keep_compatible_defaults(self):
        for topic in ('/fixture/points', '/roboboy/cloudini_other/points'):
            with self.subTest(topic=topic):
                qos = self.qos(topic)
                self.assertEqual(qos.durability, DurabilityPolicy.VOLATILE)
                self.assertEqual(qos.reliability, ReliabilityPolicy.BEST_EFFORT)

    def test_other_known_retained_topics_still_use_publisher_discovery(self):
        publisher = SimpleNamespace(qos_profile=SimpleNamespace(
            durability=DurabilityPolicy.TRANSIENT_LOCAL, reliability=ReliabilityPolicy.RELIABLE))
        qos = self.qos('/fixture/retained', (publisher,))
        self.assertEqual(qos.durability, DurabilityPolicy.TRANSIENT_LOCAL)
        self.assertEqual(qos.reliability, ReliabilityPolicy.RELIABLE)
