import React, { useMemo, useState } from 'react';

import TreePanelSearch from '../../treePanel/components/TreePanelSearch';
import { searchBehaviorTreeNodes } from '../nodeSearch';
import { BehaviorTreeNode } from '../types';
import './NodeSearch.css';

interface NodeSearchProps {
  nodes: BehaviorTreeNode[];
  onSelectNode: (node: BehaviorTreeNode) => void;
}

const NodeSearch: React.FC<NodeSearchProps> = ({ nodes, onSelectNode }) => {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchBehaviorTreeNodes(nodes, query), [nodes, query]);

  return (
    <TreePanelSearch
      className="bt-node-search"
      query={query}
      onQueryChange={setQuery}
      results={results.map(result => ({
        id: result.node.id,
        label: result.label,
        detail: result.detail,
        badge: result.typeLabel,
        value: result.node,
      }))}
      onSelect={onSelectNode}
      placeholder={nodes.length > 0 ? 'Search tree nodes...' : 'No nodes to search'}
      ariaLabel="Search tree nodes"
      emptyText="No matching nodes"
      disabled={nodes.length === 0}
      testId="bt-node-search"
      listboxId="bt-node-search-results"
    />
  );
};

export default NodeSearch;
