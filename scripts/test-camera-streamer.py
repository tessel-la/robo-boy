"""Isolated ROS/image/HTTP boundary check; run inside the video-build image with --network none."""
import json
import struct
import subprocess
import threading
import time
import urllib.request

import rclpy
from sensor_msgs.msg import Image


def main():
    rclpy.init()
    node = rclpy.create_node('camera_metadata_fixture')
    publisher = node.create_publisher(Image, '/camera_fixture/image_raw', 1)
    image = Image()
    image.header.frame_id = 'camera_optical'
    image.header.stamp.sec = 12345
    image.header.stamp.nanosec = 678901234
    image.width, image.height = 64, 48
    image.encoding, image.step = 'rgb8', 192
    image.data = bytes([20, 40, 80]) * (64 * 48)
    node.create_timer(0.05, lambda: publisher.publish(image))
    def spin():
        try:
            rclpy.spin(node)
        except rclpy.executors.ExternalShutdownException:
            pass
    thread = threading.Thread(target=spin, daemon=True)
    thread.start()
    server = subprocess.Popen(['ros2', 'run', 'web_video_server', 'web_video_server', '--ros-args',
                               '-p', 'address:=127.0.0.1', '-p', 'port:=18080'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        # The HTTP listener can start before DDS discovers this publisher. Upstream
        # closes streams opened for topics absent from its graph at subscription time.
        for _ in range(50):
            try:
                with urllib.request.urlopen('http://127.0.0.1:18080/', timeout=3) as listing:
                    if b'/camera_fixture/image_raw' in listing.read():
                        break
            except OSError:
                pass
            time.sleep(0.1)
        else:
            raise AssertionError('streamer did not discover the image publisher')

        def read_jpeg(accept=None):
            request = urllib.request.Request(
                'http://127.0.0.1:18080/stream?topic=/camera_fixture/image_raw&type=mjpeg&width=32&height=24',
                headers={'Accept': accept} if accept else {})
            with urllib.request.urlopen(request, timeout=3) as response:
                expected = 'multipart/mixed' if accept == 'multipart/mixed' else 'multipart/x-mixed-replace'
                assert response.headers.get_content_type() == expected
                assert response.headers['Vary'] == 'Accept'
                assert response.headers['Access-Control-Allow-Origin'] == '*'
                length = None
                for _ in range(15):
                    line = response.readline(2048).decode('ascii').strip()
                    if line.lower().startswith('content-length:'):
                        length = int(line.split(':', 1)[1])
                    if length and not line:
                        break
                assert length and length < 1000000
                return response.read(length)
        native = read_jpeg()
        jpeg = read_jpeg('multipart/mixed')
        assert jpeg == native, 'content negotiation must preserve JPEG bytes and metadata'
        assert read_jpeg('image/*') == native, 'native image Accept must retain the original MIME type'
        assert jpeg[:4] == bytes([255, 216, 255, 239])
        size = struct.unpack_from('>H', jpeg, 4)[0]
        assert jpeg[6:14] == b'RBROS001'
        sec, nanosec, width, height = struct.unpack_from('>IIII', jpeg, 14)
        frame = jpeg[30:4 + size].decode('utf-8')
        assert (sec, nanosec, width, height, frame) == (12345, 678901234, 64, 48, 'camera_optical')
        offset = 2
        dimensions = None
        while offset + 4 < len(jpeg):
            assert jpeg[offset] == 255
            marker = jpeg[offset + 1]
            segment = struct.unpack_from('>H', jpeg, offset + 2)[0]
            if marker in (192, 193, 194):
                height, width = struct.unpack_from('>HH', jpeg, offset + 5)
                dimensions = (width, height)
                break
            offset += 2 + segment
        assert dimensions == (32, 24)
        print(json.dumps({'ros_stamp': [sec, nanosec], 'frame_id': frame,
                          'source_size': [64, 48], 'encoded_size': dimensions, 'jpeg_bytes': len(jpeg)}))
    finally:
        import os
        import signal
        os.killpg(server.pid, signal.SIGTERM)
        server.wait(timeout=5)
        rclpy.shutdown()
        thread.join(timeout=2)


if __name__ == '__main__':
    main()
