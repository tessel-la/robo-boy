#!/usr/bin/env python3
"""Optional real-ROS smoke proof. Run only in an isolated --network none container.

Unlike test_control_gateway.py this requires the ROS image. All commands target
mock /control_smoke interfaces, never a real robot. See docs/robot-control.md.
"""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import uuid

import rclpy
from control_msgs.action import FollowJointTrajectory
from rclpy.action import ActionServer, CancelResponse
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from std_msgs.msg import Int32, String
from rcl_interfaces.msg import Parameter, ParameterValue, ParameterType
from rcl_interfaces.srv import SetParameters
from std_srvs.srv import Trigger
import tornado.ioloop
import tornado.websocket

from control_gateway import Authority, application, monitor_runner, STATUS_TOPIC, BT_COMMAND
from external_control_protocol import EXTERNAL_PREFIX


async def until(predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(.02)
    raise AssertionError('Timed out waiting for ROS smoke condition')


status_queues = {}


async def status(socket, predicate=lambda value: True):
    while True:
        value = await asyncio.wait_for(status_queues[socket].get(), 15)
        assert value is not None, 'Gateway connection closed'
        if predicate(value):
            return value


async def send(socket, **message):
    await socket.write_message(json.dumps(message))


async def smoke():
    external = os.environ.get('CONTROL_SMOKE_EXTERNAL_LOCK') == 'true'
    rclpy.init()
    node = rclpy.create_node('control_smoke')
    group = ReentrantCallbackGroup()
    commands, cancelled = [], []
    node.create_subscription(Int32, '/control_smoke/command', lambda msg: commands.append(msg.data), 10, callback_group=group)

    def service(_request, response):
        time.sleep(.2)
        response.success = True
        return response
    node.create_service(Trigger, '/control_smoke/reset', service, callback_group=group)

    def execute(handle):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if handle.is_cancel_requested:
                cancelled.append(True)
                handle.canceled()
                return FollowJointTrajectory.Result()
            time.sleep(.02)
        handle.succeed()
        return FollowJointTrajectory.Result()
    action_server = ActionServer(node, FollowJointTrajectory, '/control_smoke/move', execute,
                                 cancel_callback=lambda _: CancelResponse.ACCEPT, callback_group=group)
    executor = MultiThreadedExecutor(num_threads=6)
    executor.add_node(node)
    thread = threading.Thread(target=executor.spin, daemon=True)
    thread.start()
    clients, processes, readers = [], [], []
    server = monitor = timer = None
    directory = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory() as temporary:
        log = open(Path(temporary) / 'ros.log', 'w+')
        try:
            processes.append(subprocess.Popen(['ros2', 'launch', str(directory / 'rosbridge_launch.xml'),
                                               'port:=19092', 'address:=127.0.0.1'], stdout=log, stderr=log))
            processes.append(subprocess.Popen(['python3', str(directory / 'behavior_tree_runner.py')], stdout=log, stderr=log))
            authority = Authority(Path(temporary) / 'unconfirmed', external_lock=external)
            upstream = 'ws://127.0.0.1:19092'
            server = application(authority, upstream).listen(19090, address='127.0.0.1')
            monitor = asyncio.create_task(monitor_runner(authority, upstream))
            timer = tornado.ioloop.PeriodicCallback(authority.tick, 1000)
            timer.start()
            await until(lambda: authority.runner_ready)

            async def switch(allowed):
                client = node.create_client(SetParameters, EXTERNAL_PREFIX + 'controller/set_parameters')
                try:
                    assert client.wait_for_service(timeout_sec=10), 'Robot-side policy node unavailable'
                    future = client.call_async(SetParameters.Request(parameters=[Parameter(name='allow_control', value=ParameterValue(type=ParameterType.PARAMETER_BOOL, bool_value=allowed))]))
                    await until(future.done)
                    assert all(result.successful for result in future.result().results)
                    await until(lambda: authority.external_status()['allowControl'] == allowed)
                finally:
                    node.destroy_client(client)

            if external:
                policy_process = subprocess.Popen(['python3', str(directory / 'external_control_lock.py')], stdout=log, stderr=log)
                processes.append(policy_process)
                await until(lambda: authority.external_status()['ready'])
                assert not authority.external_status()['allowControl'], 'External policy must default to disabled'

            async def connect():
                socket = await tornado.websocket.websocket_connect('ws://127.0.0.1:19090')
                clients.append(socket)
                queue = status_queues[socket] = asyncio.Queue()
                latest = [None]
                async def consume():
                    while True:
                        raw = await socket.read_message()
                        if raw is None:
                            latest[0] = None
                            queue.put_nowait(None)
                            return
                        message = json.loads(raw)
                        if message.get('topic') == STATUS_TOPIC:
                            latest[0] = json.loads(message['msg']['data'])
                            queue.put_nowait(latest[0])
                async def heartbeat():
                    while True:
                        await asyncio.sleep(2)
                        if latest[0] and latest[0]['token']:
                            await send(socket, op='roboboy_control', action='heartbeat', token=latest[0]['token'])
                readers.extend([asyncio.create_task(consume()), asyncio.create_task(heartbeat())])
                value = await status(socket)
                return socket, value['selfId']

            a, aid = await connect()
            b, bid = await connect()
            await asyncio.gather(*(send(socket, op='roboboy_control', action='acquire') for socket in (a, b)))
            if external:
                await asyncio.sleep(.2)
                assert not authority.control_requests, 'Closed switch must not queue acquisitions'
                assert authority.owner is None, 'Control bypassed the robot-side gate'
                await switch(True)
                assert authority.owner is None, 'Enabling access must not automatically acquire control'
                await asyncio.gather(*(send(socket, op='roboboy_control', action='acquire') for socket in (a, b)))
            await until(lambda: authority.owner is not None)
            owner, observer = (a, b) if authority.owner == aid else (b, a)
            lease = await status(owner, lambda value: bool(value['token']))
            await send(observer, op='publish', topic='/control_smoke/command', msg={'data': 99}, controlToken=lease['token'])
            await status(observer, lambda value: bool(value['error']))
            assert commands == [], commands
            await send(owner, op='advertise', topic='/control_smoke/command', type='std_msgs/msg/Int32')
            await until(lambda: node.count_publishers('/control_smoke/command') > 0)
            await asyncio.sleep(.2)  # Allow DDS endpoint matching before a one-shot publish.
            await send(owner, op='publish', topic='/control_smoke/command', msg={'data': 1}, controlToken=lease['token'])
            await until(lambda: commands == [1])
            await send(owner, op='send_action_goal', id='smoke-goal', action='/control_smoke/move',
                       action_type='control_msgs/action/FollowJointTrajectory', args={}, controlToken=lease['token'])
            await until(lambda: bool(authority.pending))
            owner.close()
            await until(lambda: authority.draining)
            await until(lambda: authority.owner is None)
            assert cancelled, 'Browser-owned action was not cancelled'

            await send(observer, op='roboboy_control', action='acquire')
            lease = await status(observer, lambda value: bool(value['token']))
            await send(observer, op='call_service', id='smoke-service', service='/control_smoke/reset',
                       type='std_srvs/srv/Trigger', args={}, controlToken=lease['token'])
            await until(lambda: bool(authority.pending))
            await until(lambda: not authority.pending)

            tree = dict(id='smoke-tree', name='Smoke', edges=[], nodes=[dict(id='move', type='action',
                        data=dict(actionName='/control_smoke/move', actionType='control_msgs/action/FollowJointTrajectory', timeout=10000, parameters={}))])
            await send(observer, op='advertise', topic=BT_COMMAND, type='std_msgs/msg/String')
            await send(observer, op='publish', topic=BT_COMMAND, controlToken=lease['token'],
                       msg=dict(data=json.dumps(dict(protocolVersion=1, command='start', sessionId='smoke-' + str(uuid.uuid4()), tree=tree))))
            await until(lambda: authority.runner_busy)
            observer.close()
            await until(authority.adoptable)
            assert len(cancelled) == 1, 'Persistent action was unexpectedly cancelled'
            c, cid = await connect()
            await send(c, op='roboboy_control', action='adopt')
            lease = await status(c, lambda value: bool(value['token']))
            assert lease['managing'] and lease['owner'] == cid
            await send(c, op='publish', topic='/control_smoke/command', msg={'data': 2}, controlToken=lease['token'])
            await status(c, lambda value: bool(value['error']))
            assert commands == [1], commands
            await send(c, op='advertise', topic=BT_COMMAND, type='std_msgs/msg/String')
            await send(c, op='publish', topic=BT_COMMAND, controlToken=lease['token'],
                       msg=dict(data=json.dumps(dict(protocolVersion=1, command='stop', sessionId=authority.runner_session))))
            await until(lambda: not authority.runner_busy and not authority.managing)
            assert not authority.fault, authority.fault
            if external:
                await send(c, op='send_action_goal', id='external-stop', action='/control_smoke/move', action_type='control_msgs/action/FollowJointTrajectory', args={}, controlToken=lease['token'])
                await until(lambda: bool(authority.pending))
                before = len(cancelled)
                await switch(False)
                await until(lambda: authority.owner is None and not authority.pending)
                assert len(cancelled) > before, 'Global switch did not cancel the action'
                await switch(True)
                await send(c, op='roboboy_control', action='acquire')
                await until(lambda: authority.owner == cid)
                policy_process.terminate()
                await until(lambda: authority.token is None)
                assert not authority.external_status()['ready'], 'Dead policy retained control'
                assert not authority.fault, authority.fault
                print('External ROS policy smoke passed: default-off switch, normal acquisition, persistent adoption, action cancellation and heartbeat loss.')
            print('Real ROS smoke passed: competing clients, observer rejection, topic barrier, action cancellation, service completion, persistent adoption and stop.')
        except Exception:
            log.flush()
            log.seek(0)
            print(log.read())
            raise
        finally:
            for socket in clients:
                socket.close()
            for reader in readers:
                reader.cancel()
            await asyncio.gather(*readers, return_exceptions=True)
            if timer:
                timer.stop()
            if monitor:
                monitor.cancel()
                try:
                    await monitor
                except asyncio.CancelledError:
                    pass
            if server:
                server.stop()
            for process in processes:
                process.terminate()
            for process in processes:
                try:
                    process.wait(5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            executor.shutdown()
            action_server.destroy()
            node.destroy_node()
            rclpy.shutdown()
            log.close()


if __name__ == '__main__':
    asyncio.run(smoke())
