"""The backend reports its build and installed runtime, without requiring ROS in CI."""
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

from backend_info import backend_info


class BackendInfoTests(unittest.TestCase):
    def test_image_identity_and_installed_rosbridge(self):
        packages = types.ModuleType('ament_index_python.packages')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = root / 'backend_info.py'
            (root / 'package.json').write_text(json.dumps(dict(version='0.21.0-alpha')))
            (root / 'package.xml').write_text('<package><version>2.3.0</version></package>')
            packages.get_package_share_directory = lambda name: directory if name == 'rosbridge_server' else None
            with patch('backend_info.__file__', str(script)), patch.dict(os.environ, ROS_DISTRO='jazzy'), \
                    patch.dict('sys.modules', {'ament_index_python.packages': packages}):
                self.assertEqual(backend_info(), dict(stackVersion='0.21.0-alpha', rosDistro='jazzy', rosbridgeVersion='2.3.0'))

    def test_unavailable_metadata_does_not_prevent_startup(self):
        with patch.object(Path, 'read_text', side_effect=OSError), \
                patch.dict(os.environ, {}, clear=True), \
                patch.dict('sys.modules', {'ament_index_python.packages': None}):
            self.assertEqual(backend_info(), dict(stackVersion=None, rosDistro=None, rosbridgeVersion=None))

    def test_missing_package_in_an_installed_layout_is_unknown(self):
        with patch('backend_info.__file__', '/ros_ws/backend_info.py'), \
                patch.object(Path, 'is_file', return_value=False), \
                patch.object(Path, 'read_text', side_effect=FileNotFoundError):
            self.assertIsNone(backend_info()['stackVersion'])

    def test_checkout_uses_release_please_version(self):
        expected = json.loads((Path(__file__).resolve().parents[2] / 'package.json').read_text())['version']
        self.assertEqual(backend_info()['stackVersion'], expected)

    def test_malformed_metadata_does_not_prevent_startup(self):
        packages = types.ModuleType('ament_index_python.packages')
        packages.get_package_share_directory = lambda name: '/not-a-package'
        with patch.object(Path, 'read_text', return_value='invalid metadata'), \
                patch.dict('sys.modules', {'ament_index_python.packages': packages}):
            info = backend_info()
            self.assertIsNone(info['stackVersion'])
            self.assertIsNone(info['rosbridgeVersion'])
