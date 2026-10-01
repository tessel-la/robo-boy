"""Supervise real framework workers; no tree control flow is implemented here."""
from __future__ import annotations

import json
import os
import select
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from .xml_safety import validate_upload


class Worker:
    def __init__(self, command: list[str]):
        # Separate stderr from the protocol and bound how much is retained.
        self.stderr = tempfile.TemporaryFile(mode='w+b')
        try:
            self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                            stderr=self.stderr, bufsize=0)
        except Exception:
            self.stderr.close()
            raise
        self.buffer = b''
        self.output_offset = 0
        self.closed = False

    def call(self, command: str, **fields) -> dict:
        if self.process.poll() is not None:
            raise RuntimeError('Native worker exited: ' + self.diagnostics())
        payload = json.dumps({'command': command, **fields}).encode() + b'\n'
        self.process.stdin.write(payload)
        self.process.stdin.flush()
        import time
        deadline = time.monotonic() + 10
        while b'\n' not in self.buffer:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.process.stdout], [], [], remaining)[0]:
                self.close()
                raise RuntimeError('Native worker timed out (a node may be blocking)')
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError('Native worker closed protocol: ' + self.diagnostics())
            self.buffer += chunk
            if len(self.buffer) > 4 * 1024 * 1024:
                self.close()
                raise RuntimeError('Native worker response exceeds limit')
        line, self.buffer = self.buffer.split(b'\n', 1)
        response = json.loads(line)
        if not response.get('ok'):
            raise ValueError(response.get('error', 'Native worker failed'))
        size = os.fstat(self.stderr.fileno()).st_size
        if size > 8 * 1024 * 1024:
            self.close()
            raise RuntimeError('Native worker exceeded output limit')
        if size > self.output_offset:
            response['output'] = os.pread(self.stderr.fileno(), min(size - self.output_offset, 4096), self.output_offset).decode(errors='replace')
            self.output_offset = size
        return response

    def diagnostics(self):
        if self.closed:
            return 'Worker closed'
        size = os.fstat(self.stderr.fileno()).st_size
        return os.pread(self.stderr.fileno(), 4096, max(0, size - 4096)).decode(errors='replace')

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2)
        self.process.stdin.close()
        self.process.stdout.close()
        self.stderr.close()


class RuntimeAdapter:
    id: str
    label: str

    def command(self) -> list[str]:
        raise NotImplementedError

    def open(self, xml: str, main_tree_id: str | None = None):
        main = validate_upload(xml, main_tree_id)
        marker = ET.fromstring(xml).get('BTCPP_format')
        if self.id == 'btcpp' and marker != '4':
            raise ValueError('BehaviorTree.CPP requires BTCPP_format=4')
        if self.id == 'py_trees' and marker is not None:
            raise ValueError('BehaviorTree.CPP XML cannot be loaded as py_trees')
        worker = Worker(self.command())
        try:
            response = worker.call('load', xml=xml, mainTreeId=main)
            response['mainTreeId'] = main
            return worker, response
        except Exception:
            worker.close()
            raise

    def discover(self):
        worker = None
        descriptor = {'id': self.id, 'label': self.label, 'available': False,
                      'capabilities': {'xml': True, 'selfContainedOnly': True, 'cancel': True,
                                       'reset': True, 'feedback': True, 'nativeNodes': True}}
        try:
            worker = Worker(self.command())
            descriptor.update(worker.call('discover'))
            descriptor.pop('ok', None)
            descriptor['available'] = True
        except Exception as exc:
            descriptor['reason'] = str(exc)
        finally:
            if worker:
                worker.close()
        return descriptor


class BehaviorTreeCppAdapter(RuntimeAdapter):
    id = 'btcpp'
    label = 'BehaviorTree.CPP'

    def command(self):
        return [os.environ.get('ROBOBOY_BTCPP_WORKER', '/usr/local/bin/robo-boy-btcpp')]


class PyTreesAdapter(RuntimeAdapter):
    id = 'py_trees'
    label = 'py_trees'

    def command(self):
        return [sys.executable, str(Path(__file__).with_name('py_worker.py'))]
