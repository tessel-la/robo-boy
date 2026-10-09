"""Native ROS policy topics shared by the robot node and WebSocket gateway."""
EXTERNAL_PREFIX = '/roboboy/control/external/'
EXTERNAL_STATE = EXTERNAL_PREFIX + 'state'
EXTERNAL_DECISION = EXTERNAL_PREFIX + 'decision'
EXTERNAL_REQUESTS = EXTERNAL_PREFIX + 'requests'
