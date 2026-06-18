import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Ros } from 'roslib';
import { discoverAllROSResources } from '../services/rosDiscovery';
import {
  BEHAVIOR_TREE_STORAGE_EVENT,
  listBehaviorTrees,
} from '../storage/treeStorage';
import {
  BehaviorTree,
  ROSDiscoveryResult,
  BehaviorNodeType,
  NodePaletteItem,
  ROSActionInfo,
  ROSServiceInfo,
  ROSTopicInfo,
} from '../types';
import './NodePalette.css';

// ─── Palette icons ────────────────────────────────────────────────────────────

const IconChevronDown = () => (
  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="1,1 5,5 9,1"/>
  </svg>
);

const IconChevronRight = () => (
  <svg width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="1,1 5,5 1,9"/>
  </svg>
);

const IconChevronLeft = () => (
  <svg width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="5,1 1,5 5,9"/>
  </svg>
);

const IconDiscover = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="5.5" cy="5.5" r="4"/>
    <line x1="8.5" y1="8.5" x2="12" y2="12"/>
  </svg>
);

const IconDiscovering = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <circle cx="6.5" cy="6.5" r="5" strokeDasharray="8 6" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 6.5 6.5" to="360 6.5 6.5" dur="0.9s" repeatCount="indefinite"/>
    </circle>
  </svg>
);

const IconSearch = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="6" cy="6" r="4" />
    <line x1="9" y1="9" x2="13" y2="13" />
  </svg>
);

const IconAction = () => (
  <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor" aria-hidden="true">
    <path d="M6.5 1L1 7.5h4.5L4 12l6.5-7H6z"/>
  </svg>
);

const IconService = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    <circle cx="7" cy="7" r="2.5"/>
    <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.6 2.6l1.1 1.1M10.3 10.3l1.1 1.1M11.4 2.6l-1.1 1.1M3.7 10.3l-1.1 1.1"/>
  </svg>
);

const IconTopic = () => (
  <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <circle cx="7" cy="9.5" r="1.5" fill="currentColor" stroke="none"/>
    <path d="M4 7a4.2 4.2 0 016 0"/>
    <path d="M1 4.5a8.5 8.5 0 0112 0"/>
  </svg>
);

const IconSequence = () => (
  <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="1" y="2" width="4" height="6" rx="1"/>
    <rect x="9" y="2" width="4" height="6" rx="1"/>
    <line x1="5" y1="5" x2="9" y2="5"/>
    <polyline points="7.2,3.5 9,5 7.2,6.5"/>
  </svg>
);

const IconSelector = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="6,1 11,6 6,11 1,6"/>
  </svg>
);

const IconParallel = () => (
  <svg width="10" height="12" viewBox="0 0 10 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="2.5" y1="1" x2="2.5" y2="9"/>
    <polyline points="1,7 2.5,9 4,7"/>
    <line x1="7.5" y1="1" x2="7.5" y2="9"/>
    <polyline points="6,7 7.5,9 9,7"/>
  </svg>
);
const IconSubtree = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="1.5" y="1.5" width="11" height="11" rx="2" />
    <path d="M4.5 4.5h5M4.5 7h5M4.5 9.5h3" />
  </svg>
);

interface NodePaletteProps {
  ros: Ros | null;
  isConnected: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onAddNode?: (
    type: BehaviorNodeType,
    item?: ROSActionInfo | ROSServiceInfo | ROSTopicInfo | BehaviorTree
  ) => void;
}

const MOBILE_BREAKPOINT = '(max-width: 768px)';

const matchesResourceSearch = (
  resource: { name: string; type: string },
  terms: string[]
): boolean => {
  if (terms.length === 0) return true;

  const searchableText = `${resource.name} ${resource.type}`.toLocaleLowerCase();
  return terms.every((term) => searchableText.includes(term));
};

const NodePalette: React.FC<NodePaletteProps> = ({
  ros,
  isConnected,
  isCollapsed,
  onToggleCollapse,
  onAddNode,
}) => {
  const [rosResources, setRosResources] = useState<ROSDiscoveryResult>({
    actions: [],
    services: [],
    topics: [],
  });
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [resourceQuery, setResourceQuery] = useState('');
  const hasDiscovered = React.useRef(false);
  const [expandedSections, setExpandedSections] = useState({
    control: true,
    saved: true,
    actions: false,
    services: false,
    topics: false,
  });
  const [savedTrees, setSavedTrees] = useState(listBehaviorTrees());

  const [isMobile, setIsMobile] = React.useState(false);
  // Height controlled by drag; null = CSS default
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  // Use a ref for drag state — avoids the async gap where state update +
  // re-render would delay adding document listeners past the first touchmove.
  const isDraggingRef = useRef(false);
  const onToggleCollapseRef = useRef(onToggleCollapse);
  useEffect(() => { onToggleCollapseRef.current = onToggleCollapse; }, [onToggleCollapse]);

  React.useEffect(() => {
    const mq = window.matchMedia(MOBILE_BREAKPOINT);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Shared move logic — used by both mouse and touch handlers.
  const applyDrag = useCallback((clientY: number) => {
    const parent = paletteRef.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const newHeight = rect.bottom - clientY;
    setSheetHeight(Math.min(Math.max(80, newHeight), rect.height * 0.9));
  }, []);

  const endDrag = useCallback((clientY: number) => {
    isDraggingRef.current = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    const parent = paletteRef.current?.parentElement;
    if (parent) {
      const remaining = parent.getBoundingClientRect().bottom - clientY;
      if (remaining < 80) {
        setSheetHeight(null);
        onToggleCollapseRef.current();
      }
    }
  }, []);

  // Document-level listeners — same pattern as useResizablePanels.
  // Always attached when mobile so no events are lost between pointerdown and move.
  useEffect(() => {
    if (!isMobile) return;

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      applyDrag(e.clientY);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      endDrag(e.clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      applyDrag(e.touches[0].clientY);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      endDrag(e.changedTouches[0].clientY);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isMobile, isCollapsed, applyDrag, endDrag]);

  // Pointer-start listeners on the handle element.
  // isCollapsed is in deps: the early return unmounts the handle on close,
  // so we must re-attach after each open.
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !isMobile) return;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';
    };
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      document.body.style.userSelect = 'none';
    };

    handle.addEventListener('mousedown', onMouseDown);
    handle.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => {
      handle.removeEventListener('mousedown', onMouseDown);
      handle.removeEventListener('touchstart', onTouchStart);
    };
  }, [isMobile, isCollapsed]);

  const CONTROL_ICONS: Record<string, React.ReactNode> = {
    Sequence: <IconSequence />,
    Selector: <IconSelector />,
    Parallel: <IconParallel />,
  };

  // Control flow nodes (always available)
  const controlNodes: NodePaletteItem[] = [
    { type: BehaviorNodeType.Sequence, label: 'Sequence', icon: '→', category: 'control' },
    { type: BehaviorNodeType.Selector, label: 'Selector', icon: '?', category: 'control' },
    { type: BehaviorNodeType.Parallel, label: 'Parallel', icon: '∥', category: 'control' },
  ];

  const resourceSearchTerms = useMemo(
    () => resourceQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),
    [resourceQuery]
  );
  const isResourceSearchActive = resourceSearchTerms.length > 0;
  const filteredActions = useMemo(
    () => rosResources.actions.filter((resource) => matchesResourceSearch(resource, resourceSearchTerms)),
    [resourceSearchTerms, rosResources.actions]
  );
  const filteredServices = useMemo(
    () => rosResources.services.filter((resource) => matchesResourceSearch(resource, resourceSearchTerms)),
    [resourceSearchTerms, rosResources.services]
  );
  const filteredTopics = useMemo(
    () => rosResources.topics.filter((resource) => matchesResourceSearch(resource, resourceSearchTerms)),
    [resourceSearchTerms, rosResources.topics]
  );
  const filteredResourceCount =
    filteredActions.length + filteredServices.length + filteredTopics.length;
  const resourceCount =
    rosResources.actions.length + rosResources.services.length + rosResources.topics.length;

  // Discover ROS resources once when first connected.
  // We guard with a ref so switching tabs back and forth doesn't re-trigger
  // discovery (which would flood rosbridge with service calls).
  useEffect(() => {
    if (isConnected && ros && !hasDiscovered.current) {
      hasDiscovered.current = true;
      handleDiscover();
    }
    if (!isConnected) {
      hasDiscovered.current = false;
    }
  }, [isConnected, ros]);

  useEffect(() => {
    const handleSavedTreesChanged = () => {
      setSavedTrees(listBehaviorTrees());
    };

    window.addEventListener(BEHAVIOR_TREE_STORAGE_EVENT, handleSavedTreesChanged);
    return () => window.removeEventListener(BEHAVIOR_TREE_STORAGE_EVENT, handleSavedTreesChanged);
  }, []);

  const handleDiscover = async () => {
    if (!ros) return;
    setIsDiscovering(true);
    try {
      const resources = await discoverAllROSResources(ros);
      setRosResources(resources);
    } catch (error) {
      console.error('Failed to discover ROS resources:', error);
    } finally {
      setIsDiscovering(false);
    }
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleDragStart = (
    e: React.DragEvent,
    nodeType: BehaviorNodeType,
    item?: ROSActionInfo | ROSServiceInfo | ROSTopicInfo | BehaviorTree
  ) => {
    e.dataTransfer.setData('application/reactflow', JSON.stringify({ nodeType, item }));
    e.dataTransfer.effectAllowed = 'move';
  };

  // Desktop collapsed — nothing rendered; floating toolbar toggle handles show/hide
  if (isCollapsed && !isMobile) {
    return null;
  }

  // Mobile collapsed — render nothing (toolbar toggle button controls open/close)
  if (isCollapsed && isMobile) {
    return null;
  }

  return (
    <div
      className={`node-palette${isMobile ? ' mobile-sheet' : ''}`}
      ref={paletteRef}
      data-testid="bt-node-palette"
      style={isMobile && sheetHeight !== null ? { height: sheetHeight } : undefined}
    >
      {isMobile && (
        <div
          className="palette-drag-handle"
          ref={handleRef}
        />
      )}
      {/* palette-body scrolls independently — drag handle stays outside overflow */}
      <div className="palette-body">
      <div className="palette-header">
        <h3 className="palette-title">Node Palette</h3>
        <button className="palette-toggle" onClick={onToggleCollapse} title="Collapse Palette" aria-label="Collapse palette">
          <IconChevronLeft />
          <span>Close</span>
        </button>
      </div>

      {isConnected && (
        <button
          className="palette-discover-btn"
          onClick={handleDiscover}
          disabled={isDiscovering}
        >
          {isDiscovering ? <IconDiscovering /> : <IconDiscover />}
          {isDiscovering ? 'Discovering…' : 'Discover ROS'}
        </button>
      )}

      {resourceCount > 0 && (
        <div className="palette-resource-search" role="search">
          <IconSearch />
          <input
            className="palette-resource-search-input"
            type="search"
            value={resourceQuery}
            onChange={(e) => setResourceQuery(e.target.value)}
            placeholder="Search actions, services, topics..."
            aria-label="Search available ROS resources"
            autoComplete="off"
            spellCheck={false}
          />
          {resourceQuery && (
            <button
              className="palette-resource-search-clear"
              type="button"
              onClick={() => setResourceQuery('')}
              aria-label="Clear ROS resource search"
              title="Clear search"
            >
              x
            </button>
          )}
        </div>
      )}

      {isResourceSearchActive && filteredResourceCount === 0 && (
        <div className="palette-resource-search-empty" role="status">
          No matching actions, services, or topics
        </div>
      )}

      {/* Control Flow Section */}
      <div className="palette-section">
        <div className="palette-section-header" onClick={() => toggleSection('control')}>
          <span className="palette-section-icon">
            {expandedSections.control ? <IconChevronDown /> : <IconChevronRight />}
          </span>
          <span className="palette-section-title">Control Flow</span>
          <span className="palette-section-count">{controlNodes.length}</span>
        </div>
        {expandedSections.control && (
          <div className="palette-section-content">
            {controlNodes.map((node) => (
              <div
                key={node.type}
                className="palette-node"
                draggable
                onDragStart={(e) => handleDragStart(e, node.type)}
                onClick={() => onAddNode?.(node.type, undefined)}
              >
                <span className="palette-node-icon">{CONTROL_ICONS[node.label]}</span>
                <span className="palette-node-label">{node.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="palette-section">
        <div className="palette-section-header" onClick={() => toggleSection('saved')}>
          <span className="palette-section-icon">
            {expandedSections.saved ? <IconChevronDown /> : <IconChevronRight />}
          </span>
          <span className="palette-section-title">Saved Trees</span>
          <span className="palette-section-count">{savedTrees.length}</span>
        </div>
        {expandedSections.saved && (
          <div className="palette-section-content">
            {savedTrees.length === 0 ? (
              <div className="palette-empty">Save a tree to reuse it as a subtree</div>
            ) : (
              savedTrees.map(({ tree }) => (
                <div
                  key={tree.id}
                  className="palette-node palette-node-ros"
                  draggable
                  onDragStart={(e) => handleDragStart(e, BehaviorNodeType.Subtree, tree)}
                  onClick={() => onAddNode?.(BehaviorNodeType.Subtree, tree)}
                  title={`Insert "${tree.name}" as a subtree`}
                >
                  <span className="palette-node-icon">
                    <IconSubtree />
                  </span>
                  <span className="palette-node-copy">
                    <span className="palette-node-label">{tree.name}</span>
                    <span className="palette-node-detail">
                      {tree.nodes.length} node{tree.nodes.length === 1 ? '' : 's'}
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ROS Actions Section */}
      {(!isResourceSearchActive || filteredActions.length > 0) && (
        <div className="palette-section">
          <div className="palette-section-header" onClick={() => toggleSection('actions')}>
            <span className="palette-section-icon">
              {isResourceSearchActive || expandedSections.actions ? <IconChevronDown /> : <IconChevronRight />}
            </span>
            <span className="palette-section-title">ROS Actions</span>
            {rosResources.actions.length > 0 && (
              <span className="palette-section-count">
                {isResourceSearchActive
                  ? `${filteredActions.length}/${rosResources.actions.length}`
                  : rosResources.actions.length}
              </span>
            )}
          </div>
          {(isResourceSearchActive || expandedSections.actions) && (
            <div className="palette-section-content">
              {rosResources.actions.length === 0 ? (
                <div className="palette-empty">
                  {isConnected ? 'No actions found' : 'Connect to ROS first'}
                </div>
              ) : (
                filteredActions.map((action, index) => (
                  <div
                    key={`${action.name}-${index}`}
                    className="palette-node palette-node-ros"
                    draggable
                    onDragStart={(e) => handleDragStart(e, BehaviorNodeType.Action, action)}
                    onClick={() => onAddNode?.(BehaviorNodeType.Action, action)}
                    title={`${action.name} (${action.type})`}
                  >
                    <span className="palette-node-icon">
                      <IconAction />
                    </span>
                    <span className="palette-node-copy">
                      <span className="palette-node-label">{action.name}</span>
                      <span className="palette-node-detail">{action.type}</span>
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* ROS Services Section */}
      {(!isResourceSearchActive || filteredServices.length > 0) && (
        <div className="palette-section">
        <div className="palette-section-header" onClick={() => toggleSection('services')}>
          <span className="palette-section-icon">
            {isResourceSearchActive || expandedSections.services ? <IconChevronDown /> : <IconChevronRight />}
          </span>
          <span className="palette-section-title">ROS Services</span>
          {rosResources.services.length > 0 && (
            <span className="palette-section-count">
              {isResourceSearchActive
                ? `${filteredServices.length}/${rosResources.services.length}`
                : rosResources.services.length}
            </span>
          )}
        </div>
        {(isResourceSearchActive || expandedSections.services) && (
          <div className="palette-section-content">
            {rosResources.services.length === 0 ? (
              <div className="palette-empty">
                {isConnected ? 'No services found' : 'Connect to ROS first'}
              </div>
            ) : (
              filteredServices.map((service, index) => (
                <div
                  key={`${service.name}-${index}`}
                  className="palette-node palette-node-ros"
                  draggable
                  onDragStart={(e) => handleDragStart(e, BehaviorNodeType.Service, service)}
                  onClick={() => onAddNode?.(BehaviorNodeType.Service, service)}
                  title={`${service.name} (${service.type})`}
                >
                  <span className="palette-node-icon">
                    <IconService />
                  </span>
                  <span className="palette-node-copy">
                    <span className="palette-node-label">{service.name}</span>
                    <span className="palette-node-detail">{service.type}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        </div>
      )}

      {/* ROS Topics Section */}
      {(!isResourceSearchActive || filteredTopics.length > 0) && (
        <div className="palette-section">
        <div className="palette-section-header" onClick={() => toggleSection('topics')}>
          <span className="palette-section-icon">
            {isResourceSearchActive || expandedSections.topics ? <IconChevronDown /> : <IconChevronRight />}
          </span>
          <span className="palette-section-title">ROS Topics</span>
          {rosResources.topics.length > 0 && (
            <span className="palette-section-count">
              {isResourceSearchActive
                ? `${filteredTopics.length}/${rosResources.topics.length}`
                : rosResources.topics.length}
            </span>
          )}
        </div>
        {(isResourceSearchActive || expandedSections.topics) && (
          <div className="palette-section-content">
            {rosResources.topics.length === 0 ? (
              <div className="palette-empty">
                {isConnected ? 'No topics found' : 'Connect to ROS first'}
              </div>
            ) : (
              filteredTopics.map((topic, index) => (
                <div
                  key={`${topic.name}-${index}`}
                  className="palette-node palette-node-ros"
                  draggable
                  onDragStart={(e) => handleDragStart(e, BehaviorNodeType.Topic, topic)}
                  onClick={() => onAddNode?.(BehaviorNodeType.Topic, topic)}
                  title={`${topic.name} (${topic.type})`}
                >
                  <span className="palette-node-icon">
                    <IconTopic />
                  </span>
                  <span className="palette-node-copy">
                    <span className="palette-node-label">{topic.name}</span>
                    <span className="palette-node-detail">{topic.type}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        </div>
      )}
      </div>{/* end palette-body */}
    </div>
  );
};

export default NodePalette;
