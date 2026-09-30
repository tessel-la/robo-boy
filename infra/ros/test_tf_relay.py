"""Run with python3 -m unittest discover -s infra/ros -p test_tf_relay.py."""
from types import SimpleNamespace
import unittest

from tf_relay import Demand, LatestPerFrame


def transform(child, x):
    return SimpleNamespace(child_frame_id=child, x=x)


class TfRelayTests(unittest.TestCase):
    def test_keeps_the_newest_transform_of_every_frame_across_publishers(self):
        latest = LatestPerFrame()
        # Two arms interleave disjoint frame subsets, as independent /tf publishers do.
        for index in range(25):
            latest.add([transform('big_link_1', index), transform('big_link_2', index)])
            latest.add([transform('small_link_1', index + 100)])
        taken = {item.child_frame_id: item.x for item in latest.take()}
        self.assertEqual(taken, {'big_link_1': 24, 'big_link_2': 24, 'small_link_1': 124})
        # Only frames that changed since the last publish are sent again.
        self.assertEqual(latest.take(), [])
        latest.add([transform('small_link_1', 200)])
        self.assertEqual([item.x for item in latest.take()], [200])

    def test_follows_readers_with_a_grace_period(self):
        demand = Demand(grace=5)
        # Nobody has read the relay yet: /tf is not subscribed at all.
        self.assertFalse(demand.wanted(0, 0))
        self.assertTrue(demand.wanted(1, 1))
        # The last reader left: keep following through the grace (a browser reload), then stop.
        self.assertTrue(demand.wanted(0, 10))
        self.assertTrue(demand.wanted(0, 14.9))
        self.assertFalse(demand.wanted(0, 15))
        self.assertFalse(demand.wanted(0, 30))
        # A reader returning within the grace keeps the subscription and restarts the clock.
        self.assertTrue(demand.wanted(1, 40))
        self.assertTrue(demand.wanted(0, 41))
        self.assertTrue(demand.wanted(1, 45))
        self.assertTrue(demand.wanted(0, 49))
        self.assertTrue(demand.wanted(0, 53.9))
        self.assertFalse(demand.wanted(0, 54))

if __name__ == '__main__':
    unittest.main()
