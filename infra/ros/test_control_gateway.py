"""Policy and real multi-WebSocket tests; no ROS installation required."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path

import tornado.httpserver
import tornado.netutil
import tornado.testing
import tornado.web
import tornado.websocket

from control_gateway import Authority, application, monitor_runner, BT_COMMAND, BT_STATUS, STATUS_TOPIC


class AuthorityTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.authority = Authority(clock=lambda: self.now)
        self.sent, self.forwarded, self.closed = {}, {}, []
        self.a, self.b = self.add(), self.add()
        self.runner()

    def add(self):
        sent, forwarded = [], []
        client = self.authority.add(sent.append, forwarded.append, lambda: self.closed.append(client))
        self.sent[client], self.forwarded[client] = sent, forwarded
        return client

    def runner(self, state='idle', session=None, work=0):
        self.authority.runner_status(dict(protocolVersion=1, state=state, sessionId=session, activeWork=work, runnerId='runner'))

    def control(self, client, action, **extra):
        self.authority.receive(client, dict(op='roboboy_control', action=action, token=self.authority.token, **extra))

    def command(self, client, op='publish', **extra):
        self.authority.receive(client, dict(op=op, controlToken=self.authority.token, **extra))

    def goal(self, client, request='goal'):
        self.command(client, op='send_action_goal', id=request, action='/move', action_type='example/action/Move', args={})

    def test_atomic_acquisition_and_read_only_sessions(self):
        self.control(self.a, 'acquire')
        first = self.authority.token
        self.control(self.b, 'acquire')
        self.assertEqual((self.authority.owner, self.authority.token), (self.a, first))
        self.command(self.b, topic='/cmd_vel', msg={})
        self.command(self.b, 'call_service', id='read', service='/rosapi/topics')
        self.command(self.b, 'call_service', id='write', service='/rosapi/set_param')
        self.assertEqual([m['id'] for m in self.forwarded[self.b]], ['read'])
        self.assertFalse(next(m for m in self.sent[self.b] if m.get('id') == 'write')['result'])
        self.command(self.a, topic='/cmd_vel', msg={})
        self.assertEqual(self.forwarded[self.a][-1]['topic'], '/cmd_vel')

    def test_observers_can_read_recordings_without_mutating_the_recorder(self):
        for action in ('status', 'folders', 'start', 'stop'):
            self.command(self.b, topic='/roboboy/recorder/command', msg=dict(data=json.dumps(dict(version=1, id=action, action=action))))
        self.assertEqual([json.loads(message['msg']['data'])['action'] for message in self.forwarded[self.b]], ['status', 'folders'])

    def test_release_transfer_and_stale_tokens(self):
        self.control(self.a, 'acquire')
        stale = self.authority.token
        self.control(self.a, 'transfer', target=self.b)
        self.assertEqual(self.authority.owner, self.b)
        self.assertNotEqual(stale, self.authority.token)
        self.authority.receive(self.a, dict(op='publish', topic='/cmd_vel', msg={}, controlToken=stale))
        self.authority.receive(self.b, dict(op='publish', topic='/cmd_vel', msg={}, controlToken=stale))
        self.assertFalse(self.forwarded[self.a] or self.forwarded[self.b])
        self.control(self.b, 'release')
        self.control(self.a, 'acquire')
        self.assertNotEqual(stale, self.authority.token)

    def test_disconnect_without_work_recovers_immediately(self):
        self.control(self.a, 'acquire')
        self.authority.disconnect(self.a)
        self.assertIsNone(self.authority.owner)
        self.assertIn(self.a, self.closed)
        self.control(self.b, 'acquire')
        self.assertEqual(self.authority.owner, self.b)

    def test_lease_expiry_checked_before_each_command_and_no_auto_reacquisition(self):
        self.control(self.a, 'acquire')
        old = self.authority.token
        self.now = 10
        self.runner()
        self.authority.receive(self.a, dict(op='publish', topic='/cmd_vel', msg={}, controlToken=old))
        self.assertIsNone(self.authority.owner)
        self.assertFalse(self.forwarded[self.a])
        self.control(self.b, 'acquire')
        self.assertEqual(self.authority.owner, self.b)

    def test_heartbeat_does_not_prevent_idle_expiry(self):
        self.control(self.a, 'acquire')
        for self.now in range(1, 121):
            self.runner()
            self.control(self.a, 'heartbeat')
            self.authority.tick()
        self.assertIsNone(self.authority.owner)

    def test_long_action_survives_idle_and_cancellation_requires_terminal_result(self):
        self.control(self.a, 'acquire')
        self.goal(self.a)
        self.control(self.a, 'transfer', target=self.b)
        self.assertEqual(self.authority.owner, self.a)
        for self.now in range(1, 181):
            self.runner()
            self.control(self.a, 'heartbeat')
            self.authority.tick()
        self.assertFalse(self.authority.draining)
        self.authority.disconnect(self.a)
        self.assertTrue(self.authority.draining)
        self.assertEqual(self.forwarded[self.a][-1]['op'], 'cancel_action_goal')
        self.control(self.b, 'acquire')
        self.assertEqual(self.authority.owner, self.a)
        self.authority.upstream(self.a, dict(op='action_feedback', id='goal'))
        self.authority.upstream(self.a, dict(op='action_result', id='goal', status=2))
        self.assertTrue(self.authority.draining)
        self.authority.upstream(self.a, dict(op='action_result', id='goal', status=5, result=True))
        self.control(self.b, 'acquire')
        self.assertEqual(self.authority.owner, self.b)

    def test_pending_service_retained_and_ids_never_reused(self):
        self.control(self.a, 'acquire')
        self.command(self.a, 'call_service', id='service', service='/reset')
        self.control(self.a, 'release')
        self.control(self.b, 'acquire')
        self.assertTrue(self.authority.draining)
        self.authority.upstream(self.a, dict(op='service_response', id='service', result=False))
        self.assertTrue(self.authority.draining)
        self.authority.upstream(self.a, dict(op='service_response', id='service', result=True))
        self.control(self.a, 'acquire')
        self.command(self.a, 'call_service', id='service', service='/reset')
        self.assertEqual(len(self.forwarded[self.a]), 1)

    def test_action_expiry_retries_cancel_and_keeps_upstream_open(self):
        self.control(self.a, 'acquire')
        self.goal(self.a)
        self.now = 11
        self.runner()
        self.authority.tick()
        self.assertTrue(self.authority.draining)
        count = len(self.forwarded[self.a])
        self.authority.tick()
        self.assertGreater(len(self.forwarded[self.a]), count)
        self.authority.disconnect(self.a)
        self.assertNotIn(self.a, self.closed)

    def test_persistent_work_acknowledgement_idle_does_not_mean_stopped(self):
        self.control(self.a, 'acquire')
        self.command(self.a, topic=BT_COMMAND, msg=dict(data=json.dumps(dict(protocolVersion=1, command='start', sessionId='tree', tree=dict(nodes=[])))))
        self.control(self.a, 'release')
        self.runner()  # stale idle status must not acknowledge the start
        self.assertTrue(self.authority.draining)
        self.runner('running', 'tree', 1)
        self.runner('idle', 'tree', 1)  # timed-out node still executing in ROS
        self.control(self.b, 'acquire')
        self.assertTrue(self.authority.draining)
        self.runner('idle', 'tree', 0)
        for key, message in list(self.authority.pending.items()):
            if message['id'].startswith('control-barrier-'):
                self.authority.upstream(key[0], dict(op='service_response', id=key[1], result=True))
        self.control(self.b, 'acquire')
        self.assertEqual(self.authority.owner, self.b)

    def test_topic_handover_waits_for_same_socket_fifo_barrier(self):
        self.control(self.a, 'acquire')
        self.command(self.a, topic='/cmd_vel', msg={})
        self.control(self.a, 'release')
        barrier = self.forwarded[self.a][-1]
        self.assertEqual(barrier['service'], '/rosapi/get_time')
        self.control(self.b, 'acquire')
        self.assertTrue(self.authority.draining)
        self.authority.upstream(self.a, dict(op='service_response', id=barrier['id'], result=True))
        self.control(self.b, 'acquire')
        self.assertEqual(self.authority.owner, self.b)

    def test_runner_restart_with_work_does_not_clear_fence(self):
        self.runner('running', 'tree', 1)
        self.authority.runner_status(dict(protocolVersion=1, state='idle', activeWork=0, runnerId='new-runner'))
        self.control(self.a, 'acquire')
        self.assertIsNone(self.authority.owner)
        self.assertIn('restarted', self.authority.fault)

    def test_persistent_run_survives_disconnect_and_atomic_adoption_only_manages_tree(self):
        self.control(self.a, 'acquire')
        self.runner('running', 'tree', 1)
        sent = []
        self.authority.runner_send = sent.append
        self.authority.disconnect(self.a)
        self.assertTrue(self.authority.adoptable())
        self.assertEqual(sent, [])  # Persist beyond the browser, as promised.
        self.control(self.b, 'adopt')
        self.assertTrue(self.authority.managing)
        rival = self.add()
        self.control(rival, 'adopt')
        self.assertEqual(self.authority.owner, self.b)
        self.command(self.b, topic='/cmd_vel', msg={})
        self.assertFalse(self.forwarded[self.b])
        self.command(self.b, topic=BT_COMMAND, msg=dict(data=json.dumps(dict(protocolVersion=1, command='stop', sessionId='tree'))))
        self.assertEqual(len(self.forwarded[self.b]), 1)
        self.runner('idle', 'tree', 0)
        self.command(self.b, topic='/cmd_vel', msg={})
        self.assertEqual(len(self.forwarded[self.b]), 2)
        self.assertFalse(self.authority.managing)

    def test_explicit_release_stops_persistent_work_and_reused_tree_id_is_rejected(self):
        self.control(self.a, 'acquire')
        self.runner('running', 'tree', 1)
        sent = []
        self.authority.runner_send = sent.append
        self.control(self.a, 'release')
        self.assertEqual(json.loads(sent[-1]['msg']['data'])['command'], 'stop')
        self.runner('idle', 'tree', 0)
        self.control(self.a, 'acquire')
        self.command(self.a, topic=BT_COMMAND, msg=dict(data=json.dumps(dict(protocolVersion=1, command='start', sessionId='tree', tree=dict(nodes=[])))))
        self.assertFalse(self.forwarded[self.a])

    def test_unknown_runner_and_legacy_runner_fail_closed_but_reads_work(self):
        self.authority.runner_ready = False
        self.authority.runner_status(dict(protocolVersion=1, state='idle'))
        self.control(self.a, 'acquire')
        self.assertIsNone(self.authority.owner)
        self.command(self.a, 'subscribe', topic='/image')
        self.command(self.a, topic=BT_COMMAND, msg=dict(data=json.dumps(dict(protocolVersion=1, command='status'))))
        self.assertEqual(len(self.forwarded[self.a]), 2)

    def test_reserved_topics_protocol_bypasses_latching_and_aliases_rejected(self):
        self.control(self.a, 'acquire')
        for topic in (STATUS_TOPIC, BT_STATUS, 'cmd_vel', '//cmd_vel', '/cmd_vel#alias'):
            self.command(self.a, topic=topic, msg={})
        self.command(self.a, 'advertise', topic='/cmd_vel', latch=True)
        self.command(self.a, 'call_service', id='bypass', service='/move/_action/send_goal')
        self.command(self.a, 'advertise_service', service='/server')
        self.assertFalse(self.forwarded[self.a])
        self.authority.receive(self.a, dict(op='roboboy_frame', message=dict(op='publish', topic='/cmd_vel', msg={}, controlToken=self.authority.token)))
        self.assertEqual(len(self.forwarded[self.a]), 1)

    def test_mutating_responses_not_compressed_and_no_observer_cancel(self):
        self.control(self.a, 'acquire')
        self.command(self.a, 'send_action_goal', id='goal', action='/move', compression='png', fragment_size=100)
        self.assertEqual(self.forwarded[self.a][0]['compression'], 'none')
        self.assertNotIn('fragment_size', self.forwarded[self.a][0])
        self.command(self.b, 'cancel_action_goal', id='goal', action='/move')
        self.assertFalse(self.forwarded[self.b])

    def test_journal_fences_restart_until_operator_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'unconfirmed'
            self.authority.marker = marker
            self.control(self.a, 'acquire')
            self.goal(self.a)
            self.assertTrue(marker.exists())
            self.assertTrue(Authority(marker).fault)
            self.authority.upstream(self.a, dict(op='action_result', id='goal', status=4))
            self.assertFalse(marker.exists())
            self.assertFalse(Authority(marker).fault)
            self.goal(self.a, 'second')
            self.authority.upstream_lost(self.a)
            self.assertTrue(self.authority.fault)
            self.assertTrue(marker.exists())


class FakeBridge(tornado.websocket.WebSocketHandler):
    def initialize(self, received, sockets):
        self.received = received
        self.sockets = sockets
    def open(self):
        self.sockets.append(self)
    def on_message(self, raw):
        message = json.loads(raw)
        self.received.append((self, message))
        if message['op'] == 'call_service' and message['service'] in ('/rosapi/topics', '/rosapi/get_time'):
            self.write_message(json.dumps(dict(op='service_response', id=message['id'], result=True, values=dict(topics=['/cmd_vel']))))
        if message['op'] == 'subscribe' and message['topic'] == BT_STATUS:
            self.write_message(json.dumps(dict(op='publish', topic=BT_STATUS, msg=dict(data=json.dumps(dict(protocolVersion=1, state='idle', activeWork=0, runnerId='runner'))))))


class SocketTests(tornado.testing.AsyncHTTPTestCase):
    def get_app(self):
        self.received, self.bridge_sockets = [], []
        bridge_app = tornado.web.Application([(r'/.*', FakeBridge, dict(received=self.received, sockets=self.bridge_sockets))])
        self.bridge_server = tornado.httpserver.HTTPServer(bridge_app)
        sockets = tornado.netutil.bind_sockets(0, '127.0.0.1')
        self.bridge_server.add_sockets(sockets)
        self.authority = Authority()
        self.authority.runner_status(dict(protocolVersion=1, state='idle', activeWork=0, runnerId='runner'))
        self.upstream_url = f'ws://127.0.0.1:{sockets[0].getsockname()[1]}'
        self.clients = []
        return application(self.authority, self.upstream_url)

    async def connect(self):
        socket = await tornado.websocket.websocket_connect(self.get_url('/websocket').replace('http:', 'ws:'))
        self.clients.append(socket)
        status = await self.status(socket)
        return socket, status['selfId']

    async def status(self, socket, predicate=lambda value: True):
        while True:
            raw = await socket.read_message()
            if raw is None:
                raise AssertionError('Unexpected disconnect')
            message = json.loads(raw)
            if message.get('topic') == STATUS_TOPIC:
                value = json.loads(message['msg']['data'])
                if predicate(value):
                    return value

    async def until(self, predicate):
        for _ in range(100):
            if predicate():
                return
            await asyncio.sleep(.01)
        raise AssertionError('Condition did not complete')

    def tearDown(self):
        for socket in self.clients:
            socket.close()
        for socket in self.bridge_sockets:
            socket.close()
        self.bridge_server.stop()
        super().tearDown()

    @tornado.testing.gen_test
    async def test_simultaneous_requests_observer_reads_single_owner_and_transfer(self):
        a, aid = await self.connect()
        b, bid = await self.connect()
        c, cid = await self.connect()
        await asyncio.gather(*(socket.write_message(json.dumps(dict(op='roboboy_control', action='acquire'))) for socket in (a, b, c)))
        await self.until(lambda: self.authority.owner is not None)
        statuses = await asyncio.gather(*(self.status(socket, lambda value: value['owner'] is not None) for socket in (a, b, c)))
        self.assertEqual(sum(bool(status['token']) for status in statuses), 1)
        owner_index = next(i for i, status in enumerate(statuses) if status['token'])
        owner, owner_status = (a, b, c)[owner_index], statuses[owner_index]
        observer_index = (owner_index + 1) % 3
        observer = (a, b, c)[observer_index]
        await observer.write_message(json.dumps(dict(op='call_service', service='/rosapi/topics', id='read')))
        await observer.write_message(json.dumps(dict(op='publish', topic='/cmd_vel', msg={}, controlToken=owner_status['token'])))
        await owner.write_message(json.dumps(dict(op='roboboy_frame', message=dict(op='publish', topic='/cmd_vel', msg={}, controlToken=owner_status['token']))))
        await self.until(lambda: len([m for _, m in self.received if m['op'] == 'publish']) == 1)
        self.assertEqual(len([m for _, m in self.received if m['op'] == 'call_service']), 1)
        await owner.write_message(json.dumps(dict(op='roboboy_control', action='transfer', target=(aid, bid, cid)[observer_index], token=owner_status['token'])))
        transferred = await self.status(observer, lambda value: bool(value['token']))
        self.assertNotEqual(transferred['token'], owner_status['token'])

    @tornado.testing.gen_test(timeout=15)
    async def test_owner_and_observer_survive_transport_keepalive(self):
        owner, owner_id = await self.connect()
        observer, _ = await self.connect()
        await owner.write_message(json.dumps(dict(op='roboboy_control', action='acquire')))
        lease = await self.status(owner, lambda value: bool(value['token']))
        # Cross the first two transport ping intervals with no ROS traffic.
        # Tornado 6.4 checks the pong deadline before sending the first ping;
        # setting its timeout equal to the interval closes healthy clients.
        for _ in range(2):
            await asyncio.sleep(3.25)
            await owner.write_message(json.dumps(dict(op='roboboy_control', action='heartbeat', token=lease['token'])))
            renewed = await self.status(owner, lambda value: value['owner'] == owner_id)
            self.assertEqual(renewed['token'], lease['token'])
            await observer.write_message(json.dumps(dict(op='roboboy_control', action='status')))
            seen = await self.status(observer, lambda value: value['owner'] == owner_id)
            self.assertIsNone(seen['token'])

    @tornado.testing.gen_test
    async def test_disconnected_owner_retains_action_transport_until_terminal_result(self):
        a, aid = await self.connect()
        b, bid = await self.connect()
        await a.write_message(json.dumps(dict(op='roboboy_control', action='acquire')))
        status = await self.status(a, lambda value: bool(value['token']))
        await a.write_message(json.dumps(dict(op='send_action_goal', id='goal', action='/move', action_type='example/action/Move', args={}, controlToken=status['token'])))
        await self.until(lambda: bool(self.authority.pending))
        upstream = next(socket for socket, message in self.received if message['op'] == 'send_action_goal')
        a.close()
        await self.until(lambda: self.authority.draining)
        await b.write_message(json.dumps(dict(op='roboboy_control', action='acquire')))
        blocked = await self.status(b, lambda value: bool(value['error']))
        self.assertEqual(blocked['state'], 'draining')
        await self.until(lambda: any(message['op'] == 'cancel_action_goal' for _, message in self.received))
        await upstream.write_message(json.dumps(dict(op='action_result', id='goal', status=5, result=True, values={})))
        await self.until(lambda: not self.authority.pending)
        await b.write_message(json.dumps(dict(op='roboboy_control', action='acquire')))
        recovered = await self.status(b, lambda value: bool(value['token']))
        self.assertEqual(recovered['owner'], bid)

    @tornado.testing.gen_test
    async def test_private_runner_monitor_status_and_connection_loss(self):
        self.authority.runner_ready = False
        task = asyncio.create_task(monitor_runner(self.authority, self.upstream_url))
        try:
            await self.until(lambda: self.authority.runner_ready)
            monitor = next(socket for socket, message in self.received if message.get('topic') == BT_STATUS)
            await monitor.write_message(json.dumps(dict(op='publish', topic=BT_STATUS, msg=dict(data=json.dumps(dict(protocolVersion=1, state='paused', sessionId='persistent', activeWork=1, runnerId='runner'))))))
            await self.until(lambda: self.authority.runner_busy)
            monitor.close()
            await self.until(lambda: not self.authority.runner_ready)
            self.assertTrue(self.authority.runner_busy)
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


if __name__ == '__main__':
    unittest.main()
