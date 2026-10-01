#!/usr/bin/env python3
"""Native py_trees 2.6 XML worker with a small JSON-lines control interface."""
from __future__ import annotations

import contextlib
import importlib
import json
import os
import math
import sys
import tempfile
import time
import sysconfig

# ROS setup prepends distro site-packages; the executor venv owns its XML version.
sys.path.insert(0, sysconfig.get_path('purelib'))

# Node print statements never corrupt the IPC stream.
protocol_stdout = sys.stdout
sys.stdout = sys.stderr
import py_trees
from py_trees.parsers.behaviour_tree_xml import parse_behaviour_tree_xml, DECORATOR_NODES
from py_trees.ports import BehaviourWithPorts, PortInformation, PortsMixin, get_ports_registry


class Wait(BehaviourWithPorts):
    INPUT_PORTS = {'seconds': PortInformation(data_type=float, default_value=0.2)}
    OUTPUT_PORTS = {}

    def initialise(self):
        seconds = self.get_input('seconds')
        if not math.isfinite(seconds) or seconds < 0:
            raise ValueError('Wait seconds must be finite and nonnegative')
        self.until = time.monotonic() + seconds

    def update(self):
        self.feedback_message = 'Waiting'
        return py_trees.common.Status.RUNNING if time.monotonic() < self.until else py_trees.common.Status.SUCCESS


class RosAction(BehaviourWithPorts):
    INPUT_PORTS = {
        'action_name': PortInformation(data_type=str, required=True),
        'action_type': PortInformation(data_type=str, required=True),
        'goal': PortInformation(data_type=str, default_value='{}'),
        'goal_b64': PortInformation(data_type=str, default_value=''),
        'timeout': PortInformation(data_type=float, default_value=30.0),
    }
    OUTPUT_PORTS = {'result': PortInformation(data_type=str, required=False)}

    def initialise(self):
        self.response = None
        encoded = self.get_input('goal_b64')
        requests.append({'id': str(self.id), 'action_name': self.get_input('action_name'),
                         'action_type': self.get_input('action_type'),
                         'goal': {} if encoded else json.loads(self.get_input('goal')), 'goalB64': encoded, 'timeout': self.get_input('timeout')})

    def update(self):
        if self.response is None:
            return py_trees.common.Status.RUNNING
        self.feedback_message = self.response.get('message', '')
        if 'result' in self.response:
            # An optional output port is not required to execute.
            self._set_output('result', json.dumps(self.response['result']))
        return py_trees.common.Status.SUCCESS if self.response.get('success') else py_trees.common.Status.FAILURE

    def terminate(self, new_status):
        if new_status == py_trees.common.Status.INVALID and self.status == py_trees.common.Status.RUNNING:
            cancellations.append(str(self.id))


# The upstream XML parser requires PortsMixin leaves. Wrap native constant
# behaviors without reimplementing their lifecycle or status semantics.
for behavior_name in ('Success', 'Failure', 'Running', 'Dummy'):
    type(behavior_name, (PortsMixin, getattr(py_trees.behaviours, behavior_name)),
         {'INPUT_PORTS': {}, 'OUTPUT_PORTS': {}})

requests = []
cancellations = []
transitions = []
status_map = {'INVALID': 'idle', 'RUNNING': 'running', 'SUCCESS': 'success', 'FAILURE': 'failure'}


class StatusVisitor(py_trees.visitors.VisitorBase):
    """Observe visited results before a native parent invalidates descendants."""
    def run(self, behaviour):
        transitions.append({'id': str(behaviour.id), 'status': status_map[behaviour.status.name],
                            'nativeStatus': behaviour.status.name})

# Only the operator can choose imports, never uploaded XML.
for module in filter(None, os.environ.get('ROBOBOY_PY_TREES_MODULES', '').split(':')):
    importlib.import_module(module)
registry = dict(get_ports_registry())
tree = None
ros_node = None
ros_executor = None
ros_thread = None
ros_available = False
try:
    import py_trees_ros
    import rclpy
    from rclpy.executors import MultiThreadedExecutor
    ros_available = True
except ImportError:
    pass


def snapshot():
    nodes = []
    if tree:
        def walk(node, parent=None):
            nodes.append({'id': str(node.id), 'parentId': parent, 'label': node.name,
                          'type': type(node).__name__, 'status': status_map[node.status.name],
                          'nativeStatus': node.status.name, 'feedback': node.feedback_message})
            for child in node.children:
                walk(child, str(node.id))
        walk(tree.root)
    result = {'nodes': nodes, 'actions': list(requests), 'cancellations': list(cancellations),
              'transitions': list(transitions)}
    requests.clear()
    cancellations.clear()
    transitions.clear()
    return result


def shutdown():
    global tree, ros_node, ros_executor, ros_thread
    if tree:
        tree.root.stop(py_trees.common.Status.INVALID)
        if ros_available:
            tree.shutdown(destroy_node=False)
        else:
            tree.shutdown()
        tree = None
    if ros_executor:
        ros_executor.shutdown(timeout_sec=2)
        ros_thread.join(timeout=2)
        ros_node.destroy_node()
        rclpy.shutdown()
        ros_node = ros_executor = ros_thread = None


def handle(command):
    global tree, ros_node, ros_executor, ros_thread
    name = command['command']
    if name == 'discover':
        return {'version': py_trees.version.__version__, 'nodes': sorted(set(registry) | {'Sequence', 'Selector', 'Fallback', 'Parallel', 'SubTree'} | {cls.__name__ for cls in DECORATOR_NODES.values()}),
                'rosIntegration': 'py_trees_ros' if ros_available else 'rclpy action bridge'}
    if name == 'load':
        shutdown()
        py_trees.blackboard.Blackboard.clear()
        with tempfile.NamedTemporaryFile(mode='w', suffix='.xml') as xml_file:
            xml_file.write(command['xml'])
            xml_file.flush()
            import xml.etree.ElementTree as ET
            parsed = ET.fromstring(command['xml'])
            for element in parsed.iter():
                # Registered PortsMixin classes own their constructor arguments.
                if element.tag in registry:
                    continue
                tag = element.tag.lower()
                if tag in ('sequence', 'selector', 'fallback', 'parallel'):
                    allowed = {'name', 'policy'} if tag == 'parallel' else {'name', 'memory'}
                    unknown = set(element.attrib) - allowed
                    if unknown:
                        raise ValueError(f'Unsupported {element.tag} attributes: {", ".join(sorted(unknown))}')
                if tag == 'parallel' and element.get('policy', 'success_on_one') not in ('success_on_all', 'success_on_one'):
                    raise ValueError('Unsupported Parallel policy; upstream XML cannot select children for success_on_selected')
                if tag in ('sequence', 'selector', 'fallback') and element.get('memory', 'true').lower() not in ('true', 'false'):
                    raise ValueError('memory must be true or false')
            root = parse_behaviour_tree_xml(xml_file.name, main_tree_id=command['mainTreeId'], node_registry=registry)
        if ros_available:
            import threading
            rclpy.init()
            ros_node = rclpy.create_node('robo_boy_py_trees_worker_' + str(os.getpid()))
            tree = py_trees_ros.trees.BehaviourTree(root)
            ros_executor = MultiThreadedExecutor()
            ros_executor.add_node(ros_node)
            ros_thread = threading.Thread(target=ros_executor.spin, daemon=True)
            ros_thread.start()
            tree.setup(node=ros_node, timeout=5.0)
        else:
            tree = py_trees.trees.BehaviourTree(root)
            tree.setup(timeout=5.0)
        tree.visitors.append(StatusVisitor())
        return snapshot()
    if not tree:
        raise ValueError('No tree loaded')
    if name == 'tick':
        tree.tick()
        return {**snapshot(), 'result': tree.root.status.name.lower()}
    if name == 'halt':
        tree.root.stop(py_trees.common.Status.INVALID)
        return snapshot()
    if name == 'action_result':
        for node in tree.root.iterate():
            if str(node.id) == command['id'] and isinstance(node, RosAction):
                node.response = command
                return {}
        raise ValueError('Action node no longer exists')
    raise ValueError('Unsupported worker command')


try:
    for line in sys.stdin:
        try:
            with contextlib.redirect_stdout(sys.stderr):
                response = {'ok': True, **handle(json.loads(line))}
        except Exception as exc:
            response = {'ok': False, 'error': f'{type(exc).__name__}: {exc}'}
        protocol_stdout.write(json.dumps(response) + '\n')
        protocol_stdout.flush()
finally:
    shutdown()
