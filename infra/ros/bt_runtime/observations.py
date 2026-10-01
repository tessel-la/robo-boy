"""Read-only native telemetry graphs. Never translate them into executable XML."""
import copy
import time
import uuid
import xml.etree.ElementTree as ET

MAX_NODES = 2048
MAX_BYTES = 512 * 1024
STATES = {0: ('idle', 'IDLE'), 1: ('running', 'RUNNING'), 2: ('success', 'SUCCESS'),
          3: ('failure', 'FAILURE'), 4: ('idle', 'SKIPPED')}


def validate_graph(nodes):
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= MAX_NODES:
        raise ValueError('External tree must contain 1–2048 nodes')
    by_id = {}
    for node in nodes:
        if not isinstance(node, dict) or (node.get('parentId') is not None and not isinstance(node['parentId'], str)):
            raise ValueError('Invalid external node')
        if 'parentId' not in node or ('subtree' in node and not isinstance(node['subtree'], bool)):
            raise ValueError('Invalid external node topology')
        if node.get('lastResult') not in (None, 'success', 'failure') or ('lastNativeResult' in node and not isinstance(node['lastNativeResult'], str)):
            raise ValueError('Invalid external node result')
        for field in ('id', 'label', 'type', 'nativeStatus', 'feedback'):
            if not isinstance(node.get(field), str) or len(node[field]) > 4096:
                raise ValueError('Invalid external node ' + field)
        if not node['id'] or node['id'] in by_id or node.get('status') not in ('idle', 'running', 'success', 'failure'):
            raise ValueError('Invalid external node identity/status')
        ports = node.get('ports', {})
        if not isinstance(ports, dict) or len(ports) > 128 or any(not isinstance(k, str) or len(k) > 256 or not isinstance(v, str) or len(v) > 4096 for k, v in ports.items()):
            raise ValueError('Invalid external node metadata')
        by_id[node['id']] = node
    roots = [n for n in nodes if n['parentId'] is None]
    if len(roots) != 1:
        raise ValueError('External tree needs exactly one root')
    for node in nodes:
        path, current = set(), node
        while current['parentId'] is not None:
            if current['id'] in path or len(path) > 64 or current['parentId'] not in by_id:
                raise ValueError('External tree has a cycle, missing parent or excessive depth')
            path.add(current['id'])
            current = by_id[current['parentId']]
    return roots[0]


def observation(runtime, identity, name, source, nodes, xml=None):
    root = validate_graph(nodes)
    result = root['status'] if root['status'] in ('success', 'failure') else root.get('lastResult') if root['status'] == 'idle' else None
    record = dict(id=identity, runtime=runtime, name=name, source=source, nodes=nodes,
                  state='completed' if result else 'running' if root['status'] == 'running' else 'loaded',
                  result=result, error=None, connected=True, updatedAt=int(time.time() * 1000))
    if xml is not None:
        record['xml'] = xml  # Groot2 instance XML, read-only and not a tree upload.
    return record


def groot_graph(xml):
    if not isinstance(xml, str) or len(xml.encode()) > MAX_BYTES or '<!DOCTYPE' in xml.upper() or '<!ENTITY' in xml.upper():
        raise ValueError('Invalid or excessive Groot2 XML')
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise ValueError('Malformed Groot2 XML: ' + str(exc)) from exc
    if root.tag != 'root' or root.get('BTCPP_format') != '4':
        raise ValueError('Expected BehaviorTree.CPP v4 telemetry')
    trees = root.findall('BehaviorTree')
    if not trees or len(list(root.iter())) > MAX_NODES * 4:
        raise ValueError('Invalid Groot2 tree definitions')
    definitions = {}
    for tree in trees:
        key = (tree.get('ID'), tree.get('_fullpath', ''))
        if key in definitions or len(tree) != 1:
            raise ValueError('Ambiguous Groot2 subtree instance')
        definitions[key] = tree
    nodes, visited = [], set()
    def walk(element, parent, depth):
        if depth > 64 or len(nodes) >= MAX_NODES:
            raise ValueError('External tree exceeds node/depth limits')
        uid = element.get('_uid', '')
        if not uid.isdecimal() or not 0 <= int(uid) <= 65535 or uid in visited:
            raise ValueError('Missing/duplicate Groot2 UID')
        visited.add(uid)
        subtree = element.tag in ('SubTree', 'SubTreePlus')
        nodes.append(dict(id=uid, parentId=parent, label=element.get('name') or (element.get('_fullpath') if subtree else None) or element.get('ID') or element.tag,
                          type=element.tag, status='idle', nativeStatus='IDLE', feedback='', subtree=subtree,
                          ports={k: v for k, v in element.attrib.items() if k not in ('_uid', 'name')}))
        if subtree:
            key = (element.get('ID'), element.get('_fullpath', ''))
            target = definitions.get(key)
            if target is None:
                raise ValueError('Missing Groot2 subtree instance: ' + str(key))
            walk(target[0], uid, depth + 1)
        else:
            for child in element:
                walk(child, uid, depth + 1)
    walk(trees[0][0], None, 0)
    expected = {element.get('_uid') for tree in trees for element in tree.iter() if element.get('_uid') is not None}
    if visited != expected:
        raise ValueError('Unreachable Groot2 nodes')
    validate_graph(nodes)
    return trees[0].get('ID', 'Robot tree'), nodes


def groot_status(nodes, payload):
    import struct
    if len(payload) != len(nodes) * 3:
        raise ValueError('Groot2 status graph size differs from the definition')
    statuses = {str(uid): status for uid, status in struct.iter_unpack('<HB', payload)}
    if statuses.keys() != {n['id'] for n in nodes}:
        raise ValueError('Groot2 status UIDs differ from the definition')
    updated = copy.deepcopy(nodes)
    for node in updated:
        status = statuses[node['id']]
        previous = status - 10 if status >= 10 else status
        if previous not in STATES:
            raise ValueError('Invalid Groot2 node status')
        node['status'], node['nativeStatus'] = STATES[0 if status >= 10 else status]
        if previous in (2, 3):
            node['lastResult'], node['lastNativeResult'] = STATES[previous]
    return updated


def py_ros_graph(message):
    def identity(value):
        return str(uuid.UUID(bytes=bytes(value.uuid))) if any(value.uuid) else None
    messages = {identity(item.own_id): item for item in message.behaviours}
    if None in messages or len(messages) != len(message.behaviours) or not 1 <= len(messages) <= MAX_NODES:
        raise ValueError('Invalid py_trees snapshot identities/size')
    roots = [item for item in messages.values() if identity(item.parent_id) is None]
    if len(roots) != 1:
        raise ValueError('py_trees snapshot needs one root')
    nodes, visited = [], set()
    def walk(item, parent, depth):
        id = identity(item.own_id)
        if id in visited or depth > 64 or identity(item.parent_id) != parent:
            raise ValueError('Invalid py_trees snapshot topology')
        visited.add(id)
        status = {1: ('idle', 'INVALID'), 2: ('running', 'RUNNING'), 3: ('success', 'SUCCESS'), 4: ('failure', 'FAILURE')}.get(item.status)
        if status is None:
            raise ValueError('Invalid py_trees snapshot status')
        node = dict(id=id, parentId=parent, label=item.name, type=item.class_name.rsplit('.', 1)[-1],
                    status=status[0], nativeStatus=status[1], feedback=item.message[:4096],
                    ports={'class': item.class_name, 'detail': item.additional_detail},
                    subtree=bool(item.child_ids) and item.blackbox_level in (1, 2, 3))
        if status[0] in ('success', 'failure'):
            node.update(lastResult=status[0], lastNativeResult=status[1])
        nodes.append(node)
        for child_id in item.child_ids:
            child = messages.get(identity(child_id))
            if child is None:
                raise ValueError('Missing py_trees snapshot child')
            walk(child, id, depth + 1)
    walk(roots[0], None, 0)
    if len(visited) != len(messages):
        raise ValueError('Unreachable py_trees snapshot nodes')
    validate_graph(nodes)
    return roots[0].name, nodes
