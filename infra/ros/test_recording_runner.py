"""Tests for the recorder's listing and read-only file service. They need no ROS installation:

    python3 -m unittest discover -s infra/ros
"""
import http.client
import json
import os
import socket
import tempfile
import unittest
from pathlib import Path

from recording_runner import HttpError, list_directory, parse_range, serve_recordings

METADATA = 'rosbag2_bagfile_information:\n  duration:\n    nanoseconds: 12500000000\n  message_count: 340\n'


class RecordingRootTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        (self.root / 'field' / 'run_1').mkdir(parents=True)
        (self.root / 'field' / 'run_1' / 'metadata.yaml').write_text(METADATA)
        (self.root / 'field' / 'run_1' / 'run_1_0.mcap').write_bytes(bytes(range(256)) * 4)
        (self.root / 'field' / 'run_1' / 'run_1_1.mcap').write_bytes(b'split')
        (self.root / 'field' / 'run_1' / 'notes.txt').write_text('not a recording')
        (self.root / 'live').mkdir()
        (self.root / 'live' / 'live_0.mcap').write_bytes(b'growing')
        (self.root / 'loose.mcap').write_bytes(b'copied by hand')
        (self.root / '.hidden').mkdir()
        self.outside = tempfile.TemporaryDirectory()
        (Path(self.outside.name) / 'secret.mcap').write_bytes(b'secret')
        os.symlink(Path(self.outside.name) / 'secret.mcap', self.root / 'escape.mcap')
        self.active = None

    def tearDown(self):
        self.temp.cleanup()
        self.outside.cleanup()


class ListingTest(RecordingRootTest):
    def test_lists_folders_bags_and_loose_files(self):
        listing = list_directory(self.root, '', self.root / 'live')
        self.assertEqual(listing['directory'], '.')
        self.assertEqual(listing['folders'], ['field'])
        self.assertEqual([f['name'] for f in listing['files']], ['loose.mcap'])  # The escaping symlink is left out.
        self.assertEqual(listing['recordings'], [{'name': 'live', 'path': 'live', 'active': True,
                                                  'files': [dict(listing['recordings'][0]['files'][0], name='live_0.mcap', path='live/live_0.mcap', size=7)]}])

    def test_describes_a_finished_bag_and_every_split_file(self):
        bag = list_directory(self.root, 'field')['recordings'][0]
        self.assertEqual((bag['name'], bag['path'], bag['active'], bag['duration'], bag['messages']), ('run_1', 'field/run_1', False, 12.5, 340))
        self.assertEqual([(f['name'], f['path'], f['size']) for f in bag['files']],
                         [('run_1_0.mcap', 'field/run_1/run_1_0.mcap', 1024), ('run_1_1.mcap', 'field/run_1/run_1_1.mcap', 5)])

    def test_refuses_paths_outside_the_root(self):
        for path in ('..', '../..', 'field/../..', 'loose.mcap'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                list_directory(self.root, path)


class RangeTest(unittest.TestCase):
    def test_parses_single_ranges(self):
        self.assertEqual(parse_range('bytes=0-9', 100), (0, 9))
        self.assertEqual(parse_range('bytes=90-', 100), (90, 99))
        self.assertEqual(parse_range('bytes=-10', 100), (90, 99))
        self.assertEqual(parse_range('bytes=95-500', 100), (95, 99))

    def test_answers_unsupported_ranges_with_the_whole_file(self):
        for header in (None, '', 'bytes=0-1,5-6', 'items=0-1', 'bytes=-'):
            self.assertIsNone(parse_range(header, 100))

    def test_rejects_unsatisfiable_ranges(self):
        for header in ('bytes=100-', 'bytes=50-10', 'bytes=-0'):
            with self.subTest(header=header), self.assertRaises(HttpError) as raised:
                parse_range(header, 100)
            self.assertEqual(raised.exception.status, 416)


class FileServiceTest(RecordingRootTest):
    def setUp(self):
        super().setUp()
        self.server = serve_recordings(self.root, lambda: self.active, ('127.0.0.1', 0))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        super().tearDown()

    def request(self, method, path, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=5)
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        body = response.read()
        connection.close()
        return response, body

    def test_lists_a_directory(self):
        self.active = str(self.root / 'live')
        response, body = self.request('GET', '/list?path=field')
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader('Access-Control-Allow-Origin'), '*')
        listing = json.loads(body)
        self.assertEqual((listing['version'], listing['directory'], listing['recordings'][0]['name']), (1, 'field', 'run_1'))

    def test_serves_a_whole_file_and_byte_ranges(self):
        response, body = self.request('GET', '/files/field/run_1/run_1_0.mcap')
        self.assertEqual((response.status, len(body), response.getheader('Accept-Ranges')), (200, 1024, 'bytes'))
        self.assertIn("filename*=UTF-8''run_1_0.mcap", response.getheader('Content-Disposition'))
        etag = response.getheader('ETag')

        response, body = self.request('GET', '/files/field/run_1/run_1_0.mcap', {'Range': 'bytes=256-259'})
        self.assertEqual((response.status, body, response.getheader('Content-Range')), (206, bytes([0, 1, 2, 3]), 'bytes 256-259/1024'))
        self.assertEqual(response.getheader('ETag'), etag)

        response, body = self.request('GET', '/files/field/run_1/run_1_0.mcap', {'Range': 'bytes=-2'})
        self.assertEqual((response.status, body), (206, bytes([254, 255])))

    def test_head_describes_the_file_without_a_body(self):
        response, body = self.request('HEAD', '/files/field/run_1/run_1_0.mcap')
        self.assertEqual((response.status, response.getheader('Content-Length'), body), (200, '1024', b''))

    def test_a_changed_file_is_sent_whole_instead_of_as_a_stale_range(self):
        response, body = self.request('GET', '/files/field/run_1/run_1_0.mcap', {'Range': 'bytes=0-3', 'If-Range': '"stale"'})
        self.assertEqual((response.status, len(body)), (200, 1024))

    def test_rejects_ranges_past_the_end(self):
        response, body = self.request('GET', '/files/field/run_1/run_1_0.mcap', {'Range': 'bytes=2000-'})
        self.assertEqual(response.status, 416)
        self.assertIn('outside the file', json.loads(body)['error'])

    def test_answers_cors_preflight_for_range_reads(self):
        response, _ = self.request('OPTIONS', '/files/field/run_1/run_1_0.mcap', {'Origin': 'app://robo-boy', 'Access-Control-Request-Headers': 'range'})
        self.assertEqual(response.status, 204)
        self.assertIn('Range', response.getheader('Access-Control-Allow-Headers'))
        self.assertIn('Content-Range', response.getheader('Access-Control-Expose-Headers'))

    def test_serves_only_finished_mcap_files_inside_the_root(self):
        self.active = str(self.root / 'live')
        for path, status in [('/files/field/run_1/notes.txt', 404), ('/files/field/run_1/metadata.yaml', 404),
                             ('/files/missing.mcap', 404), ('/files/escape.mcap', 400), ('/files/../outside.mcap', 400),
                             ('/files/%2e%2e/%2e%2e/etc/passwd', 400), ('/files/live/live_0.mcap', 409), ('/elsewhere', 404)]:
            with self.subTest(path=path):
                response, body = self.request('GET', path)
                self.assertEqual(response.status, status)
                self.assertIn('error', json.loads(body))


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__('localhost', timeout=5)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(self.path)


class UnixSocketTest(RecordingRootTest):
    """How the proxy reaches the service: a socket in a shared volume, so no port is opened on the host."""
    def test_serves_listings_and_ranges_over_a_socket_replacing_a_stale_one(self):
        path = str(self.root / '.files.sock')
        Path(path).write_text('left by a previous run')
        server = serve_recordings(self.root, lambda: None, path)
        try:
            connection = UnixConnection(path)
            connection.request('GET', '/list?path=field')
            response = connection.getresponse()
            self.assertEqual((response.status, json.loads(response.read())['recordings'][0]['name']), (200, 'run_1'))
            connection.request('GET', '/files/field/run_1/run_1_0.mcap', headers={'Range': 'bytes=256-259'})
            response = connection.getresponse()
            self.assertEqual((response.status, response.read()), (206, bytes([0, 1, 2, 3])))
            connection.close()
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
