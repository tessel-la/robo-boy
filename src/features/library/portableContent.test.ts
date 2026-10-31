import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assertSafeFieldPath, parseContentJson, readContentFile, MAX_CONTENT_BYTES } from './json';
import { readContentPackage } from './packages';
import { readPads, copyPads, decodePad } from '../customGamepad/portablePad';
import { readTree, decodeTree, copyTree } from '../behaviorTree/portableTree';
import {
  planWorkspaceImport,
  commitWorkspaceImport,
  SAVED_WORKSPACE_LAYOUTS_KEY,
} from '../workspace/portableWorkspace';
import { loadGamepadLibrary } from '../customGamepad/gamepadStorage';

const pad = {
  id: 'drive',
  name: 'Drive',
  components: [
    {
      id: 'stick',
      type: 'joystick',
      position: { x: 0, y: 0, width: 2, height: 2 },
      action: { topic: '/cmd_vel', messageType: 'geometry_msgs/Twist' },
      config: { axes: ['linear.x', 'angular.z'] },
    },
  ],
};
const tree = {
  id: 'tree',
  name: 'Patrol',
  nodes: [
    {
      id: 'a',
      type: 'sequence',
      position: { x: 0, y: 0 },
      data: { label: 'Start', status: 'running', isHighlighted: true, type: 'sequence' },
    },
  ],
  edges: [],
  createdAt: 1,
  updatedAt: 2,
  blackboardDefaults: { speed: 0.2 },
  blackboardTypes: { speed: 'float64' },
};
const layout = {
  id: 'layout',
  title: 'Navigation',
  panels: [
    { id: 'camera', type: 'camera', title: 'Camera', cameraTopic: '/camera' },
    { id: 'drive-panel', type: 'pad', title: 'Pad', layoutId: 'drive' },
    { id: 'scene', type: '3d', title: '3D', visualization: { fixedFrame: 'map', visualizations: [] } },
  ],
  tileOrder: ['scene', 'drive-panel', 'camera'],
  layout: {
    version: 2,
    root: {
      type: 'split',
      axis: 'x',
      ratio: 0.6,
      first: { type: 'tile', id: 'scene' },
      second: {
        type: 'split',
        axis: 'y',
        ratio: 0.5,
        first: { type: 'tile', id: 'drive-panel' },
        second: { type: 'tile', id: 'camera' },
      },
    },
  },
};
const bundle = () => JSON.stringify({ version: 2, layouts: [layout], gamepads: [pad] });
const pack = (kind: string, data: unknown) => ({
  schemaVersion: 1,
  id: 'example',
  title: 'Example',
  version: '1.0.0',
  entryDocument: 'entry',
  documents: [{ id: 'entry', kind, formatVersion: 1, data }],
});

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());
describe('portable JSON boundary', () => {
  it('bounds bytes, nesting, numbers and prototype keys before owner codecs run', () => {
    expect(() => parseContentJson(' '.repeat(MAX_CONTENT_BYTES + 1))).toThrow('too large');
    expect(() => parseContentJson('['.repeat(66) + '0' + ']'.repeat(66))).toThrow('deeply nested');
    expect(() => parseContentJson('{"x":1e999}')).toThrow('non-finite');
    expect(() => parseContentJson('{"__proto__":{}}')).toThrow('Unsupported property');
    expect(() => parseContentJson('[' + '0,'.repeat(100001) + '0]')).toThrow('too large');
  });
  it('rejects large files before reading and honours cancellation', async () => {
    const file = new File(['ok'], 'large.json');
    Object.defineProperty(file, 'size', { value: MAX_CONTENT_BYTES + 1 });
    await expect(readContentFile(file)).rejects.toThrow('too large');
    const controller = new AbortController();
    controller.abort();
    await expect(readContentFile(new File(['{}'], 'x'), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const other = new AbortController();
    const read = readContentFile(new File(['{}'], 'x'), other.signal);
    other.abort();
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    await expect(readContentFile(new File(['{}'], 'x'))).resolves.toBe('{}');
  });
  it('validates envelope versions, identities, entry and supported constraints', () => {
    expect(readContentPackage({ layouts: [] })).toBeNull();
    expect(readContentPackage(pack('pad', pad))?.documents).toHaveLength(1);
    for (const change of [
      { schemaVersion: 2 },
      { entryDocument: 'missing' },
      { version: 'latest' },
      { compatibility: { roboboy: '<0.1.0' } },
      { documents: [{ id: 'entry', kind: 'code', formatVersion: 1, data: {} }] },
    ])
      expect(() => readContentPackage({ ...pack('pad', pad), ...change })).toThrow();
    const duplicate = pack('pad', pad);
    duplicate.documents.push(duplicate.documents[0]);
    expect(() => readContentPackage(duplicate)).toThrow('unique');
  });
});
describe('safe field paths', () => {
  it('rejects prototype traversal while preserving ordinary ROS array paths', () => {
    expect(() => assertSafeFieldPath('poses[0].position.x', 'Field')).not.toThrow();
    for (const path of ['__proto__.x', 'a.constructor.prototype.x', 'a["__proto__"].x'])
      expect(() => assertSafeFieldPath(path, 'Field')).toThrow('prototype');
    expect(() => assertSafeFieldPath(2, 'Field')).toThrow('text');
    expect(() =>
      readPads(
        JSON.stringify({
          layouts: [
            {
              ...pad,
              components: [{ ...pad.components[0], action: { ...pad.components[0].action, field: '__proto__.x' } }],
            },
          ],
        })
      )
    ).toThrow('prototype');
  });
});
describe('Pad portability', () => {
  it('reads legacy and packaged files, preserves ROS configuration and creates independent copies', () => {
    const a = readPads(JSON.stringify({ layouts: [pad] }));
    expect(readPads(JSON.stringify(pack('pad', pad)))).toEqual(a);
    expect(decodePad(a[0])).toEqual(a[0]);
    const first = copyPads(a);
    const second = copyPads(a);
    expect(first.idMap.drive).not.toBe(second.idMap.drive);
    first.pads[0].components[0].label = 'Changed';
    expect(second.pads[0].components[0].label).toBeUndefined();
    expect(first.pads[0].components[0].action).toEqual(pad.components[0].action);
  });
  it('validates controls, nested operations and complete collections', () => {
    for (const change of [
      { components: [{ ...pad.components[0], type: 'script' }] },
      { components: [{ ...pad.components[0], position: null }] },
      { components: [{ ...pad.components[0], action: { type: 'custom', handler: 'anything' } }] },
      { components: [{ ...pad.components[0], config: { autoScale: 'yes' } }] },
      {
        components: [
          {
            ...pad.components[0],
            eventOperations: {
              press: { kind: 'service', name: '/reset', messageType: 'std_srvs/Trigger', payload: [] },
            },
          },
        ],
      },
    ])
      expect(() => readPads(JSON.stringify({ layouts: [{ ...pad, ...change }] }))).toThrow();
    expect(() => readPads(JSON.stringify({ version: '2.0.0', layouts: [pad] }))).toThrow('version');
    expect(() => readPads(JSON.stringify({ layouts: [pad, pad] }))).toThrow('unique');
    expect(() => readPads(JSON.stringify({ layouts: [pad, {}] }))).toThrow();
    expect(() => readPads(JSON.stringify(pack('behaviorTree', tree)))).toThrow('Pads only');
  });
});
describe('Behavior Tree portability', () => {
  it('preserves blackboard bindings, detaches nested links and strips execution state', () => {
    const nested = {
      ...tree,
      nodes: [
        {
          id: 'sub',
          type: 'subtree',
          position: { x: 1, y: 2 },
          data: { label: 'Subtree', sourceTreeId: 'saved-local-tree', tree },
        },
      ],
    };
    const decoded = readTree(JSON.stringify({ version: '1.0.0', tree: nested }));
    const copy = copyTree(decoded);
    expect(copy.id).not.toBe(tree.id);
    expect(copy.nodes[0].data).not.toHaveProperty('sourceTreeId');
    const subtree = (copy.nodes[0].data as any).tree;
    expect(subtree.id).not.toBe(tree.id);
    expect(subtree.nodes[0].data).not.toHaveProperty('status');
    expect(subtree.nodes[0].data).not.toHaveProperty('isHighlighted');
    expect(subtree.blackboardDefaults).toEqual(tree.blackboardDefaults);
    expect(readTree(JSON.stringify(pack('behaviorTree', tree))).nodes).toEqual(decodeTree(tree).nodes);
    expect(decodeTree(decoded)).toEqual(decoded);
  });
  it('rejects cycles, dangling edges, duplicate nodes and malformed subtrees or bindings', () => {
    for (const change of [
      { edges: [{ id: 'e', source: 'a', target: 'a' }] },
      { edges: [{ id: 'e', source: 'a', target: 'missing' }] },
      { nodes: [tree.nodes[0], tree.nodes[0]] },
      { nodes: [{ ...tree.nodes[0], type: 'subtree', data: { label: 'Broken' } }] },
      {
        nodes: [
          {
            ...tree.nodes[0],
            type: 'subscriber',
            data: { label: 'Broken', topicName: '/x', messageType: 'test/X', outputBindings: {} },
          },
        ],
      },
    ])
      expect(() => decodeTree({ ...tree, ...change })).toThrow();
    expect(() => readTree(JSON.stringify({ version: '9.0.0', tree }))).toThrow('version');
  });
});
describe('workspace import plans and guarded persistence', () => {
  it('remaps layout geometry, panel identities, Pad references and scene slots together', () => {
    const first = planWorkspaceImport(bundle()),
      second = planWorkspaceImport(bundle());
    const a = first.layouts[0],
      b = second.layouts[0];
    expect(a.id).not.toBe(b.id);
    expect(a.panels.map(panel => panel.id).some(id => b.panels.some(panel => panel.id === id))).toBe(false);
    expect(a.panels.find(panel => panel.type === 'pad')?.layoutId).toBe(first.pads[0].id);
    expect(a.tileOrder[0]).toBe(first.visualizations[0].panelId);
    expect(JSON.stringify(a.layout)).not.toContain('"scene"');
    expect(localStorage.length).toBe(0);
    const saved = commitWorkspaceImport(first, 'robot-a');
    commitWorkspaceImport(second, 'robot-a');
    expect(saved[0].id).toBe(a.id);
    expect(JSON.parse(localStorage.getItem(`${SAVED_WORKSPACE_LAYOUTS_KEY}:connection:robot-a`)!)).toHaveLength(2);
    expect(localStorage.getItem(SAVED_WORKSPACE_LAYOUTS_KEY)).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(`roboboy_3d_visualization_state_${a.tileOrder[0]}:connection:robot-a`)!)
        .fixedFrame
    ).toBe('map');
  });
  it('does not write any Pads or scenes when any candidate is malformed or future-versioned', () => {
    for (const input of [
      { version: 3, layouts: [layout], gamepads: [pad] },
      { version: 2, layouts: [layout, {}], gamepads: [pad] },
      { version: 2, layouts: [{ ...layout, panels: [null] }], gamepads: [pad] },
    ])
      expect(() => planWorkspaceImport(JSON.stringify(input))).toThrow();
    expect(localStorage.length).toBe(0);
  });
  it('rejects missing packaged dependencies, strips external settings and approvals', () => {
    const value = pack('workspace', layout);
    expect(() => planWorkspaceImport(JSON.stringify(value))).toThrow('Missing packaged Pad');
    value.documents.push({ id: 'drive', kind: 'pad', formatVersion: 1, data: pad });
    expect(planWorkspaceImport(JSON.stringify(value)).pads).toHaveLength(1);
    const external = {
      id: 'ext',
      type: 'example.panel',
      title: 'External',
      panelState: { token: 'private' },
      approvedRosTopics: [{ name: '/x', messageType: 'test/X' }],
    };
    const result = planWorkspaceImport(JSON.stringify([{ ...layout, panels: [external], layout: undefined }]));
    expect(result.layouts[0].panels[0].panelState).toBeUndefined();
    expect(result.layouts[0].panels[0].approvedRosTopics).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
  });
  it('preserves existing content and rolls back a quota failure before exposing layouts', () => {
    const previous = JSON.stringify([{ ...layout, panels: [] }]);
    localStorage.setItem(SAVED_WORKSPACE_LAYOUTS_KEY, previous);
    const plan = planWorkspaceImport(bundle());
    const original = Storage.prototype.setItem;
    const set = vi.spyOn(Storage.prototype, 'setItem');
    set.mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith('roboboy_3d_')) throw new DOMException('Quota', 'QuotaExceededError');
      return original.call(this, key, value);
    });
    expect(() => commitWorkspaceImport(plan)).toThrow('Quota');
    set.mockRestore();
    expect(localStorage.getItem(SAVED_WORKSPACE_LAYOUTS_KEY)).toBe(previous);
    expect(loadGamepadLibrary().filter(item => !item.isDefault)).toHaveLength(0);
  });
  it('keeps corrupt local stores intact and appends against current storage at commit time', () => {
    const plan = planWorkspaceImport(bundle());
    localStorage.setItem(SAVED_WORKSPACE_LAYOUTS_KEY, 'broken');
    expect(() => commitWorkspaceImport(plan)).toThrow();
    expect(localStorage.getItem(SAVED_WORKSPACE_LAYOUTS_KEY)).toBe('broken');
    localStorage.setItem(SAVED_WORKSPACE_LAYOUTS_KEY, JSON.stringify([{ ...layout, id: 'added-while-reviewing' }]));
    expect(commitWorkspaceImport(plan).map(item => item.id)).toContain('added-while-reviewing');
  });
});
