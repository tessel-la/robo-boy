#!/usr/bin/env python3
"""Robot-side control switch. Uses only native ROS; no browser or Robo-Boy session.

Set the allow_control ROS parameter to enable or disable Robo-Boy control.
See docs/robot-control.md for the wire contract.
"""
import json
import uuid

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from external_control_protocol import EXTERNAL_STATE


class ExternalControlLock(Node):
    def __init__(self):
        super().__init__('controller', namespace='/roboboy/control/external')
        self.declare_parameter('allow_control', False)
        self.controller_id = str(uuid.uuid4())
        self.sequence = 0
        self.last_allowed = None
        self.state_publisher = self.create_publisher(String, EXTERNAL_STATE, 1)
        self.create_timer(1.0, self.heartbeat)
        self.heartbeat()

    def heartbeat(self):
        allowed = self.get_parameter('allow_control').value
        if allowed != self.last_allowed:
            self.get_logger().info('Access enabled. Robo-Boy sessions can request control.' if allowed else 'Access disabled.')
            self.last_allowed = allowed
        self.sequence += 1
        self.state_publisher.publish(String(data=json.dumps(dict(
            version=1, controllerId=self.controller_id, sequence=self.sequence, allowControl=allowed,
            reason='' if allowed else 'Control is disabled on the robot. Request access from its operator.'))))


def main():
    rclpy.init()
    node = ExternalControlLock()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
