import { decodeWorkspaceDocument } from '../workspace/portableDocument';
import { decodePad } from '../customGamepad/portablePad';
import { decodeTree } from '../behaviorTree/portableTree';
import { parseContentJson, record, text, collection } from './json';
import { readContentPackage, type ContentPackage, type ContentDocument, type ContentKind } from './packages';

export interface LibraryPackage extends ContentPackage {
  description?: string;
  author?: string;
  license?: string;
  tags?: string[];
  compatibility?: { roboboy: string };
}
export const cloneContent = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function validateLibraryPackage(value: unknown): LibraryPackage {
  const envelope = readContentPackage(value);
  if (!envelope) throw new Error('Expected a Robo-Boy content package.');
  const pack = cloneContent(envelope) as LibraryPackage;
  for (const field of ['description', 'author', 'license'] as const)
    if (pack[field] !== undefined && typeof pack[field] !== 'string') throw new Error(`Invalid package ${field}.`);
  if (
    pack.tags !== undefined &&
    (!Array.isArray(pack.tags) ||
      pack.tags.length > 30 ||
      pack.tags.some(tag => typeof tag !== 'string' || tag.length > 100))
  )
    throw new Error('Invalid package tags.');
  const documents = new Map(pack.documents.map(doc => [doc.id, doc]));
  for (const doc of pack.documents) {
    if (doc.kind === 'pad') doc.data = decodePad(doc.data);
    if (doc.kind === 'behaviorTree') doc.data = decodeTree(doc.data);
    if (doc.kind === 'workspace') {
      const normalized = decodeWorkspaceDocument(doc.data);
      doc.data = {
        ...normalized,
        panels: normalized.panels.map(panel => {
          if (panel.type === 'pad' && panel.layoutId && documents.get(panel.layoutId)?.kind !== 'pad')
            throw new Error(`Missing packaged Pad: ${panel.layoutId}.`);
          if (panel.type === 'behaviorTree' && panel.treeId && documents.get(panel.treeId)?.kind !== 'behaviorTree')
            throw new Error(`Missing packaged Behavior Tree: ${panel.treeId}.`);
          return panel;
        }),
      };
    }
  }
  return pack;
}
/** Current file exports are explicit legacy readers; publication metadata is supplied by the catalog. */
export function readLibraryPackage(source: string, name = 'Imported collection'): LibraryPackage {
  const parsed = parseContentJson(source);
  const value = Array.isArray(parsed) ? { layouts: parsed } : parsed;
  if (readContentPackage(value)) return validateLibraryPackage(value);
  const raw = record(value, 'Content file');
  let documents: ContentDocument[] = [];
  if (raw.tree) {
    if (raw.version !== undefined && raw.version !== '1.0.0') throw new Error('Unsupported Behavior Tree version.');
    const tree = decodeTree(raw.tree);
    documents = [{ id: `bt/${tree.id}`, kind: 'behaviorTree', formatVersion: 1, data: tree }];
    name = tree.name;
  } else if (
    Array.isArray(raw.layouts) &&
    !raw.currentWorkspace &&
    (raw.layouts[0]?.components || typeof raw.version === 'string')
  ) {
    if (raw.version !== undefined && raw.version !== '1.0.0') throw new Error('Unsupported Pad version.');
    documents = collection(raw.layouts, 'Pads', 100).map(value => {
      const pad = decodePad(value);
      return { id: `pad/${pad.id}`, kind: 'pad' as const, formatVersion: 1 as const, data: pad };
    });
  } else if (Array.isArray(raw.layouts) || raw.currentWorkspace) {
    if (raw.version !== undefined && ![1, 2].includes(raw.version)) throw new Error('Unsupported workspace version.');
    const pads = collection(raw.gamepads ?? [], 'Pads', 100).map(decodePad);
    documents = pads.map(pad => ({ id: `pad/${pad.id}`, kind: 'pad', formatVersion: 1, data: pad }));
    const layouts = [
      ...(raw.currentWorkspace ? [{ ...raw.currentWorkspace, id: 'current', title: name }] : []),
      ...collection(raw.layouts ?? [], 'Layouts', 100),
    ];
    for (const value of layouts) {
      const layout = record(value, 'Layout');
      documents.push({
        id: `workspace/${text(layout.id, 'Layout id')}`,
        kind: 'workspace',
        formatVersion: 1,
        data: {
          ...layout,
          panels: collection(layout.panels, 'Panels', 100).map(value => {
            const panel = record(value, 'Panel');
            let treeId: string | undefined;
            if (panel.initialTree) {
              treeId = `bt/${documents.filter(doc => doc.kind === 'behaviorTree').length}`;
              documents.push({
                id: treeId,
                kind: 'behaviorTree',
                formatVersion: 1,
                data: decodeTree(panel.initialTree),
              });
            }
            return {
              ...panel,
              initialTree: undefined,
              treeId,
              layoutId: panel.layoutId ? `pad/${panel.layoutId}` : undefined,
            };
          }),
        },
      });
    }
  } else throw new Error('This JSON is not a Pad, Behavior Tree or workspace file.');
  if (!documents.length) throw new Error('The file contains no documents.');
  const entry = documents.find(doc => doc.kind === 'workspace') ?? documents[0];
  return validateLibraryPackage({
    schemaVersion: 1,
    id: 'local.import',
    version: '1.0.0',
    title: name,
    entryDocument: entry.id,
    documents,
  });
}
export interface Binding {
  kind: 'topic' | 'service' | 'action' | 'frame';
  from: string;
  to: string;
}
/** Only owner-defined ROS-name/frame fields are mapped. Payloads and arbitrary text stay intact. */
function visitBindings(
  pack: LibraryPackage,
  visit: (kind: Binding['kind'], object: Record<string, any>, key: string) => void
) {
  const field = (kind: Binding['kind'], object: Record<string, any> | undefined, key: string) => {
    if (object && typeof object[key] === 'string' && object[key]) visit(kind, object, key);
  };
  const tree = (value: any) => {
    for (const node of value.nodes) {
      const data = node.data;
      field(
        node.type === 'action' ? 'action' : node.type === 'service' ? 'service' : 'topic',
        data,
        node.type === 'action' ? 'actionName' : node.type === 'service' ? 'serviceName' : 'topicName'
      );
      if (node.type === 'subtree') tree(data.tree);
    }
  };
  for (const doc of pack.documents) {
    const data = doc.data as any;
    if (doc.kind === 'behaviorTree') tree(data);
    if (doc.kind === 'pad') {
      field('topic', data.rosConfig, 'defaultTopic');
      for (const c of data.components) {
        field(
          c.action?.type === 'service' ? 'service' : c.action?.type === 'action' ? 'action' : 'topic',
          c.action,
          c.action?.type ? 'name' : 'topic'
        );
        for (const key of ['poseStampedFrameId', 'poseStampedReferenceFrameId', 'twistStampedFrameId'])
          field('frame', c.config, key);
        field('topic', c.config, 'poseStampedOdometryTopic');
        for (const op of Object.values(c.eventOperations ?? {}) as any[]) field(op.kind, op, 'name');
        for (const binding of Object.values(c.config?.physicalGamepadBindings ?? {}) as any[])
          for (const op of Object.values(binding) as any[]) field(op.kind, op, 'name');
      }
    }
    if (doc.kind === 'workspace')
      for (const panel of data.panels) {
        field('topic', panel, 'cameraTopic');
        field('frame', panel.visualization, 'fixedFrame');
        const frames = panel.visualization?.displayedTfFrames;
        if (frames) for (const key of Object.keys(frames)) field('frame', frames, key);
        for (const layer of panel.visualization?.visualizations ?? []) {
          field('topic', layer, 'topic');
          for (const key of ['frameId', 'fixedFrame', 'targetFrame', 'opticalFrame'])
            field('frame', layer.options, key);
          if (layer.type === 'cameraimage') {
            field('topic', layer.options, 'cameraInfoTopic');
            const capture = layer.options?.capture;
            field(capture?.kind === 'action' ? 'action' : 'service', capture, 'name');
            field('topic', capture, 'outputTopic');
          }
        }
      }
  }
}
export function packageBindings(pack: LibraryPackage): Binding[] {
  const bindings = new Map<string, Binding>();
  visitBindings(pack, (kind, obj, key) => bindings.set(`${kind}:${obj[key]}`, { kind, from: obj[key], to: obj[key] }));
  return [...bindings.values()];
}
export function bindPackage(pack: LibraryPackage, bindings: Binding[]): LibraryPackage {
  const copy = cloneContent(pack);
  const map = new Map(bindings.map(item => [`${item.kind}:${item.from}`, item.to.trim()]));
  for (const item of bindings)
    if (!item.to.trim() || item.to.length > 512 || /\s/.test(item.to))
      throw new Error(`Invalid ${item.kind} binding for ${item.from}.`);
  visitBindings(copy, (kind, obj, key) => {
    const next = map.get(`${kind}:${obj[key]}`);
    if (next !== undefined) obj[key] = next;
  });
  return validateLibraryPackage(copy);
}
export function documentKinds(pack: LibraryPackage): ContentKind[] {
  return [...new Set(pack.documents.map(doc => doc.kind))];
}
