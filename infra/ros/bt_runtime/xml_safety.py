"""Upload boundary, not a replacement for either framework's native parser."""
import xml.etree.ElementTree as ET

MAX_XML_BYTES = 512 * 1024
MAX_NODES = 2048


def validate_upload(xml: str, main_tree_id: str | None = None) -> str:
    if not isinstance(xml, str) or len(xml.encode('utf-8')) > MAX_XML_BYTES:
        raise ValueError('XML must be a string of at most 512 KiB')
    if '<!DOCTYPE' in xml.upper() or '<!ENTITY' in xml.upper():
        raise ValueError('DTD and entity declarations are not supported')
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise ValueError(f'Invalid XML: {exc}') from exc
    if root.tag != 'root':
        raise ValueError('Expected a <root> document')
    elements = list(root.iter())
    if len(elements) > MAX_NODES:
        raise ValueError('Tree exceeds 2048 XML elements')
    for element in elements:
        if element.tag.lower() in ('include', 'import'):
            raise ValueError('Remote XML must be self-contained; inline includes/imports')
    trees = {}
    for tree in root.findall('BehaviorTree'):
        tree_id = tree.get('ID')
        if not tree_id or tree_id in trees or len(tree) != 1:
            raise ValueError('BehaviorTree needs a unique ID and exactly one root node')
        trees[tree_id] = tree
    selected = main_tree_id or root.get('main_tree_to_execute') or (next(iter(trees)) if len(trees) == 1 else None)
    if not selected or selected not in trees:
        raise ValueError('Select a valid main_tree_to_execute')
    # Bound expanded subtrees and catch cycles before native recursive parsing.
    count = 0

    def walk(element, stack, depth):
        nonlocal count
        count += 1
        if count > MAX_NODES or depth > 64:
            raise ValueError('Expanded tree exceeds node/depth limits')
        if element.tag.lower() in ('subtree', 'subtreeplus'):
            ref = element.get('ID')
            if ref not in trees or ref in stack:
                raise ValueError('Missing or recursive subtree: ' + str(ref))
            walk(trees[ref][0], stack + [ref], depth + 1)
        for child in element:
            walk(child, stack, depth + 1)

    for tree_id, tree in trees.items():
        walk(tree[0], [tree_id], 0)
    return selected
