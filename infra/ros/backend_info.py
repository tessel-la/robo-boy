"""Build identity and installed ROS runtime versions, read once by the gateway."""
import json
import os
from pathlib import Path
import xml.etree.ElementTree as ET


def backend_info():
    # The image carries its own package metadata; a source checkout uses the root.
    package = Path(__file__).with_name('package.json')
    if not package.is_file():
        package = Path(__file__).resolve().parent.parent.parent / 'package.json'
    try:
        version = json.loads(package.read_text()).get('version')
    except (OSError, ValueError, AttributeError):
        version = None
    try:
        from ament_index_python.packages import get_package_share_directory
        manifest = Path(get_package_share_directory('rosbridge_server')) / 'package.xml'
        bridge_version = ET.fromstring(manifest.read_text()).findtext('version')
    except (ImportError, LookupError, OSError, ET.ParseError):
        bridge_version = None
    return dict(stackVersion=version if isinstance(version, str) else None, rosDistro=os.environ.get('ROS_DISTRO'),
                rosbridgeVersion=bridge_version)
