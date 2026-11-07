"""Run inside the ROS image on an isolated ROS domain: demand, CBOR/gateway, stamps, and unsubscribe."""
import asyncio
import json
import math
import os
import signal
import struct
import subprocess
import threading
import time

import cbor2
import rclpy
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import PointCloud2, PointField
from tornado.websocket import websocket_connect


async def main():
    rclpy.init()
    node = rclpy.create_node('cloudini_fixture')
    publisher = node.create_publisher(PointCloud2, '/fixture/points', qos_profile_sensor_data)
    message = PointCloud2()
    message.header.frame_id = 'laser'
    message.header.stamp.sec, message.header.stamp.nanosec = 123, 456789
    message.width, message.height, message.point_step, message.row_step = 6000, 1, 12, 72000
    message.fields = [PointField(name=name, offset=i * 4, datatype=7, count=1) for i, name in enumerate('xyz')]
    message.is_dense = True
    message.data = b''.join(struct.pack('<fff', i / 1000, math.sin(i / 100), math.cos(i / 100)) for i in range(6000))
    publishing = True
    node.create_timer(0.1, lambda: publisher.publish(message) if publishing else None)
    thread = threading.Thread(target=lambda: rclpy.spin(node), daemon=True)
    thread.start()
    processes = []
    socket = None
    late = None
    try:
        commands = [
            ['/opt/roboboy-cloudini/bin/pointcloud-relay'],
            ['ros2', 'launch', '/ros_ws/rosbridge_launch.xml', 'port:=19092', 'address:=127.0.0.1', 'respawn:=false'],
            ['python3', '/ros_ws/control_gateway.py', '--port', '19090', '--upstream-port', '19092'],
        ]
        for command in commands:
            processes.append(subprocess.Popen(command, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        for _ in range(100):
            if '/roboboy/cloudini/fixture/points' in dict(node.get_topic_names_and_types()):
                break
            await asyncio.sleep(0.1)
        else:
            raise AssertionError('Derived topic was not discovered')
        assert publisher.get_subscription_count() == 0, 'Relay must not consume unused clouds'
        for _ in range(100):
            try:
                socket = await websocket_connect('ws://127.0.0.1:19090', connect_timeout=1)
                break
            except OSError:
                await asyncio.sleep(0.1)
        assert socket
        await socket.write_message(json.dumps(dict(op='subscribe', topic='/roboboy/cloudini/fixture/points',
            type='point_cloud_interfaces/msg/CompressedPointCloud2', compression='cbor', queue_length=1)))
        await socket.write_message(json.dumps(dict(op='call_service', id='probe', service='/rosapi/topics', args={})))
        cloud, probe = None, False
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline and (cloud is None or not probe):
            raw = await asyncio.wait_for(socket.read_message(), 5)
            assert raw is not None, 'Gateway disconnected'
            data = cbor2.loads(raw) if isinstance(raw, bytes) else json.loads(raw)
            if data.get('op') == 'service_response' and data.get('id') == 'probe':
                assert data.get('result') is True
                probe = True
            if data.get('op') == 'publish' and data.get('topic') == '/roboboy/cloudini/fixture/points':
                cloud = data['msg']
        assert cloud and probe
        if isinstance(cloud['compressed_data'], cbor2.CBORTag):
            cloud['compressed_data'] = cloud['compressed_data'].value
        assert cloud['format'] == 'cloudini'
        assert cloud['header']['frame_id'] == 'laser'
        assert cloud['header']['stamp'] == dict(sec=123, nanosec=456789)
        assert cloud['width'] == 6000 and cloud['height'] == 1 and cloud['point_step'] == 12
        assert 0 < len(cloud['compressed_data']) < len(message.data) / 2
        assert publisher.get_subscription_count() == 1
        # A second viewer must receive a retained static cloud without another raw publish.
        publishing = False
        await asyncio.sleep(0.3)
        late = await websocket_connect('ws://127.0.0.1:19090', connect_timeout=2)
        await late.write_message(json.dumps(dict(op='subscribe', topic='/roboboy/cloudini/fixture/points',
            type='point_cloud_interfaces/msg/CompressedPointCloud2', compression='cbor', queue_length=1)))
        while True:
            raw = await asyncio.wait_for(late.read_message(), 5)
            assert raw is not None
            data = cbor2.loads(raw) if isinstance(raw, bytes) else json.loads(raw)
            if data.get('op') == 'publish' and data.get('topic') == '/roboboy/cloudini/fixture/points':
                assert data['msg']['header'] == cloud['header']
                break
        late.close()
        late = None
        socket.close()
        socket = None
        for _ in range(100):
            if not publisher.get_subscription_count():
                break
            await asyncio.sleep(0.1)
        assert publisher.get_subscription_count() == 0, 'Raw subscription survived last viewer'
        print(json.dumps(dict(points=6000, raw_bytes=len(message.data), compressed_bytes=len(cloud['compressed_data']),
                              gateway_cbor=True, rosapi_probe=True, demand_and_cleanup=True, late_viewer_cached=True)))
    finally:
        if socket:
            socket.close()
        if late:
            late.close()
        for process in processes:
            os.killpg(process.pid, signal.SIGTERM)
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
        node.executor.shutdown(timeout_sec=2)
        thread.join(timeout=2)
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    asyncio.run(main())
