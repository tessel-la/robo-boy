"""What the behavior-tree runner reports about an action or service execution, in the shape the Robo-Boy panel reads
(see src/features/behaviorTree/execution/executionModel.ts). No ROS imports: the conversions are testable anywhere.

    python3 -m unittest discover -s infra/ros
"""

from __future__ import annotations

import array
import base64
import json
import math
from typing import Any, Optional

# action_msgs/msg/GoalStatus
GOAL_STATUS_SUCCEEDED = 4
GOAL_STATUS_CANCELED = 5
GOAL_STATUS_ABORTED = 6

# The status topic keeps its last messages for late subscribers, so what one event carries is capped: a compressed
# camera frame fits, a raw 4K frame does not (the panel then says how large it was).
MAX_RESULT_BYTES = 4 * 1024 * 1024
MAX_FEEDBACK_BYTES = 256 * 1024

_MESSAGE_FIELDS = ('error_msg', 'error_message', 'error_string', 'message', 'status_message', 'reason', 'error')
_CODE_FIELDS = ('error_code', 'code', 'status_code', 'return_code')


def to_jsonable(value: Any, depth: int = 0) -> Any:
    """A ROS message (or anything inside one) as JSON-ready data, the way rosbridge sends it: uint8[] as base64."""
    if depth > 32:
        return '<nested too deep>'
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        # JSON has no NaN or infinity; the browser would refuse the whole status message.
        return value if math.isfinite(value) else str(value)
    if isinstance(value, (bytes, bytearray)):
        return base64.b64encode(bytes(value)).decode('ascii')
    if isinstance(value, array.array):
        if value.typecode in ('B', 'b'):
            return base64.b64encode(value.tobytes()).decode('ascii')
        return [to_jsonable(item, depth + 1) for item in value.tolist()]
    if hasattr(value, 'get_fields_and_field_types'):
        return {name: to_jsonable(getattr(value, name), depth + 1) for name in value.get_fields_and_field_types()}
    if hasattr(value, 'tolist'):  # numpy arrays (fixed-size ROS arrays)
        listed = value.tolist()
        if getattr(value, 'dtype', None) is not None and str(value.dtype) == 'uint8':
            return base64.b64encode(bytes(listed)).decode('ascii')
        return to_jsonable(listed, depth + 1)
    if isinstance(value, dict):
        return {str(key): to_jsonable(item, depth + 1) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        if value and all(isinstance(item, bytes) and len(item) == 1 for item in value):
            return base64.b64encode(b''.join(value)).decode('ascii')
        return [to_jsonable(item, depth + 1) for item in value]
    return str(value)


def bounded(value: Any, limit: int) -> Any:
    """The value if it serialises within `limit` bytes; otherwise a note saying how large it was."""
    size = len(json.dumps(value, separators=(',', ':'), default=str))
    if size <= limit:
        return value
    return {
        'robo_boy_truncated': True,
        'bytes': size,
        'note': f'Too large to report ({size / (1024 * 1024):.1f} MB, over {limit / (1024 * 1024):.1f} MB).',
    }


def diagnostics(payload: Any) -> tuple[Optional[str], Any]:
    """The message and code a result or response gives about itself (`message`, `error_code`…), if any."""
    if not isinstance(payload, dict):
        return None, None
    message = next((payload[name].strip() for name in _MESSAGE_FIELDS
                    if isinstance(payload.get(name), str) and payload[name].strip()), None)
    code = next((payload[name] for name in _CODE_FIELDS if isinstance(payload.get(name), (int, str))
                 and not isinstance(payload.get(name), bool)), None)
    if code is None:
        nested = next((payload[name] for name in _CODE_FIELDS if isinstance(payload.get(name), dict)), None)
        if nested is not None and isinstance(nested.get('value'), (int, str)):
            code = nested['value']
    return message, code


def phase_for_goal_status(status: int) -> str:
    if status == GOAL_STATUS_SUCCEEDED:
        return 'succeeded'
    if status == GOAL_STATUS_CANCELED:
        return 'cancelled'
    return 'failed'


GOAL_STATUS_NAMES = {0: 'unknown', 1: 'accepted', 2: 'executing', 3: 'canceling', 4: 'succeeded', 5: 'canceled', 6: 'aborted'}


def error(message: str, source: str, code: Any = None, details: Any = None) -> dict[str, Any]:
    report: dict[str, Any] = {'message': message, 'source': source}
    if code is not None:
        report['code'] = code
    if details is not None:
        report['details'] = details
    return report


def goal_outcome(status: int, result: Any) -> dict[str, Any]:
    """The update for an action whose goal ended with this status and result."""
    payload = bounded(to_jsonable(result), MAX_RESULT_BYTES)
    phase = phase_for_goal_status(status)
    update: dict[str, Any] = {'phase': phase, 'goalStatus': status, 'result': payload}
    if phase != 'succeeded':
        message, code = diagnostics(payload)
        name = GOAL_STATUS_NAMES.get(status, f'status {status}')
        update['error'] = error(message or f'The goal was {name}.', 'ros', code if code is not None else status)
    return update


def service_outcome(response: Any) -> dict[str, Any]:
    return {'phase': 'succeeded', 'result': bounded(to_jsonable(response), MAX_RESULT_BYTES)}


def feedback_update(feedback: Any) -> dict[str, Any]:
    return {'phase': 'running', 'feedback': bounded(to_jsonable(feedback), MAX_FEEDBACK_BYTES)}
