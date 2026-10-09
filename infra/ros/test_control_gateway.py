"""Policy and real multi-WebSocket tests; no ROS installation required."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path

import tornado.httpserver
import tornado.httpclient
import tornado.netutil
import tornado.testing
import tornado.web
import tornado.websocket

from control_gateway import Authority, application, monitor_runner, BT_COMMAND, BT_STATUS, STATUS_TOPIC, EXTERNAL_STATE, EXTERNAL_DECISION, EXTERNAL_REQUESTS


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

    def test_requests_are_deduplicated_private_and_can_be_denied_or_cancelled(self):
        self.control(self.a, 'acquire')
        token, expires, activity = self.authority.token, self.authority.expires, self.authority.activity
        self.control(self.b, 'request')
        request = self.authority.snapshot(self.b)['request']
        self.control(self.b, 'request')
        self.assertEqual(self.authority.snapshot(self.b)['request'], request)
        self.assertEqual(len(self.authority.snapshot(self.a)['requests']), 1)
        self.assertEqual(self.authority.snapshot(self.b)['requests'], [])
        self.assertEqual((self.authority.token, self.authority.expires, self.authority.activity), (token, expires, activity))
        self.control(self.b, 'approve', requestId=request['id'])
        self.assertEqual(self.authority.owner, self.a)
        self.control(self.a, 'deny', requestId=request['id'])
        self.assertEqual(self.authority.snapshot(self.b)['request']['state'], 'denied')
        self.control(self.b, 'request')
        new_request = self.authority.snapshot(self.b)['request']['id']
        self.control(self.a, 'approve', requestId=request['id'])
        self.assertIn(new_request, self.authority.control_requests)
        self.control(self.b, 'cancel_request', requestId=request['id'])
        self.assertIn(new_request, self.authority.control_requests)
        self.control(self.b, 'cancel_request', requestId=new_request)
        self.assertEqual(self.authority.snapshot(self.b)['request']['state'], 'cancelled')
        self.assertFalse(self.authority.control_requests)

    def test_approval_transfers_once_and_cancels_competing_requests(self):
        self.control(self.a, 'acquire')
        old = self.authority.token
        c = self.add()
        for client in (self.b, c):
            self.control(client, 'request')
        first, second = [self.authority.snapshot(client)['request']['id'] for client in (self.b, c)]
        self.control(self.a, 'approve', requestId=first)
        self.assertEqual(self.authority.owner, self.b)
        self.assertNotEqual(self.authority.token, old)
        self.assertEqual(self.authority.snapshot(self.b)['request']['state'], 'granted')
        self.assertEqual(self.authority.snapshot(c)['request']['state'], 'cancelled')
        self.authority.receive(self.a, dict(op='roboboy_control', action='approve', requestId=second, token=old))
        self.control(self.b, 'approve', requestId=second)
        self.assertEqual(self.authority.owner, self.b)

    def test_approval_waits_for_actions_and_persistent_work_but_denial_does_not(self):
        self.control(self.a, 'acquire')
        self.goal(self.a)
        self.control(self.b, 'request')
        request_id = self.authority.snapshot(self.b)['request']['id']
        self.control(self.a, 'approve', requestId=request_id)
        self.assertEqual(self.authority.owner, self.a)
        self.assertIn(request_id, self.authority.control_requests)
        self.authority.upstream(self.a, dict(op='action_result', id='goal', status=4))
        self.runner('running', 'tree', 1)
        self.control(self.a, 'approve', requestId=request_id)
        self.assertEqual(self.authority.owner, self.a)
        self.control(self.a, 'deny', requestId=request_id)
        self.assertEqual(self.authority.snapshot(self.b)['request']['state'], 'denied')
        self.control(self.b, 'request')
        request_id = self.authority.snapshot(self.b)['request']['id']
        self.runner()
        self.authority.runner_ready = False
        self.control(self.a, 'approve', requestId=request_id)
        self.assertEqual(self.authority.owner, self.a)
        self.runner()
        self.control(self.a, 'approve', requestId=request_id)
        self.assertEqual(self.authority.owner, self.b)

    def test_request_expiry_is_checked_before_approval_between_ticks(self):
        self.control(self.a, 'acquire')
        self.control(self.b, 'request')
        request_id = self.authority.snapshot(self.b)['request']['id']
        self.now = 60
        self.authority.expires = 70
        self.runner()
        self.control(self.a, 'approve', requestId=request_id)
        self.assertEqual(self.authority.owner, self.a)
        self.assertEqual(self.authority.snapshot(self.b)['request']['state'], 'expired')
        self.assertFalse(self.authority.control_requests)

    def test_request_disconnect_and_owner_expiry_cancel_decisions(self):
        self.control(self.a, 'acquire')
        self.control(self.b, 'request')
        self.authority.disconnect(self.b)
        self.assertFalse(self.authority.snapshot(self.a)['requests'])
        c = self.add()
        self.control(c, 'request')
        request_id = self.authority.snapshot(c)['request']['id']
        self.now = 10
        self.runner()
        self.authority.tick()
        self.assertIsNone(self.authority.owner)
        self.assertEqual(self.authority.snapshot(c)['request']['state'], 'cancelled')
        self.assertIn('heartbeat expired', self.authority.snapshot(c)['request']['message'])
        self.control(self.a, 'acquire')
        self.control(self.a, 'approve', requestId=request_id)
        self.assertEqual(self.authority.owner, self.a)
        self.control(c, 'request')
        self.authority.disconnect(self.a)
        self.assertEqual(self.authority.snapshot(c)['request']['state'], 'cancelled')

    def test_approved_handover_barrier_survives_old_owner_disconnect(self):
        self.control(self.a, 'acquire')
        self.command(self.a, topic='/cmd_vel', msg={})
        self.control(self.b, 'request')
        request_id = self.authority.snapshot(self.b)['request']['id']
        self.control(self.a, 'approve', requestId=request_id)
        self.assertEqual(self.authority.snapshot(self.b)['request']['state'], 'accepted')
        self.assertIsNone(self.authority.snapshot(self.b)['token'])
        self.authority.disconnect(self.a)
        barrier = self.forwarded[self.a][-1]['id']
        self.authority.upstream(self.a, dict(op='service_response', id=barrier, result=True))
        self.assertEqual(self.authority.owner, self.b)
        self.assertEqual(self.authority.snapshot(self.b)['request']['state'], 'granted')

    def test_disconnect_without_work_recovers_immediately(self):
        self.control(self.a, 'acquire')
        self.authority.disconnect(self.a)
        self.assertIsNone(self.authority.owner)
        self.assertIn(self.a, self.closed)
        self.control(self.b, 'acquire')
        self.assertEqual(self.authority.owner, self.b)

    def test_observer_read_write_failures_do_not_fault_or_revoke_another_owner(self):
        self.control(self.a, 'acquire')
        self.goal(self.a)
        token = self.authority.token
        def fail(_message):
            raise RuntimeError('Transient upstream failure')
        for message in (
            dict(op='subscribe', topic='/image'),
            dict(op='call_service', service='/rosapi/topics', id='read'),
            dict(op='publish', topic=BT_COMMAND, msg=dict(data=json.dumps(dict(protocolVersion=1, command='status')))),
        ):
            with self.subTest(op=message['op']):
                observer = self.add()
                self.authority.clients[observer]['forward'] = fail
                self.authority.receive(observer, message)
                self.assertFalse(self.authority.fault)
                self.assertEqual((self.authority.owner, self.authority.token), (self.a, token))
                self.assertIn((self.a, 'goal'), self.authority.pending)
                self.assertIn(observer, self.closed)
        self.command(self.a, topic='/cmd_vel', msg={})
        self.assertEqual(self.forwarded[self.a][-1]['topic'], '/cmd_vel')

    def test_failed_read_on_idle_owner_releases_without_latching_fault(self):
        self.control(self.a, 'acquire')
        def fail(_message):
            raise RuntimeError('Transient upstream failure')
        self.authority.clients[self.a]['forward'] = fail
        self.command(self.a, 'subscribe', topic='/image')
        self.assertFalse(self.authority.fault)
        self.assertIsNone(self.authority.owner)
        self.control(self.b, 'acquire')
        self.assertEqual(self.authority.owner, self.b)

    def test_unexpected_observer_control_error_is_connection_scoped(self):
        self.control(self.a, 'acquire')
        token = self.authority.token
        def fail(_client, _message):
            raise RuntimeError('Unexpected status handling error')
        self.authority.control = fail
        self.control(self.b, 'status')
        self.assertFalse(self.authority.fault)
        self.assertEqual((self.authority.owner, self.authority.token), (self.a, token))
        self.assertIn(self.b, self.closed)

    def test_failed_read_on_owner_with_work_still_fences_uncertain_work(self):
        self.control(self.a, 'acquire')
        self.goal(self.a)
        def fail(_message):
            raise RuntimeError('Lost transport with work')
        self.authority.clients[self.a]['forward'] = fail
        self.command(self.a, 'subscribe', topic='/image')
        self.assertTrue(self.authority.fault)
        self.assertIsNone(self.authority.token)
        self.assertIn((self.a, 'goal'), self.authority.pending)
        self.control(self.b, 'acquire')
        self.assertNotEqual(self.authority.owner, self.b)

    def test_failed_commands_and_cancellation_keep_durable_recovery_fence(self):
        def fail(_message):
            raise TypeError('Upstream encoding or write failure')
        for command in (
            dict(op='publish', topic='/cmd_vel', msg={}),
            dict(op='call_service', service='/reset', id='reset'),
            dict(op='send_action_goal', action='/move', id='goal'),
        ):
            with self.subTest(op=command['op']), tempfile.TemporaryDirectory() as directory:
                self.setUp()
                marker = Path(directory) / 'unconfirmed'
                self.authority.marker = marker
                self.control(self.a, 'acquire')
                self.authority.clients[self.a]['forward'] = fail
                self.command(self.a, **command)
                self.assertTrue(self.authority.fault)
                self.assertIsNone(self.authority.token)
                self.assertTrue(marker.exists())
                self.authority.tick()  # Repeated failed cancellations must not escape.
                self.control(self.b, 'acquire')
                self.assertNotEqual(self.authority.owner, self.b)
                self.assertTrue(Authority(marker).fault)

    def test_journal_failure_before_command_keeps_recovery_fence(self):
        self.control(self.a, 'acquire')
        def fail():
            raise OSError('Journal unavailable')
        self.authority.dirty = fail
        self.goal(self.a)
        self.assertTrue(self.authority.fault)
        self.assertIsNone(self.authority.token)
        self.assertFalse(self.forwarded[self.a])
        self.control(self.b, 'acquire')
        self.assertNotEqual(self.authority.owner, self.b)

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
            if self.now % 20 == 0:
                self.control(self.b, 'request')
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



class ExternalAuthorityTests(unittest.TestCase):
    add = AuthorityTests.add
    runner = AuthorityTests.runner
    control = AuthorityTests.control
    command = AuthorityTests.command
    goal = AuthorityTests.goal

    def setUp(self):
        self.now = 0
        self.authority = Authority(clock=lambda: self.now, external_lock=True)
        self.sent, self.forwarded, self.closed = {}, {}, []
        self.a, self.b = self.add(), self.add()
        self.runner()
        self.sequence = 0
        self.policy(False)

    def policy(self, allowed=True, controller='robot'):
        self.sequence += 1
        self.authority.external_state(dict(version=1, controllerId=controller, sequence=self.sequence, allowControl=allowed))

    def request(self, client, action='acquire'):
        self.control(client, action)
        return self.authority.snapshot(client)['request']['id']

    def decide(self, request, approve=True, controller='robot'):
        self.authority.external_decision(dict(version=1, controllerId=controller, requestId=request, approve=approve))

    def acquire(self, client):
        self.policy()
        self.decide(self.request(client))
        self.assertEqual(self.authority.owner, client)

    def test_disabled_by_default_and_policy_messages_cannot_activate_it(self):
        authority = Authority()
        authority.external_state(dict(version=1, controllerId='robot', sequence=1, allowControl=False))
        self.assertFalse(authority.external_lock)
        self.assertIsNone(authority.external_controller)

    def test_global_switch_and_each_request_require_explicit_approval(self):
        request = self.request(self.a)
        self.decide(request)
        self.assertIsNone(self.authority.owner)
        self.policy()
        self.assertIsNone(self.authority.owner)
        self.decide(request)
        self.assertEqual(self.authority.owner, self.a)
        self.control(self.a, 'release')
        new_request = self.request(self.a)
        self.decide(request)
        self.assertIsNone(self.authority.owner)
        self.decide(new_request)
        self.assertEqual(self.authority.owner, self.a)

    def test_near_simultaneous_requests_have_one_winner(self):
        self.policy()
        first, second = self.request(self.a), self.request(self.b)
        self.decide(first)
        token = self.authority.token
        self.decide(second)
        self.assertEqual((self.authority.owner, self.authority.token), (self.a, token))
        self.assertEqual(self.authority.snapshot(self.b)['request']['state'], 'cancelled')

    def test_owner_and_robot_approval_are_both_required_in_either_order(self):
        for robot_first in (True, False):
            with self.subTest(robot_first=robot_first):
                self.setUp()
                self.acquire(self.a)
                request = self.request(self.b, 'request')
                if robot_first:
                    self.decide(request)
                else:
                    self.control(self.a, 'approve', requestId=request)
                self.assertEqual(self.authority.owner, self.a)
                if robot_first:
                    self.control(self.a, 'approve', requestId=request)
                else:
                    self.decide(request)
                self.assertEqual(self.authority.owner, self.b)

    def test_direct_transfer_requires_a_new_robot_decision(self):
        self.acquire(self.a)
        self.control(self.a, 'transfer', target=self.b)
        self.assertEqual(self.authority.owner, self.a)
        self.decide(self.authority.snapshot(self.b)['request']['id'])
        self.assertEqual(self.authority.owner, self.b)

    def test_disable_during_topic_barrier_cancels_handover(self):
        self.acquire(self.a)
        self.command(self.a, topic='/cmd_vel', msg={})
        self.control(self.a, 'transfer', target=self.b)
        self.decide(self.authority.snapshot(self.b)['request']['id'])
        barrier = next(key for key in self.authority.pending)
        self.policy(False)
        self.authority.upstream(self.a, dict(op='service_response', id=barrier[1], result=True))
        self.assertIsNone(self.authority.owner)
        self.assertIsNone(self.authority.token)
        self.assertEqual(self.authority.snapshot(self.b)['request']['state'], 'cancelled')

    def test_disable_cancels_action_but_holds_reservation_until_terminal_result(self):
        self.acquire(self.a)
        self.goal(self.a)
        old_token = self.authority.token
        self.policy(False)
        self.assertIsNone(self.authority.token)
        self.assertTrue(self.authority.draining)
        self.assertEqual(self.forwarded[self.a][-1]['op'], 'cancel_action_goal')
        self.authority.receive(self.a, dict(op='publish', topic='/cmd_vel', msg={}, controlToken=old_token))
        self.assertNotEqual(self.forwarded[self.a][-1]['op'], 'publish')
        self.authority.upstream(self.a, dict(op='action_result', id='goal', status=2))
        self.assertTrue(self.authority.pending)
        self.authority.upstream(self.a, dict(op='action_result', id='goal', status=5))
        self.assertIsNone(self.authority.owner)
        self.assertFalse(self.authority.pending)
        self.assertFalse(self.authority.fault)

    def test_approval_never_interrupts_running_work(self):
        self.acquire(self.a)
        request = self.request(self.b, 'request')
        self.control(self.a, 'approve', requestId=request)
        self.goal(self.a)
        self.decide(request)
        self.assertEqual(self.authority.owner, self.a)
        self.authority.tick()
        self.assertEqual(self.authority.owner, self.a)
        self.authority.upstream(self.a, dict(op='action_result', id='goal', status=4))
        self.authority.tick()
        self.assertEqual(self.authority.owner, self.b)

    def test_policy_heartbeat_expires_even_when_owner_heartbeats(self):
        self.acquire(self.a)
        self.now = 9
        self.control(self.a, 'heartbeat')
        self.now = 10
        self.runner()
        self.authority.tick()
        self.assertIsNone(self.authority.owner)
        self.assertFalse(self.authority.external_status()['ready'])
        self.policy()
        self.assertIsNone(self.authority.owner)

    def test_policy_restart_and_replayed_state_or_decision_cannot_restore_control(self):
        self.acquire(self.a)
        self.policy(controller='replacement')
        self.assertIsNone(self.authority.owner)
        request = self.request(self.b)
        self.policy(controller='robot')
        self.assertEqual(self.authority.external_controller, 'replacement')
        self.decide(request, controller='robot')
        self.assertIsNone(self.authority.owner)
        self.now = 9
        self.authority.external_state(dict(version=1, controllerId='replacement', sequence=2, allowControl=True))
        self.now = 10
        self.runner()
        self.authority.tick()
        self.assertFalse(self.authority.external_status()['ready'])

    def test_deny_cancel_disconnect_and_expired_requests_ignore_late_decisions(self):
        self.policy()
        request = self.request(self.a)
        self.decide(request, False)
        self.decide(request)
        self.assertEqual(self.authority.snapshot(self.a)['request']['state'], 'denied')
        request = self.request(self.a)
        self.control(self.a, 'cancel_request', requestId=request)
        self.decide(request)
        self.assertIsNone(self.authority.owner)
        request = self.request(self.a)
        self.authority.disconnect(self.a)
        self.decide(request)
        self.assertIsNone(self.authority.owner)
        request = self.request(self.b)
        for now in range(1, 61):
            self.now = now
            self.runner()
            self.policy()
        self.decide(request)
        self.assertEqual(self.authority.snapshot(self.b)['request']['state'], 'expired')
        self.assertIsNone(self.authority.owner)

    def test_persistent_adoption_requires_approval_and_global_disable_stops_the_tree(self):
        self.acquire(self.a)
        self.runner('running', 'tree', 1)
        self.authority.disconnect(self.a)
        request = self.request(self.b, 'adopt')
        self.assertTrue(self.authority.adoptable())
        self.decide(request)
        self.assertTrue(self.authority.managing)
        sent = []
        self.authority.runner_send = sent.append
        self.policy(False)
        self.assertTrue(self.authority.runner_busy)
        self.assertEqual(json.loads(sent[-1]['msg']['data'])['command'], 'stop')
        self.runner()
        self.assertIsNone(self.authority.owner)

    def test_policy_namespace_is_read_only_even_for_an_owner(self):
        self.acquire(self.a)
        for topic in (EXTERNAL_STATE, EXTERNAL_DECISION, EXTERNAL_REQUESTS):
            self.command(self.a, topic=topic, msg=dict(data='{}'))
            self.command(self.a, 'advertise', topic=topic, type='std_msgs/String')
        self.command(self.a, 'call_service', service='/roboboy/control/external/controller/set_parameters', id='forged')
        self.command(self.a, 'call_service', service='/rosapi/set_param', id='forged-param', args=dict(name='/roboboy/control/external/controller:allow_control', value='true'))
        self.assertFalse(self.forwarded[self.a])
        self.command(self.b, 'subscribe', topic=EXTERNAL_REQUESTS)
        self.assertEqual(self.forwarded[self.b][-1]['op'], 'subscribe')

    def test_request_snapshots_have_labels_but_never_lease_tokens(self):
        sent = []
        self.authority.external_send = sent.append
        request = self.request(self.a)
        self.control(self.a, 'acquire')
        snapshot = json.loads(sent[-1]['msg']['data'])
        self.assertEqual(len(snapshot['requests']), 1)
        self.assertEqual(snapshot['requests'][0]['requestId'], request)
        self.assertIn('label', snapshot['requests'][0])
        self.assertNotIn('token', json.dumps(snapshot))
        for state in ({}, dict(version=1, controllerId='robot', sequence=3, allowControl='true')):
            self.authority.external_state(state)
        self.assertFalse(self.authority.external_status()['allowControl'])

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
    async def test_origin_allowlist_rejects_unlisted_browser_origins_before_upstream_connect(self):
        allowed = frozenset(('https://roboboy.example', 'http://127.0.0.1:5173', 'tauri://localhost'))
        server = tornado.httpserver.HTTPServer(application(self.authority, self.upstream_url, allowed))
        sockets = tornado.netutil.bind_sockets(0, '127.0.0.1')
        server.add_sockets(sockets)
        url = f'ws://127.0.0.1:{sockets[0].getsockname()[1]}/websocket'
        try:
            for origin in ('https://untrusted.example', 'https://roboboy.example.evil', 'https://sub.roboboy.example', 'http://127.0.0.1', 'null'):
                with self.subTest(origin=origin), self.assertRaises(tornado.httpclient.HTTPClientError) as rejected:
                    await tornado.websocket.websocket_connect(tornado.httpclient.HTTPRequest(url, headers={'Origin': origin}))
                self.assertEqual(rejected.exception.code, 403)
            self.assertFalse(self.authority.clients)
            self.assertFalse(self.bridge_sockets)
            for origin in (*allowed, None):
                headers = {'Origin': origin} if origin is not None else {}
                client = await tornado.websocket.websocket_connect(tornado.httpclient.HTTPRequest(url, headers=headers))
                self.clients.append(client)
                status = await self.status(client)
                self.assertIsNone(status['token'])
        finally:
            server.stop()

    @tornado.testing.gen_test
    async def test_unconfigured_gateway_preserves_cross_origin_access(self):
        request = tornado.httpclient.HTTPRequest(self.get_url('/websocket').replace('http:', 'ws:'), headers={'Origin': 'https://remote-roboboy.example'})
        client = await tornado.websocket.websocket_connect(request)
        self.clients.append(client)
        status = await self.status(client)
        self.assertIsNone(status['owner'])

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
    async def test_competing_control_requests_notify_owner_and_require_consent(self):
        owner, _ = await self.connect()
        b, _ = await self.connect()
        c, cid = await self.connect()
        await owner.write_message(json.dumps(dict(op='roboboy_control', action='acquire')))
        lease = await self.status(owner, lambda value: bool(value['token']))
        await asyncio.gather(*(socket.write_message(json.dumps(dict(op='roboboy_control', action='request'))) for socket in (b, c)))
        notified = await self.status(owner, lambda value: len(value['requests']) == 2)
        request_b = await self.status(b, lambda value: value['request'] is not None)
        request_c = await self.status(c, lambda value: value['request'] is not None)
        self.assertEqual(request_b['requests'], [])
        self.assertIsNone(request_b['token'])
        self.assertEqual(len(notified['requests']), 2)
        await owner.write_message(json.dumps(dict(op='roboboy_control', action='deny', requestId=request_b['request']['id'], token=lease['token'])))
        denied = await self.status(b, lambda value: value['request'] and value['request']['state'] == 'denied')
        self.assertEqual(denied['owner'], lease['owner'])
        await owner.write_message(json.dumps(dict(op='roboboy_control', action='approve', requestId=request_c['request']['id'], token=lease['token'])))
        granted = await self.status(c, lambda value: bool(value['token']))
        self.assertEqual(granted['owner'], cid)
        self.assertEqual(granted['request']['state'], 'granted')
        self.assertNotEqual(granted['token'], lease['token'])

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
    async def test_external_policy_uses_private_ros_transport_and_cannot_be_written_by_clients(self):
        self.authority.external_lock = True
        task = asyncio.create_task(monitor_runner(self.authority, self.upstream_url))
        try:
            await self.until(lambda: self.authority.external_send is not None)
            await self.until(lambda: any(message.get('topic') == EXTERNAL_STATE for _, message in self.received))
            monitor = next(socket for socket, message in self.received if message.get('topic') == EXTERNAL_STATE)
            async def publish(topic, value):
                await monitor.write_message(json.dumps(dict(op='publish', topic=topic, msg=dict(data=json.dumps(value)))))
            await publish(EXTERNAL_STATE, dict(version=1, controllerId='robot', sequence=1, allowControl=True))
            await self.until(lambda: self.authority.external_status()['ready'])
            a, aid = await self.connect()
            b, _ = await self.connect()
            await asyncio.gather(*(socket.write_message(json.dumps(dict(op='roboboy_control', action='acquire'))) for socket in (a, b)))
            await self.until(lambda: len(self.authority.control_requests) == 2)
            self.assertIsNone(self.authority.owner)
            request = self.authority.snapshot(aid)['request']['id']
            await self.until(lambda: any(message.get('op') == 'publish' and message.get('topic') == EXTERNAL_REQUESTS and len(json.loads(message['msg']['data'])['requests']) == 2 for _, message in self.received))
            await publish(EXTERNAL_DECISION, dict(version=1, controllerId='robot', requestId=request, approve=True))
            lease = await self.status(a, lambda value: bool(value['token']))
            await a.write_message(json.dumps(dict(op='publish', topic=EXTERNAL_STATE, controlToken=lease['token'], msg=dict(data='{}'))))
            blocked = await self.status(a, lambda value: bool(value['error']))
            self.assertIn('native ROS', blocked['error'])
            await publish(EXTERNAL_STATE, dict(version=1, controllerId='robot', sequence=2, allowControl=False))
            await self.status(a, lambda value: not value['token'])
            self.assertIsNone(self.authority.owner)
            monitor.close()
            await self.until(lambda: not self.authority.external_status()['ready'])
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

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
