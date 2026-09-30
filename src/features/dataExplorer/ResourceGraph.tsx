import { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from 'reactflow';
import type { ExplorerConfig, Resource } from './types';
export { isInfrastructureNode } from './model';

/** Topics flow publisher → topic → subscriber; services and actions flow client → resource → server. */
export const graphSources = (resource: Resource) =>
  resource.kind === 'topic' ? resource.providers : resource.consumers;
export const graphTargets = (resource: Resource) =>
  resource.kind === 'topic' ? resource.consumers : resource.providers;

const countLabel = (resource: Resource) => {
  const first = resource.kind === 'topic' ? resource.publishers : resource.clients;
  const second = resource.kind === 'topic' ? resource.subscribers : resource.servers;
  return first == null || second == null ? '' : ` · ${first} → ${second}`;
};

export interface GraphOptions {
  /** Topics with measured traffic in the current window; their edges are drawn solid. */
  observed?: ReadonlySet<string>;
  /** ROS nodes left out of the drawing (bridge and Robo-Boy's own nodes); counts are unchanged. */
  hideNode?: (name: string) => boolean;
}

export function makeGraph(
  resources: Resource[],
  selected: string,
  kind: ExplorerConfig['kind'],
  query: string,
  positions: ExplorerConfig['positions'],
  { observed, hideNode }: GraphOptions = {}
) {
  const focused = resources.find(resource => resource.id === selected);
  const candidates = resources.filter(
    resource =>
      resource.kind !== 'node' &&
      (kind === 'node' || resource.kind === kind) &&
      (!query || `${resource.name} ${resource.types.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  );
  const related = focused
    ? candidates.filter(
        resource =>
          resource.id === focused.id ||
          resource.providers.includes(focused.name) ||
          resource.consumers.includes(focused.name) ||
          [...focused.providers, ...focused.consumers].some(node =>
            [...resource.providers, ...resource.consumers].includes(node)
          )
      )
    : candidates;
  const visible = related.slice(0, 60);
  const nodes: Node[] = [],
    edges: Edge[] = [];
  const names = new Set(
    visible.flatMap(resource => [...resource.providers, ...resource.consumers]).filter(name => !hideNode?.(name))
  );
  // A selected node with no connections is still shown, so focusing it never draws an empty canvas.
  if (focused?.kind === 'node') names.add(focused.name);
  const nodeNames = [...names].slice(0, 120);
  const drawn = new Set(nodeNames);
  const senders = new Set(visible.flatMap(graphSources));
  nodeNames.forEach((name, index) => {
    const id = `node:${name}`;
    nodes.push({
      id,
      data: { label: name },
      className: `de-graph-node${selected === id ? ' is-selected' : ''}`,
      position: positions[id] ?? { x: senders.has(name) ? 0 : 580, y: index * 80 },
      sourcePosition: 'right' as Node['sourcePosition'],
      targetPosition: 'left' as Node['targetPosition'],
    });
  });
  visible.forEach((resource, index) => {
    nodes.push({
      id: resource.id,
      data: { label: `${resource.kind.toUpperCase()}  ${resource.name}${countLabel(resource)}` },
      className: `de-graph-resource de-graph-${resource.kind}${selected === resource.id ? ' is-selected' : ''}`,
      position: positions[resource.id] ?? { x: 290, y: index * 100 },
      sourcePosition: 'right' as Node['sourcePosition'],
      targetPosition: 'left' as Node['targetPosition'],
    });
    const traffic = observed?.has(resource.name) ? ' is-observed' : '';
    const incompatible = new Set(
      (resource.compatibility ?? []).filter(issue => issue.level === 'error').map(issue => issue.subscriber)
    );
    for (const sender of graphSources(resource))
      if (drawn.has(sender))
        edges.push({
          id: `${sender}>${resource.id}`,
          source: `node:${sender}`,
          target: resource.id,
          markerEnd: { type: MarkerType.ArrowClosed },
          className: `de-graph-edge${traffic}`,
        });
    for (const receiver of graphTargets(resource))
      if (drawn.has(receiver))
        edges.push({
          id: `${resource.id}>${receiver}`,
          source: resource.id,
          target: `node:${receiver}`,
          markerEnd: { type: MarkerType.ArrowClosed },
          className: `de-graph-edge${traffic}${incompatible.has(receiver) ? ' is-incompatible' : ''}`,
        });
  });
  return { nodes, edges, truncated: related.length > visible.length };
}

interface Props {
  resources: Resource[];
  config: ExplorerConfig;
  hideNode?: (name: string) => boolean;
  observed: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onPositions: (positions: ExplorerConfig['positions']) => void;
}
/** Saved positions are kept per layer (`topic|node:/ui`), since a node's role differs between layers. */
const layerKey = (kind: ExplorerConfig['kind'], id: string) => `${kind}|${id}`;

export default function ResourceGraph({ resources, config, observed, hideNode, onSelect, onPositions }: Props) {
  const positions = useMemo(() => {
    const prefix = `${config.kind}|`;
    return Object.fromEntries(
      Object.entries(config.positions)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, point]) => [key.slice(prefix.length), point])
    );
  }, [config.positions, config.kind]);
  const graph = useMemo(
    () => makeGraph(resources, config.selected, config.kind, config.query, positions, { observed, hideNode }),
    [resources, config.selected, config.kind, config.query, positions, observed, hideNode]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const flow = useRef<ReactFlowInstance | null>(null);
  // Positions survive topology updates within a layer. Switching layer lays nodes out again, because
  // a node's side depends on its role: a topic subscriber on the right may be a service client on the left.
  const layer = useRef(config.kind);
  useEffect(() => {
    const sameLayer = layer.current === config.kind;
    layer.current = config.kind;
    setNodes(previous =>
      graph.nodes.map(node => ({
        ...node,
        position:
          positions[node.id] ??
          (sameLayer ? previous.find(item => item.id === node.id)?.position : undefined) ??
          node.position,
      }))
    );
  }, [graph.nodes, positions, config.kind, setNodes]);
  // Refit when discovery changes which nodes exist (for example, the first snapshot arriving after
  // mount), never on rate ticks or drags, so the user's viewport is not taken away while reading.
  const membership = graph.nodes.map(node => node.id).join('\n');
  const fit = useCallback(() => {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    flow.current?.fitView({ padding: 0.2, duration: reduced ? 0 : 200 });
  }, []);
  useEffect(() => {
    // React Flow measures new nodes after they render; fitting earlier ignores them.
    const timer = setTimeout(fit, 80);
    return () => clearTimeout(timer);
  }, [membership, fit]);
  // A graph fitted while hidden (a phone showing the inspector instead) is fitted again once shown.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = box.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    let hidden = node.clientWidth === 0;
    const observer = new ResizeObserver(([entry]) => {
      const nowHidden = (entry?.contentRect.width ?? 0) === 0;
      if (hidden && !nowHidden) setTimeout(fit, 80);
      hidden = nowHidden;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fit]);
  return (
    <div ref={box} className="de-graph" aria-label="ROS resource graph">
      <div className="de-graph-actions">
        {config.selected && <button onClick={() => onSelect('')}>Clear focus</button>}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={graph.edges}
        onNodesChange={onNodesChange}
        onInit={instance => {
          flow.current = instance;
        }}
        fitView
        nodesConnectable={false}
        onNodeClick={(_, node) => onSelect(node.id)}
        onNodeDragStop={(_, node) =>
          onPositions({ ...config.positions, [layerKey(config.kind, node.id)]: node.position })
        }
        minZoom={0.1}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {!nodes.length && <div className="de-graph-empty">No discovered connections for this selection.</div>}
      <span
        className="de-graph-caption"
        title="Dashed edges were discovered; solid edges belong to watched topics with measured traffic. Discovery alone does not prove delivery."
      >
        <span>
          {graph.truncated
            ? 'Focused view · first 60 resources'
            : `${graph.nodes.length} nodes · ${graph.edges.length} links`}
        </span>
        <span className="de-graph-legend"> · Dashed: discovered · Solid: traffic measured</span>
      </span>
    </div>
  );
}
