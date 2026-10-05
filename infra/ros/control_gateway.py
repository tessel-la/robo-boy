#!/usr/bin/env python3
"""One robot-wide control lease in front of a private rosbridge.

All authority transitions and upstream writes run on the Tornado event loop.
No await is allowed between authorization, recording work and forwarding it.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import time
import uuid

import tornado.ioloop
import tornado.web
import tornado.websocket

STATUS_TOPIC = '/roboboy/control/status'
BT_COMMAND = '/robo_boy/behavior_tree/command'
BT_STATUS = '/robo_boy/behavior_tree/status'
LEASE_SECONDS = 10
IDLE_SECONDS = 120
READ_SERVICES = frozenset('/rosapi/' + name for name in (
    'topics', 'topics_for_type', 'topic_type', 'services', 'service_type',
    'service_request_details', 'service_response_details', 'message_details',
    'action_servers', 'action_type', 'action_goal_details', 'nodes',
    'node_details', 'publishers', 'subscribers', 'get_param', 'has_param',
    'get_param_names', 'get_time', 'topics_and_raw_types',
))


def canonical_name(value):
    # rosbridge expands relative/private names; accepting only absolute canonical
    # names prevents aliases from bypassing reserved topic/service policy.
    return (isinstance(value, str) and value.startswith('/') and len(value) <= 512
            and '//' not in value and not any(c in value for c in '#~ ')
            and all(part and part.replace('_', '').isalnum() for part in value[1:].split('/')))


def topic_command(message):
    try:
        value = json.loads(message.get('msg', {}).get('data', ''))
        return value if isinstance(value, dict) else {}
    except (ValueError, TypeError, AttributeError):
        return {}


class Authority:
    def __init__(self, marker=None, clock=time.monotonic):
        self.clock = clock
        self.marker = Path(marker) if marker else None
        self.fault = 'Gateway restarted with unconfirmed robot work; operator recovery required.' if self.marker and self.marker.exists() else ''
        self.marked = bool(self.marker and self.marker.exists())
        self.clients = {}
        self.owner = None
        self.owner_label = None
        self.token = None
        self.expires = 0
        self.activity = 0
        self.draining = False
        self.transfer_target = None
        self.stop_persistent = False
        self.managing = False
        self.reason = ''
        self.pending = {}  # (connection id, request id) -> original command
        self.runner_incarnation = None
        self.runner_sessions = set()
        self.runner_ready = False
        self.runner_busy = False
        self.runner_session = None
        self.runner_seen = 0
        self.runner_waiting = None
        self.runner_send = None

    def dirty(self):
        if self.marker and not self.marked:
            self.marker.parent.mkdir(parents=True, exist_ok=True)
            # Durably fence a restart before forwarding the first mutation.
            with self.marker.open('w') as file:
                file.write('Unconfirmed robot work\n')
                file.flush()
                os.fsync(file.fileno())
            descriptor = os.open(self.marker.parent, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            self.marked = True

    def clean_if_safe(self):
        if not self.pending and not self.runner_busy and not self.runner_waiting and not self.fault:
            if self.marker:
                self.marker.unlink(missing_ok=True)
                self.marked = False
            if self.draining:
                self.owner = self.token = None
                self.draining = False
                target = self.transfer_target
                self.transfer_target = None
                if target and self.clients.get(target, {}).get('connected'):
                    self.grant(target)
            self.retire_clients()

    def grant(self, client_id):
        self.owner, self.token = client_id, str(uuid.uuid4())
        self.owner_label = self.clients[client_id]['label']
        self.expires = self.clock() + LEASE_SECONDS
        self.activity = self.clock()

    def retire_clients(self):
        for client_id, client in list(self.clients.items()):
            if not client['connected'] and not any(key[0] == client_id for key in self.pending):
                client['close']()
                del self.clients[client_id]

    def add(self, send, forward, close):
        client_id = str(uuid.uuid4())
        self.clients[client_id] = dict(label='Session ' + client_id[:8], send=send,
                                       forward=forward, close=close, connected=True, error='', used=set(), wrote_topics=False)
        self.broadcast()
        return client_id

    def snapshot(self, client_id, error=''):
        busy = len(self.pending) + int(self.runner_busy or bool(self.runner_waiting))
        return dict(version=1, selfId=client_id, owner=self.owner,
                    ownerLabel=self.clients.get(self.owner, {}).get('label', self.owner_label) if self.owner else None,
                    token=self.token if self.owner == client_id and not self.draining and not self.fault else None,
                    state='blocked' if self.fault else 'draining' if self.draining or (busy and not self.owner) else 'owned' if self.owner else 'available',
                    ready=self.runner_ready, pending=busy, adoptable=self.adoptable(), managing=self.managing, leaseMs=LEASE_SECONDS * 1000,
                    reason=self.fault or self.reason or ('Persistent robot work reserves control.' if busy and not self.owner else ''), error=error,
                    clients=[dict(id=key, label=value['label']) for key, value in self.clients.items() if value['connected']])

    def status(self, client_id, error=''):
        client = self.clients.get(client_id)
        if client and client['connected']:
            client['send'](dict(op='publish', topic=STATUS_TOPIC,
                                msg=dict(data=json.dumps(self.snapshot(client_id, error or client['error'])))))

    def broadcast(self):
        for client_id in list(self.clients):
            self.status(client_id)

    def tick(self):
        now = self.clock()
        if self.runner_ready and now - self.runner_seen >= LEASE_SECONDS:
            self.runner_ready = False
            self.reason = 'Waiting for behavior-tree runner status.'
        if self.owner and not self.draining:
            if now >= self.expires:
                self.release('Control heartbeat expired.')
            elif now - self.activity >= IDLE_SECONDS and not self.pending and not self.runner_busy and not self.runner_waiting:
                self.release('Control released after inactivity.')
        # Retry cancellation: a goal may not have been registered by rosbridge yet.
        if self.draining:
            self.cancel_work()
        self.broadcast()

    def release(self, reason, target=None, stop_persistent=False):
        self.stop_persistent = stop_persistent
        self.managing = False
        self.transfer_target = target
        was_draining = self.draining
        self.draining = True
        self.token = None
        self.reason = reason
        if self.owner and not was_draining and self.clients[self.owner]['wrote_topics']:
            # A response on the same upstream socket is a FIFO barrier: earlier
            # topic publishes must leave rosbridge before another owner writes.
            request = dict(op='call_service', service='/rosapi/get_time', id='control-barrier-' + str(uuid.uuid4()), args={})
            self.dirty()
            self.pending[(self.owner, request['id'])] = request
            self.clients[self.owner]['wrote_topics'] = False
            self.clients[self.owner]['forward'](request)
        self.cancel_work()
        self.clean_if_safe()

    def cancel_work(self):
        for (client_id, _), message in list(self.pending.items()):
            if message['op'] == 'send_action_goal':
                self.clients[client_id]['forward'](dict(op='cancel_action_goal', id=message['id'], action=message['action']))
        if self.stop_persistent and (self.runner_busy or self.runner_waiting) and self.runner_send:
            self.runner_send(dict(op='publish', topic=BT_COMMAND, msg=dict(data=json.dumps(dict(
                protocolVersion=1, command='stop', sessionId=self.runner_waiting or self.runner_session)))))

    def adoptable(self):
        return bool(not self.fault and self.runner_ready and not self.pending and not self.runner_waiting
                    and self.runner_busy and (self.draining or not self.owner))

    def disconnect(self, client_id):
        client = self.clients.get(client_id)
        if not client:
            return
        client['connected'] = False
        if self.owner == client_id:
            self.release('Controlling session disconnected; waiting for robot work to finish.')
        self.retire_clients()
        self.broadcast()

    def control(self, client_id, message):
        action = message.get('action')
        if action != 'heartbeat':
            self.clients[client_id]['error'] = ''
        now = self.clock()
        if action == 'identify':
            label = message.get('label')
            if not isinstance(label, str) or not 1 <= len(label.strip()) <= 64:
                raise ValueError('Choose a session name of 1–64 characters.')
            self.clients[client_id]['label'] = label.strip()
            if self.owner == client_id:
                self.owner_label = label.strip()
        elif action == 'acquire':
            if self.fault or not self.runner_ready:
                raise ValueError(self.fault or 'Waiting for behavior-tree runner status.')
            if self.draining or (self.owner and self.owner != client_id):
                raise ValueError('Control is held by another session or robot work is still finishing.')
            if not self.owner and (self.pending or self.runner_busy or self.runner_waiting):
                raise ValueError('Robot work is still running.')
            if not self.owner:
                self.grant(client_id)
                self.reason = ''
            self.expires = now + LEASE_SECONDS
        elif action == 'adopt':
            if not self.adoptable():
                raise ValueError('The persistent run cannot be adopted until other work finishes.')
            self.grant(client_id)
            self.draining = False
            self.managing = True
            self.stop_persistent = False
            self.reason = 'Managing the persistent tree; new commands blocked until it finishes.'
        elif action in ('heartbeat', 'release', 'transfer'):
            if self.owner != client_id or not self.token or message.get('token') != self.token:
                raise ValueError('This control lease is no longer valid. Request control again.')
            if action == 'heartbeat':
                self.expires = now + LEASE_SECONDS
            elif action == 'release':
                self.release('Control released by its owner.', stop_persistent=True)
            else:
                target = message.get('target')
                if not isinstance(target, str) or target == client_id or not self.clients.get(target, {}).get('connected'):
                    raise ValueError('Select another connected session.')
                if self.pending or self.runner_busy or self.runner_waiting:
                    raise ValueError('Finish or stop running work before transferring control.')
                self.release('Control transferred by its owner.', target)
        elif action != 'status':
            raise ValueError('Unsupported control request.')
        self.broadcast()

    def reject(self, client_id, message, reason):
        self.clients[client_id]['error'] = reason
        self.status(client_id, reason)
        common = dict(id=message.get('id'))
        if message.get('op') == 'call_service':
            self.clients[client_id]['send'](dict(op='service_response', service=message.get('service'), result=False, values=reason, **common))
        elif message.get('op') == 'send_action_goal':
            self.clients[client_id]['send'](dict(op='action_result', action=message.get('action'), result=False, status=0, values=reason, **common))
        else:
            self.clients[client_id]['send'](dict(op='status', level='error', msg=reason, **common))

    def receive(self, client_id, message):
        if client_id not in self.clients or not self.clients[client_id]['connected']:
            return
        self.tick_expiry()
        try:
            if not isinstance(message, dict):
                raise ValueError('Only JSON objects are accepted.')
            if message.get('op') == 'roboboy_frame':
                message = message.get('message')
                if not isinstance(message, dict):
                    raise ValueError('Invalid gateway frame.')
            op = message.get('op')
            if message.get('id') is not None and (not isinstance(message['id'], str) or len(message['id']) > 256):
                raise ValueError('Request IDs must be strings of at most 256 characters.')
            if op == 'roboboy_control':
                self.control(client_id, message)
                return
            if op in ('subscribe', 'unsubscribe') and message.get('topic') == STATUS_TOPIC:
                self.status(client_id)
                return
            if op in ('subscribe', 'unsubscribe', 'advertise', 'unadvertise', 'publish'):
                if not canonical_name(message.get('topic')):
                    raise ValueError('Topics must use absolute canonical ROS names.')
                if message['topic'] in (STATUS_TOPIC, BT_STATUS) and op not in ('subscribe', 'unsubscribe'):
                    raise ValueError('This status topic is read-only.')
            if op in ('call_service', 'cancel_action_goal', 'send_action_goal'):
                if not canonical_name(message.get('service') if op == 'call_service' else message.get('action')):
                    raise ValueError('Services/actions must use absolute canonical ROS names.')
            read = op in ('subscribe', 'unsubscribe', 'advertise', 'unadvertise', 'set_level')
            read = read or (op == 'call_service' and message.get('service') in READ_SERVICES)
            read = read or (op == 'publish' and message.get('topic') == '/roboboy/inspection/request')
            command = topic_command(message) if op == 'publish' else {}
            read = read or (op == 'publish' and message.get('topic') == BT_COMMAND and command.get('protocolVersion') == 1 and command.get('command') == 'status')
            read = read or (op == 'publish' and message.get('topic') == '/roboboy/recorder/command' and command.get('version') == 1 and command.get('action') in ('status', 'folders'))
            if op not in ('subscribe', 'unsubscribe', 'advertise', 'unadvertise', 'set_level', 'call_service', 'publish', 'send_action_goal', 'cancel_action_goal'):
                raise ValueError('Unsupported operation; server/service/action advertisement is disabled.')
            if message.get('latch'):
                raise ValueError('Latched command publishers are disabled to prevent replay after handover.')
            if not read:
                if self.fault or not self.runner_ready:
                    raise ValueError(self.fault or 'Waiting for behavior-tree runner status.')
                if self.draining or self.owner != client_id or not self.token or message.get('controlToken') != self.token:
                    raise ValueError('Read-only session: request control before sending robot commands.')
                if self.managing and not (op == 'publish' and message.get('topic') == BT_COMMAND and command.get('command') in ('stop', 'pause', 'resume')):
                    raise ValueError('Managing a persistent tree: stop or finish it before sending other commands.')
                if op == 'cancel_action_goal':
                    previous = self.pending.get((client_id, message.get('id')))
                    if not previous or previous.get('action') != message['action']:
                        raise ValueError('Only this session’s tracked action goals can be cancelled.')
                if op == 'call_service' and '/_action/' in message['service']:
                    raise ValueError('Use send_action_goal for actions so their full lifetime can be tracked.')
                if op in ('call_service', 'send_action_goal'):
                    request_id = message.get('id')
                    if not isinstance(request_id, str) or not 1 <= len(request_id) <= 256 or request_id in self.clients[client_id]['used']:
                        raise ValueError('Mutating requests require a unique request id.')
                    if len(self.pending) >= 128 or len(self.clients[client_id]['used']) >= 100000:
                        raise ValueError('Too many requests; finish running work or reconnect.')
                    self.clients[client_id]['used'].add(request_id)
                    # Never allow compression/fragmentation to hide a terminal response.
                    message = {**message, 'compression': 'none'}
                    message.pop('fragment_size', None)
                    self.dirty()
                    self.pending[(client_id, request_id)] = message
                if op == 'publish' and message.get('topic') == BT_COMMAND:
                    if command.get('protocolVersion') != 1 or command.get('command') not in ('start', 'stop', 'pause', 'resume'):
                        raise ValueError('Invalid behavior-tree command.')
                    if command['command'] == 'start':
                        session = command.get('sessionId')
                        if not isinstance(session, str) or not 1 <= len(session) <= 128 or session in self.runner_sessions or session == self.runner_session or not isinstance(command.get('tree'), dict) or not isinstance(command['tree'].get('nodes'), list):
                            raise ValueError('A valid tree and session id are required.')
                        if self.runner_busy or self.runner_waiting:
                            raise ValueError('A persistent behavior tree is already running.')
                        self.dirty()
                        self.runner_sessions.add(session)
                        self.runner_waiting = session
                if op == 'publish':
                    self.clients[client_id]['wrote_topics'] = True
                self.clients[client_id]['error'] = ''
                self.activity = self.clock()
            forwarded = {key: value for key, value in message.items() if key != 'controlToken'}
            self.clients[client_id]['forward'](forwarded)
        except (ValueError, TypeError) as error:
            self.reject(client_id, message if isinstance(message, dict) else {}, str(error))
        except Exception:
            self.fault = 'Upstream write or recovery journal failed; operator recovery required.'
            self.release(self.fault)
            self.broadcast()

    def tick_expiry(self):
        now = self.clock()
        if self.runner_ready and now - self.runner_seen >= LEASE_SECONDS:
            self.runner_ready = False
        if self.owner and not self.draining:
            if now >= self.expires:
                self.release('Control heartbeat expired.')
            elif now - self.activity >= IDLE_SECONDS and not self.pending and not self.runner_busy and not self.runner_waiting:
                self.release('Control released after inactivity.')

    def upstream(self, client_id, message):
        key = (client_id, message.get('id'))
        pending = self.pending.get(key)
        if pending:
            terminal = (pending['op'] == 'call_service' and message.get('op') == 'service_response' and message.get('result') is True)
            terminal = terminal or (pending['op'] == 'send_action_goal' and message.get('op') == 'action_result' and message.get('status') in (4, 5, 6))
            if terminal:
                del self.pending[key]
                self.clean_if_safe()
                self.broadcast()
            elif message.get('op') in ('service_response', 'action_result'):
                self.reason = 'ROS returned an uncertain outcome; waiting for confirmed completion or operator recovery.'
                self.broadcast()

    def runner_status(self, status):
        if not isinstance(status, dict) or status.get('protocolVersion') != 1 or status.get('state') not in ('idle', 'running', 'paused') or type(status.get('activeWork')) is not int or status['activeWork'] < 0 or not isinstance(status.get('runnerId'), str):
            return
        incarnation = status['runnerId']
        if self.runner_incarnation and self.runner_incarnation != incarnation and (self.runner_busy or self.runner_waiting):
            self.fault = 'Behavior-tree runner restarted with unconfirmed work; operator recovery required.'
            self.dirty()
        self.runner_incarnation = incarnation
        if self.reason == 'Waiting for behavior-tree runner status.':
            self.reason = ''
        self.runner_ready = True
        self.runner_seen = self.clock()
        self.runner_session = status.get('sessionId')
        self.runner_busy = status['state'] != 'idle' or status['activeWork'] > 0
        if self.runner_busy:
            self.dirty()
        elif not self.runner_waiting and self.managing:
            self.managing = False
            self.reason = ''
        if self.runner_waiting == self.runner_session:
            self.runner_waiting = None
        self.clean_if_safe()
        self.broadcast()

    def upstream_lost(self, client_id):
        if any(key[0] == client_id for key in self.pending):
            self.fault = 'Lost rosbridge with unconfirmed work; operator recovery required.'
            self.dirty()
        self.disconnect(client_id)


class GatewaySocket(tornado.websocket.WebSocketHandler):
    def initialize(self, authority, upstream_url):
        self.authority = authority
        self.upstream_url = upstream_url
        self.client_id = None
        self.upstream_socket = None

    def check_origin(self, origin):
        # Like rosbridge: cross-origin web/desktop access. Deployment auth/network
        # policy belongs at the perimeter; session names are not authenticated users.
        return True

    def get_compression_options(self):
        return {}

    async def open(self):
        self.set_nodelay(True)
        self.ws_connection.stream.max_write_buffer_size = 20000000
        try:
            self.upstream_socket = await tornado.websocket.websocket_connect(self.upstream_url, max_message_size=10000000)
        except Exception:
            self.close(1013, 'ROS bridge unavailable')
            return
        if self.ws_connection is None:
            self.upstream_socket.close()
            return
        self.client_id = self.authority.add(self.send, self.forward, self.upstream_socket.close)
        asyncio.create_task(self.read_upstream())

    def send(self, message):
        if self.ws_connection and not self.ws_connection.is_closing():
            try:
                self.write_message(json.dumps(message)).add_done_callback(self.client_write_finished)
            except tornado.iostream.StreamBufferFullError:
                self.close(1013, 'Client is too slow')

    def client_write_finished(self, future):
        if not future.cancelled() and future.exception():
            self.close(1011, 'Client write failed')

    def forward(self, message):
        if not self.upstream_socket or not self.upstream_socket.protocol:
            raise RuntimeError('ROS bridge unavailable')
        future = self.upstream_socket.write_message(json.dumps(message))
        future.add_done_callback(self.write_finished)

    def write_finished(self, future):
        if not future.cancelled() and future.exception():
            self.authority.upstream_lost(self.client_id)
            self.close(1011, 'ROS bridge write failed')

    async def read_upstream(self):
        try:
            while True:
                raw = await self.upstream_socket.read_message()
                if raw is None:
                    break
                if isinstance(raw, str):
                    message = json.loads(raw)
                    self.authority.upstream(self.client_id, message)
                    # An observer may subscribe to authority status only locally.
                    if message.get('op') == 'publish' and message.get('topic') == STATUS_TOPIC:
                        continue
                if self.ws_connection and not self.ws_connection.is_closing():
                    # Keep consuming terminal results even if the observer stalls.
                    try:
                        self.write_message(raw, binary=isinstance(raw, bytes)).add_done_callback(self.client_write_finished)
                    except tornado.iostream.StreamBufferFullError:
                        self.close(1013, 'Client is too slow')
        except Exception:
            pass
        finally:
            self.authority.upstream_lost(self.client_id)
            self.close(1011, 'ROS bridge disconnected')

    def on_message(self, raw):
        try:
            message = json.loads(raw) if isinstance(raw, str) else None
        except ValueError:
            message = None
        self.authority.receive(self.client_id, message)

    def on_close(self):
        if self.client_id:
            self.authority.disconnect(self.client_id)


async def monitor_runner(authority, url):
    while True:
        socket = None
        try:
            socket = await tornado.websocket.websocket_connect(url, max_message_size=10000000)
            authority.runner_send = lambda message: socket.write_message(json.dumps(message))
            await socket.write_message(json.dumps(dict(op='subscribe', topic=BT_STATUS, type='std_msgs/msg/String')))
            await socket.write_message(json.dumps(dict(op='advertise', topic=BT_COMMAND, type='std_msgs/msg/String')))
            await socket.write_message(json.dumps(dict(op='publish', topic=BT_COMMAND, msg=dict(data=json.dumps(dict(protocolVersion=1, command='status'))))))
            while True:
                raw = await socket.read_message()
                if raw is None:
                    break
                message = json.loads(raw)
                if message.get('op') == 'publish' and message.get('topic') == BT_STATUS:
                    authority.runner_status(topic_command(message))
        except Exception:
            pass
        finally:
            authority.runner_ready = False
            authority.runner_send = None
            authority.broadcast()
            if socket:
                socket.close()
        await asyncio.sleep(1)


def application(authority, upstream_url):
    return tornado.web.Application([(r'/.*', GatewaySocket, dict(authority=authority, upstream_url=upstream_url))], websocket_max_message_size=10000000,
                                   websocket_ping_interval=3, websocket_ping_timeout=3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=9090)
    parser.add_argument('--upstream-port', type=int, default=9092)
    parser.add_argument('--journal', default='/var/lib/roboboy-control/unconfirmed')
    args = parser.parse_args()
    authority = Authority(args.journal)
    url = f'ws://127.0.0.1:{args.upstream_port}'
    application(authority, url).listen(args.port, address='0.0.0.0')
    tornado.ioloop.PeriodicCallback(authority.tick, 1000).start()
    tornado.ioloop.IOLoop.current().spawn_callback(monitor_runner, authority, url)
    tornado.ioloop.IOLoop.current().start()


if __name__ == '__main__':
    main()
