"""Serialized, ROS-independent native runtime lifecycle and session ownership."""
from __future__ import annotations

import copy
import base64
import json
import math
import time
import uuid
from collections import OrderedDict

from .adapters import BehaviorTreeCppAdapter, PyTreesAdapter

ACTIVE = ('running',)


class RuntimeManager:
    def __init__(self, publish, bridge, adapters=None):
        self.publish = publish
        self.bridge = bridge
        self.adapters = {a.id: a for a in (adapters or [BehaviorTreeCppAdapter(), PyTreesAdapter()])}
        self.runtimes = [a.discover() for a in self.adapters.values()]
        self.enabled = {id: True for id in self.adapters}
        self.update_enabled()
        self.host_id = str(uuid.uuid4())
        self.sequence = 0
        self.session = None
        self.worker = None
        self.responses = OrderedDict()
        self.action_ids = {}
        self.last_heartbeat = 0.0
        self.node_feedback = {}
        self.node_results = {}

    def emit(self, type='snapshot', **fields):
        self.sequence += 1
        event = {'protocolVersion': 2, 'hostId': self.host_id, 'sequence': self.sequence,
                 'type': type, **fields}
        if self.session:
            event['session'] = copy.deepcopy(self.session)
            if type != 'response':
                event['session'].pop('xml', None)  # Source travels once, not at tick rate.
        self.publish(event)
        return event

    def command(self, request):
        request_id = request.get('requestId') if isinstance(request, dict) else None
        if not isinstance(request, dict) or request.get('protocolVersion') != 2:
            return
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
            return
        if request_id in self.responses:
            self.publish(self.responses[request_id])
            return
        try:
            fields = self.dispatch(request)
            response = self.emit('response', requestId=request_id, ok=True, **fields)
        except Exception as exc:
            response = self.emit('response', requestId=request_id, ok=False, error=str(exc))
        self.responses[request_id] = response
        while len(self.responses) > 128:
            self.responses.popitem(last=False)

    def dispatch(self, request):
        name = request.get('command')
        if name == 'discover':
            self.runtimes = [a.discover() for a in self.adapters.values()]
            self.update_enabled()
            return {'runtimes': self.runtimes}
        if name == 'status':
            return {'runtimes': self.runtimes}
        if name == 'set_enabled':
            runtime, enabled = request.get('runtime'), request.get('enabled')
            if runtime not in self.adapters or not isinstance(enabled, bool):
                raise ValueError('Select a valid runtime and boolean enabled state')
            if not enabled and self.session and self.session['runtime'] == runtime:
                self.session['state'] = 'stopped'
                try:
                    self.halt()
                except Exception as exc:
                    self.session.update(state='error', error=str(exc))
                    raise
                self.close_worker()
            self.enabled[runtime] = enabled
            self.update_enabled()
            return {'runtimes': self.runtimes}
        if name in ('load', 'validate'):
            if name == 'load' and self.session and self.session['state'] in ACTIVE:
                raise ValueError('Stop or cancel the active tree before loading another')
            runtime = request.get('runtime')
            adapter = self.adapters.get(runtime)
            if adapter is None:
                raise ValueError('Unknown runtime')
            if not self.enabled[runtime]:
                raise ValueError('Runtime disabled on this ROS host; enable it in the tree menu')
            descriptor = next(d for d in self.runtimes if d['id'] == runtime)
            if not descriptor['available']:
                raise ValueError(descriptor.get('reason', 'Runtime unavailable'))
            worker, loaded = adapter.open(request.get('xml'), request.get('mainTreeId'))
            if name == 'validate':
                worker.close()
                return {'nodes': loaded['nodes']}
            # Replacement is committed only after the native load/setup succeeds.
            self.close_worker()
            self.worker = worker
            self.session = {'id': str(uuid.uuid4()), 'runtime': runtime, 'xml': request['xml'],
                            'mainTreeId': loaded['mainTreeId'], 'state': 'loaded',
                            'nodes': loaded['nodes'], 'result': None, 'error': None, 'runId': None}
            self.node_feedback.clear()
            self.node_results.clear()
            return {'log': {'type': 'output', 'message': loaded['output']}} if loaded.get('output') else {}
        if not self.session or request.get('sessionId') != self.session['id']:
            raise ValueError('Session is missing or stale; reload host status')
        if name == 'start':
            if not self.enabled[self.session['runtime']]:
                raise ValueError('Runtime disabled; enable and reset the tree before running')
            if self.session['state'] != 'loaded':
                raise ValueError('Reset the tree before rerunning it')
            self.session.update(state='running', startedAt=int(time.time() * 1000), runId=str(uuid.uuid4()), result=None, error=None)
        elif name in ('stop', 'cancel'):
            self.session['state'] = 'stopped' if name == 'stop' else 'cancelled'
            try:
                self.halt()
            except Exception as exc:
                self.session.update(state='error', error=str(exc))
                raise
        elif name == 'reset':
            if not self.enabled[self.session['runtime']]:
                raise ValueError('Runtime disabled; enable it before resetting')
            self.session['state'] = 'stopped'
            try:
                self.halt()
                worker, loaded = self.adapters[self.session['runtime']].open(self.session['xml'], self.session.get('mainTreeId'))
            except Exception as exc:
                self.session.update(state='error', error=str(exc))
                raise
            self.close_worker()
            self.worker = worker
            self.session.update(state='loaded', nodes=loaded['nodes'], result=None, error=None, runId=None, startedAt=None)
            self.node_feedback.clear()
            self.node_results.clear()
            if loaded.get('output'):
                return {'log': {'type': 'output', 'message': loaded['output']}}
        else:
            raise ValueError('Unknown command')
        return {}

    def halt(self):
        try:
            if self.worker and not self.worker.closed and self.worker.process.poll() is None:
                snapshot = self.worker.call('halt')
                if self.session:
                    self.session['nodes'] = self.observed_nodes(snapshot)
                for node in self.session['nodes']:
                    if node['id'] in self.node_feedback:
                        node['feedback'] = self.node_feedback[node['id']]
                if snapshot.get('output'):
                    self.emit('log', log={'type': 'output', 'message': snapshot['output']})
            elif self.session:
                for node in self.session['nodes']:
                    node.update(status='idle', nativeStatus='unavailable')
        finally:
            self.bridge.cancel_all()
            self.action_ids.clear()

    def tick(self):
        if self.session and self.session['state'] == 'running':
            try:
                for event in self.bridge.poll():
                    if event['id'] not in self.action_ids:
                        continue
                    invocation = event['id']
                    event['id'] = self.action_ids[invocation]
                    if event['type'] == 'result':
                        self.worker.call('action_result', **{k: v for k, v in event.items() if k != 'type'})
                        del self.action_ids[invocation]
                    self.node_feedback[event['id']] = event.get('message') or json.dumps(event.get('feedback', event.get('result', '')))
                    self.emit('log', log=event)
                snapshot = self.worker.call('tick')
                self.session['nodes'] = self.observed_nodes(snapshot)
                for node in self.session['nodes']:
                    if node['id'] in self.node_feedback:
                        node['feedback'] = self.node_feedback[node['id']]
                for node_id in snapshot.get('cancellations', []):
                    for invocation, native_id in list(self.action_ids.items()):
                        if native_id == node_id:
                            self.bridge.cancel(invocation)
                            del self.action_ids[invocation]
                running_nodes = {n['id'] for n in snapshot['nodes'] if n['status'] == 'running'}
                for action in snapshot.get('actions', []):
                    if action['id'] not in running_nodes:
                        continue  # The native parent may halt a child within this tick.
                    timeout = float(action.get('timeout', 30))
                    if not math.isfinite(timeout) or not 0 < timeout <= 3600:
                        raise ValueError('RosAction timeout must be in (0, 3600] seconds')
                    if action.get('goalB64'):
                        action['goal'] = json.loads(base64.b64decode(action['goalB64'], validate=True).decode('utf-8'))
                    if not isinstance(action.get('goal'), dict):
                        raise ValueError('RosAction goal must be a JSON object')
                    invocation = str(uuid.uuid4())
                    self.action_ids[invocation] = action['id']
                    self.bridge.start({**action, 'id': invocation})
                result = snapshot.get('result')
                if result in ('success', 'failure'):
                    self.bridge.cancel_all()
                    self.action_ids.clear()
                    self.session.update(state='completed', result=result)
                if snapshot.get('output'):
                    self.emit('log', log={'type': 'output', 'message': snapshot['output']})
                self.emit(transitions=snapshot.get('transitions', []))
            except Exception as exc:
                error = str(exc)
                try:
                    self.halt()
                except Exception:
                    pass
                self.session.update(state='error', error=error)
                self.emit('log', log={'type': 'error', 'message': error})
        elif time.monotonic() - self.last_heartbeat >= 1:
            self.last_heartbeat = time.monotonic()
            self.emit(runtimes=self.runtimes)

    def close_worker(self):
        self.bridge.cancel_all()
        self.action_ids.clear()
        if self.worker:
            self.worker.close()
            self.worker = None

    def update_enabled(self):
        for runtime in self.runtimes:
            runtime['enabled'] = self.enabled[runtime['id']]

    def observed_nodes(self, snapshot):
        # Native controls can reset descendants within the same tick. Keep the
        # observed outcome separately without changing their actual native state.
        for update in [*snapshot.get('transitions', []), *snapshot['nodes']]:
            if update['status'] in ('success', 'failure'):
                self.node_results[update['id']] = (update['status'], update['nativeStatus'])
        for node in snapshot['nodes']:
            if node['id'] in self.node_results:
                node['lastResult'], node['lastNativeResult'] = self.node_results[node['id']]
        return snapshot['nodes']

    def close(self):
        try:
            self.halt()
        except Exception:
            pass  # A crashed native worker has no resources left to halt.
        finally:
            self.close_worker()
