export type WorkspaceSplitAxis = 'x' | 'y';

export type WorkspaceLayoutNode =
  | { type: 'tile'; id: string }
  | {
      type: 'split';
      axis: WorkspaceSplitAxis;
      ratio: number;
      first: WorkspaceLayoutNode;
      second: WorkspaceLayoutNode;
    };

export type WorkspaceLayoutState = {
  version: 2;
  root: WorkspaceLayoutNode | null;
};

export type LegacyWorkspaceLayoutState = {
  rowRatios?: number[];
  columnRatiosByRow?: Record<number, number[]>;
  rowSizes?: number[];
};

export type WorkspaceDropEdge = 'left' | 'right' | 'top' | 'bottom';

export type WorkspaceDropPlacement = { mode: 'tile'; targetTileId: string; edge: WorkspaceDropEdge } | { mode: 'end' };

export type WorkspaceLayoutBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type WorkspaceLayoutGeometry = {
  tiles: Array<{ id: string; bounds: WorkspaceLayoutBounds }>;
  splits: Array<{
    path: string;
    axis: WorkspaceSplitAxis;
    ratio: number;
    bounds: WorkspaceLayoutBounds;
  }>;
};

const MIN_SPLIT_RATIO = 0.15;

const clampRatio = (ratio: unknown) => {
  return typeof ratio === 'number' && Number.isFinite(ratio)
    ? Math.max(MIN_SPLIT_RATIO, Math.min(1 - MIN_SPLIT_RATIO, ratio))
    : 0.5;
};

const normalizeWeights = (weights: unknown, length: number): number[] => {
  if (!Array.isArray(weights) || weights.length !== length) {
    return Array.from({ length }, () => 1);
  }
  return weights.map(weight => (typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : 1));
};

const joinWeighted = (
  nodes: WorkspaceLayoutNode[],
  axis: WorkspaceSplitAxis,
  weights: number[]
): WorkspaceLayoutNode | null => {
  if (nodes.length === 0) return null;
  if (nodes.length === 1) return nodes[0];

  const [first, ...rest] = nodes;
  const firstWeight = weights[0];
  const restWeight = weights.slice(1).reduce((sum, weight) => sum + weight, 0);
  const second = joinWeighted(rest, axis, weights.slice(1));
  if (!second) return first;

  return {
    type: 'split',
    axis,
    ratio: clampRatio(firstWeight / (firstWeight + restWeight)),
    first,
    second,
  };
};

export const createWorkspaceLayoutFromRows = (
  rows: string[][],
  rowRatios?: number[],
  columnRatiosByRow: Record<number, number[]> = {}
): WorkspaceLayoutState => {
  const rowNodes = rows.flatMap((row, rowIndex) => {
    const nodes = row.map<WorkspaceLayoutNode>(id => ({ type: 'tile', id }));
    const node = joinWeighted(nodes, 'x', normalizeWeights(columnRatiosByRow[rowIndex], nodes.length));
    return node ? [node] : [];
  });

  return {
    version: 2,
    root: joinWeighted(rowNodes, 'y', normalizeWeights(rowRatios, rowNodes.length)),
  };
};

const buildLegacyRows = (tileIds: string[], rowSizes?: number[]) => {
  if (
    Array.isArray(rowSizes) &&
    rowSizes.length > 0 &&
    rowSizes.every(size => Number.isInteger(size) && size > 0) &&
    rowSizes.reduce((sum, size) => sum + size, 0) === tileIds.length
  ) {
    const rows: string[][] = [];
    let offset = 0;
    rowSizes.forEach(size => {
      rows.push(tileIds.slice(offset, offset + size));
      offset += size;
    });
    return rows;
  }

  const columns = tileIds.length <= 1 ? 1 : tileIds.length === 2 ? 2 : Math.ceil(Math.sqrt(tileIds.length));
  const rows: string[][] = [];
  for (let index = 0; index < tileIds.length; index += columns) {
    rows.push(tileIds.slice(index, index + columns));
  }
  return rows;
};

const parseNode = (value: unknown, validIds: Set<string>, seen: Set<string>): WorkspaceLayoutNode | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<WorkspaceLayoutNode> & Record<string, unknown>;

  if (candidate.type === 'tile') {
    if (typeof candidate.id !== 'string' || !validIds.has(candidate.id) || seen.has(candidate.id)) return null;
    seen.add(candidate.id);
    return { type: 'tile', id: candidate.id };
  }

  if (candidate.type !== 'split' || (candidate.axis !== 'x' && candidate.axis !== 'y')) return null;
  const first = parseNode(candidate.first, validIds, seen);
  const second = parseNode(candidate.second, validIds, seen);
  if (!first) return second;
  if (!second) return first;
  return {
    type: 'split',
    axis: candidate.axis,
    ratio: clampRatio(candidate.ratio),
    first,
    second,
  };
};

export const getWorkspaceLayoutTileIds = (node: WorkspaceLayoutNode | null): string[] => {
  if (!node) return [];
  if (node.type === 'tile') return [node.id];
  return [...getWorkspaceLayoutTileIds(node.first), ...getWorkspaceLayoutTileIds(node.second)];
};

/**
 * Projects the recursive split tree onto one flat layout surface. Panels can
 * then stay keyed siblings while their geometry changes, avoiding component
 * remounts (and lost panel state) when a tile is inserted or moved in the tree.
 */
export const getWorkspaceLayoutGeometry = (root: WorkspaceLayoutNode | null): WorkspaceLayoutGeometry => {
  const geometry: WorkspaceLayoutGeometry = { tiles: [], splits: [] };

  const visit = (node: WorkspaceLayoutNode, bounds: WorkspaceLayoutBounds, path: string) => {
    if (node.type === 'tile') {
      geometry.tiles.push({ id: node.id, bounds });
      return;
    }

    const ratio = clampRatio(node.ratio);
    geometry.splits.push({ path, axis: node.axis, ratio, bounds });
    if (node.axis === 'x') {
      visit(node.first, { ...bounds, width: bounds.width * ratio }, `${path}0`);
      visit(
        node.second,
        {
          ...bounds,
          left: bounds.left + bounds.width * ratio,
          width: bounds.width * (1 - ratio),
        },
        `${path}1`
      );
      return;
    }

    visit(node.first, { ...bounds, height: bounds.height * ratio }, `${path}0`);
    visit(
      node.second,
      {
        ...bounds,
        top: bounds.top + bounds.height * ratio,
        height: bounds.height * (1 - ratio),
      },
      `${path}1`
    );
  };

  if (root) visit(root, { left: 0, top: 0, width: 100, height: 100 }, '');
  return geometry;
};

const appendTile = (root: WorkspaceLayoutNode | null, id: string): WorkspaceLayoutNode => {
  const tile: WorkspaceLayoutNode = { type: 'tile', id };
  if (!root) return tile;
  return { type: 'split', axis: 'y', ratio: 0.5, first: root, second: tile };
};

export const normalizeWorkspaceLayout = (value: unknown, tileIds: string[]): WorkspaceLayoutState => {
  const validIds = new Set(tileIds);
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const seen = new Set<string>();
  let root = candidate.version === 2 ? parseNode(candidate.root, validIds, seen) : null;

  if (candidate.version !== 2) {
    const legacy = candidate as LegacyWorkspaceLayoutState;
    root = createWorkspaceLayoutFromRows(
      buildLegacyRows(tileIds, legacy.rowSizes),
      legacy.rowRatios,
      legacy.columnRatiosByRow
    ).root;
    getWorkspaceLayoutTileIds(root).forEach(id => seen.add(id));
  }

  tileIds.forEach(id => {
    if (!seen.has(id)) root = appendTile(root, id);
  });

  return { version: 2, root };
};

export const removeWorkspaceLayoutTile = (
  node: WorkspaceLayoutNode | null,
  tileId: string
): WorkspaceLayoutNode | null => {
  if (!node) return null;
  if (node.type === 'tile') return node.id === tileId ? null : node;

  const first = removeWorkspaceLayoutTile(node.first, tileId);
  const second = removeWorkspaceLayoutTile(node.second, tileId);
  if (!first) return second;
  if (!second) return first;
  if (first === node.first && second === node.second) return node;
  return { ...node, first, second };
};

const insertAtTile = (
  node: WorkspaceLayoutNode,
  tile: WorkspaceLayoutNode,
  targetTileId: string,
  edge: WorkspaceDropEdge
): WorkspaceLayoutNode => {
  if (node.type === 'tile') {
    if (node.id !== targetTileId) return node;
    const before = edge === 'left' || edge === 'top';
    return {
      type: 'split',
      axis: edge === 'left' || edge === 'right' ? 'x' : 'y',
      ratio: 0.5,
      first: before ? tile : node,
      second: before ? node : tile,
    };
  }

  const first = insertAtTile(node.first, tile, targetTileId, edge);
  if (first !== node.first) return { ...node, first };
  const second = insertAtTile(node.second, tile, targetTileId, edge);
  return second === node.second ? node : { ...node, second };
};

export const placeWorkspaceLayoutTile = (
  root: WorkspaceLayoutNode | null,
  tileId: string,
  placement: WorkspaceDropPlacement
): WorkspaceLayoutState => {
  if (placement.mode === 'tile' && placement.targetTileId === tileId) {
    return { version: 2, root };
  }

  const withoutTile = removeWorkspaceLayoutTile(root, tileId);
  const tile: WorkspaceLayoutNode = { type: 'tile', id: tileId };
  if (!withoutTile) return { version: 2, root: tile };
  if (placement.mode === 'end') return { version: 2, root: appendTile(withoutTile, tileId) };

  const nextRoot = insertAtTile(withoutTile, tile, placement.targetTileId, placement.edge);
  return {
    version: 2,
    root: nextRoot === withoutTile ? appendTile(withoutTile, tileId) : nextRoot,
  };
};

export const updateWorkspaceSplitRatio = (
  node: WorkspaceLayoutNode | null,
  path: string,
  ratio: number
): WorkspaceLayoutNode | null => {
  if (!node || node.type === 'tile') return node;
  if (path === '') return { ...node, ratio: clampRatio(ratio) };

  const [branch, ...rest] = path;
  const childPath = rest.join('');
  return branch === '0'
    ? { ...node, first: updateWorkspaceSplitRatio(node.first, childPath, ratio) || node.first }
    : { ...node, second: updateWorkspaceSplitRatio(node.second, childPath, ratio) || node.second };
};

export const findWorkspaceLayoutNode = (node: WorkspaceLayoutNode | null, path: string): WorkspaceLayoutNode | null => {
  let current = node;
  for (const branch of path) {
    if (!current || current.type === 'tile') return null;
    current = branch === '0' ? current.first : current.second;
  }
  return current;
};
