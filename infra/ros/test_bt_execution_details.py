"""Tests for what the behavior-tree runner reports about executions. They need no ROS installation:

    python3 -m unittest discover -s infra/ros
"""
import array
import base64
import json
import unittest

import bt_execution_details as details


class FakeMessage:
    """Enough of a generated ROS message for the conversion: its fields in order."""

    def __init__(self, **fields):
        self._fields = fields
        for name, value in fields.items():
            setattr(self, name, value)

    def get_fields_and_field_types(self):
        return {name: 'unknown' for name in self._fields}


class ToJsonableTest(unittest.TestCase):
    def test_messages_become_plain_data_with_bytes_as_base64(self):
        image = FakeMessage(
            header=FakeMessage(frame_id='camera'),
            height=1, width=2, encoding='rgb8', step=6,
            data=array.array('B', [1, 2, 3, 4, 5, 6]),
        )
        converted = details.to_jsonable(FakeMessage(image=image, exposure=0.5, ranges=array.array('f', [1.0, 2.0])))
        self.assertEqual(converted['image']['header'], {'frame_id': 'camera'})
        self.assertEqual(base64.b64decode(converted['image']['data']), bytes([1, 2, 3, 4, 5, 6]))
        self.assertEqual(converted['ranges'], [1.0, 2.0])
        self.assertEqual(converted['exposure'], 0.5)
        json.dumps(converted, allow_nan=False)

    def test_compressed_bytes_and_non_finite_numbers_stay_valid_json(self):
        converted = details.to_jsonable({'format': 'jpeg', 'data': b'\xff\xd8', 'depth': float('nan'), 'far': float('inf')})
        self.assertEqual(converted['data'], base64.b64encode(b'\xff\xd8').decode())
        self.assertEqual((converted['depth'], converted['far']), ('nan', 'inf'))
        json.dumps(converted, allow_nan=False)

    def test_payloads_too_large_to_report_say_how_large_they_were(self):
        self.assertEqual(details.bounded({'ok': True}, 100), {'ok': True})
        truncated = details.bounded({'data': 'A' * 2000}, 1000)
        self.assertTrue(truncated['robo_boy_truncated'])
        self.assertGreater(truncated['bytes'], 2000)


class OutcomeTest(unittest.TestCase):
    def test_a_succeeded_goal_carries_its_result(self):
        update = details.goal_outcome(4, FakeMessage(frame_count=3))
        self.assertEqual(update, {'phase': 'succeeded', 'goalStatus': 4, 'result': {'frame_count': 3}})

    def test_an_aborted_goal_explains_itself_from_its_result(self):
        update = details.goal_outcome(6, FakeMessage(error_code=104, error_msg='Lens cover closed'))
        self.assertEqual(update['phase'], 'failed')
        self.assertEqual(update['error'], {'message': 'Lens cover closed', 'source': 'ros', 'code': 104})

    def test_a_goal_without_diagnostics_is_named_by_its_status(self):
        update = details.goal_outcome(5, FakeMessage())
        self.assertEqual(update['phase'], 'cancelled')
        self.assertEqual(update['error'], {'message': 'The goal was canceled.', 'source': 'ros', 'code': 5})

    def test_nested_error_codes_are_read(self):
        self.assertEqual(details.diagnostics({'error_code': {'value': 3}, 'message': ' busy '}), ('busy', 3))
        self.assertEqual(details.diagnostics({'success': True}), (None, None))
        self.assertEqual(details.diagnostics('text'), (None, None))

    def test_service_responses_and_feedback(self):
        self.assertEqual(details.service_outcome(FakeMessage(success=False, message='Camera busy')),
                         {'phase': 'succeeded', 'result': {'success': False, 'message': 'Camera busy'}})
        self.assertEqual(details.feedback_update(FakeMessage(progress=0.5)), {'phase': 'running', 'feedback': {'progress': 0.5}})


if __name__ == '__main__':
    unittest.main()
