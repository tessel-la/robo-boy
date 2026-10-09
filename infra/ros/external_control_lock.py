#!/usr/bin/env python3
"""Robot-side approval policy. Uses only native ROS; no browser or Robo-Boy session.

Set the allow_control ROS parameter, then publish approval commands containing a
requestId and approve boolean. See docs/robot-control.md for the wire contract.
"""
import json
import argparse
from collections import deque
from datetime import datetime, timezone
import time
import uuid

import rclpy
from rclpy.node import Node
from rclpy.parameter import Parameter
from rclpy.utilities import remove_ros_args
from std_msgs.msg import String

from external_control_protocol import EXTERNAL_PREFIX, EXTERNAL_STATE, EXTERNAL_DECISION, EXTERNAL_REQUESTS


class ExternalControlLock(Node):
    def __init__(self):
        super().__init__('controller', namespace='/roboboy/control/external')
        self.declare_parameter('allow_control', False)
        self.controller_id = str(uuid.uuid4())
        self.sequence = 0
        self.requests = {}
        self.decisions = {}
        self.owner = None
        self.owner_label = None
        self.requests_seen = None
        self.events = deque(maxlen=200)
        self.last_allowed = None
        self.state_publisher = self.create_publisher(String, EXTERNAL_STATE, 1)
        self.decision_publisher = self.create_publisher(String, EXTERNAL_DECISION, 10)
        self.create_subscription(String, EXTERNAL_REQUESTS, self.receive_requests, 10)
        self.create_subscription(String, EXTERNAL_PREFIX + 'command', self.receive_command, 10)
        self.create_timer(1.0, self.heartbeat)
        self.heartbeat()

    def record(self, message):
        self.events.append(dict(time=datetime.now(timezone.utc).isoformat(timespec='seconds'), message=message))
        self.get_logger().info(message)

    def snapshot(self):
        fresh = self.requests_seen is not None and time.monotonic() - self.requests_seen < 10
        return dict(allowControl=self.get_parameter('allow_control').value, gatewayReady=fresh,
                    owner=self.owner_label if fresh else None,
                    requests=[dict(item, decision=self.decisions.get(key)) for key, item in self.requests.items()] if fresh else [],
                    events=list(self.events))

    def set_access(self, allowed):
        if type(allowed) is not bool:
            raise ValueError('Access must be enabled or disabled.')
        result = self.set_parameters([Parameter('allow_control', value=allowed)])[0]
        if not result.successful:
            raise ValueError(result.reason)
        self.heartbeat()

    def decide(self, request_id, approved):
        if (not isinstance(request_id, str) or request_id not in self.requests
                or not self.snapshot()['gatewayReady']):
            raise ValueError('This request is no longer pending. Refresh and select a current request.')
        if type(approved) is not bool:
            raise ValueError('Choose approve or deny.')
        if approved and not self.get_parameter('allow_control').value:
            raise ValueError('Control is disabled. Enable access before approving.')
        self.decisions[request_id] = approved
        self.record(f"{'Approved' if approved else 'Denied'} request from {self.requests[request_id]['label']} ({request_id}).")
        self.heartbeat()

    def receive_requests(self, message):
        try:
            snapshot = json.loads(message.data)
            if not isinstance(snapshot, dict) or snapshot.get('version') != 1 or not isinstance(snapshot.get('requests'), list):
                return
            requests = {item['requestId']: item for item in snapshot['requests']
                        if isinstance(item, dict) and isinstance(item.get('requestId'), str)
                        and isinstance(item.get('label'), str)}
        except (ValueError, TypeError):
            return
        for request_id, request in requests.items():
            if request_id not in self.requests:
                self.record(f"Control request {request_id}: {request['label']} ({request.get('intent', 'control')})")
        for request_id in self.requests.keys() - requests.keys():
            self.record(f'Request {request_id} is no longer pending.')
        owner = snapshot.get('owner')
        owner_label = snapshot.get('ownerLabel')
        if owner != self.owner:
            self.record(f"Control owner: {owner_label or 'none'}.")
        self.owner, self.owner_label = owner, owner_label
        self.requests_seen = time.monotonic()
        self.requests = requests
        self.decisions = {key: value for key, value in self.decisions.items() if key in requests}

    def receive_command(self, message):
        try:
            command = json.loads(message.data)
            if (not isinstance(command, dict) or command.get('version') != 1
                    or not isinstance(command.get('requestId'), str)
                    or command['requestId'] not in self.requests or type(command.get('approve')) is not bool):
                return
            self.decide(command['requestId'], command['approve'])
        except (ValueError, TypeError) as error:
            self.get_logger().warning(str(error))
            return

    def heartbeat(self):
        allowed = self.get_parameter('allow_control').value
        if allowed != self.last_allowed:
            if not allowed:
                self.decisions.clear()
            self.record('Access enabled. Each request still needs approval.' if allowed else 'Access disabled.')
            self.last_allowed = allowed
        if self.requests_seen is not None and time.monotonic() - self.requests_seen >= 10:
            self.requests_seen = None
            self.requests.clear()
            self.decisions.clear()
            self.record('Gateway updates lost. Wait for reconnection before approving.')
        self.sequence += 1
        self.state_publisher.publish(String(data=json.dumps(dict(
            version=1, controllerId=self.controller_id, sequence=self.sequence, allowControl=allowed,
            reason='' if allowed else 'Control is disabled on the robot. Request access from its operator.'))))
        # Retry until the gateway removes the request: ROS discovery and separate
        # topic delivery can reorder the initial state and decision messages.
        for request_id, approved in self.decisions.items():
            if not approved or allowed:
                self.decision_publisher.publish(String(data=json.dumps(dict(
                    version=1, controllerId=self.controller_id, requestId=request_id, approve=approved))))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ui-port', type=int, help='Serve a local operator page on 127.0.0.1 at this port.')
    args = parser.parse_args(remove_ros_args()[1:])
    if args.ui_port is not None and not 1 <= args.ui_port <= 65535:
        parser.error('--ui-port must be between 1 and 65535')
    rclpy.init()
    node = ExternalControlLock()
    try:
        if args.ui_port is None:
            rclpy.spin(node)
        else:
            from external_control_ui import run
            run(node, args.ui_port)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
