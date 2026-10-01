"""Observe existing Groot2 publishers; never tick trees or install debugger hooks."""
import os
import struct
import threading
import time
import uuid

from .observations import groot_graph, groot_status, observation


class GrootMonitor:
    def __init__(self, receive, enabled):
        self.receive, self.enabled = receive, enabled
        endpoints = os.environ.get('ROBOBOY_BTCPP_MONITOR_ENDPOINTS', 'tcp://127.0.0.1:1667,tcp://127.0.0.1:1669')
        self.endpoints = list(dict.fromkeys(filter(None, (item.strip() for item in endpoints.split(',')))))
        if len(self.endpoints) > 8 or any(not item.startswith('tcp://') or len(item) > 256 for item in self.endpoints):
            raise ValueError('Configure at most 8 tcp:// Groot2 monitoring endpoints')
        self.stopping = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self):
        try:
            import zmq
        except ImportError:
            return  # Execution can still operate; installation docs require pyzmq for monitoring.
        context = zmq.Context()
        sources = {}
        def request(socket, kind):
            header = struct.pack('<BBI', 2, ord(kind), uuid.uuid4().int & 0xffffffff)
            socket.send_multipart([header])
            reply = socket.recv()
            if len(reply) != 22 or reply[:6] != header or not socket.getsockopt(zmq.RCVMORE):
                raise ValueError('Invalid Groot2 reply header')
            payload = socket.recv()
            if socket.getsockopt(zmq.RCVMORE) or len(payload) > 512 * 1024:
                raise ValueError('Invalid Groot2 reply payload')
            return reply[6:].hex(), payload
        try:
            while not self.stopping.is_set():
                for endpoint in self.endpoints:
                    if self.stopping.is_set(): break
                    source = sources.setdefault(endpoint, dict(socket=None, record=None, retry=0))
                    if not self.enabled('btcpp'):
                        if source['record'] and source['record']['connected']:
                            source['record'].update(connected=False, error='Engine monitoring is disabled')
                            self.receive(source['record'].copy())
                        continue
                    if source['socket'] is None and time.monotonic() < source['retry']: continue
                    try:
                        if source['socket'] is None:
                            socket = context.socket(zmq.REQ)
                            socket.setsockopt(zmq.LINGER, 0)
                            socket.setsockopt(zmq.RCVTIMEO, 150)
                            socket.setsockopt(zmq.SNDTIMEO, 150)
                            socket.setsockopt(zmq.MAXMSGSIZE, 512 * 1024)
                            socket.connect(endpoint)
                            source['socket'] = socket
                            tree_id, xml = request(socket, 'T')
                            name, nodes = groot_graph(xml.decode('utf-8'))
                            source.update(tree_id=tree_id, xml=xml.decode('utf-8'), name=name, nodes=nodes)
                        tree_id, payload = request(source['socket'], 'S')
                        if tree_id != source['tree_id']:
                            raise ValueError('Groot2 tree changed; rediscovering its definition')
                        nodes = groot_status(source['nodes'], payload)
                        record = observation('btcpp', 'btcpp:' + endpoint + ':' + tree_id, source['name'], endpoint, nodes, source['xml'])
                        source['record'] = record
                        self.receive(record)
                    except Exception as exc:
                        if source['socket'] is not None:
                            source['socket'].close()
                            source['socket'] = None
                        source['retry'] = time.monotonic() + 1
                        if source['record'] and source['record']['connected']:
                            source['record'].update(connected=False, error='Groot2 telemetry unavailable: ' + str(exc))
                            self.receive(source['record'].copy())
                self.stopping.wait(.1)
        finally:
            for source in sources.values():
                if source['socket'] is not None: source['socket'].close()
            context.term()

    def close(self):
        self.stopping.set()
        self.thread.join(timeout=5)
