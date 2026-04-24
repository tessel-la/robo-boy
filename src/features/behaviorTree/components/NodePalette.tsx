import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Ros } from 'roslib';
import { discoverAllROSResources } from '../services/rosDiscovery';
import {
  ROSDiscoveryResult,
  BehaviorNodeType,
  NodePaletteItem,
  ROSActionInfo,
  ROSServiceInfo,
  ROSTopicInfo,
} from '../types';
import './NodePalette.css';

interface NodePaletteProps {
  ros: Ros | null;
  isConnected: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onAddNode?: (type: BehaviorNodeType, rosInfo?: ROSActionInfo | ROSServiceInfo | ROSTopicInfo) => void;
}

const MOBILE_BREAKPOINT = '(max-width: 768px)';

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
  const hasDiscovered = React.useRef(false);
  const [expandedSections, setExpandedSections] = useState({
    control: true,
    actions: false,
    services: false,
    topics: false,
  });

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

  // Control flow nodes (always available)
  const controlNodes: NodePaletteItem[] = [
    { type: BehaviorNodeType.Sequence, label: 'Sequence', icon: '→', category: 'control' },
    { type: BehaviorNodeType.Selector, label: 'Selector', icon: '?', category: 'control' },
    { type: BehaviorNodeType.Parallel, label: 'Parallel', icon: '∥', category: 'control' },
  ];

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
    rosInfo?: ROSActionInfo | ROSServiceInfo | ROSTopicInfo
  ) => {
    e.dataTransfer.setData('application/reactflow', JSON.stringify({ nodeType, rosInfo }));
    e.dataTransfer.effectAllowed = 'move';
  };

  // Desktop collapsed strip
  if (isCollapsed && !isMobile) {
    return (
      <div className="node-palette collapsed">
        <button className="palette-toggle" onClick={onToggleCollapse} title="Expand Palette">
          ▶
        </button>
      </div>
    );
  }

  // Mobile collapsed — render nothing (toolbar toggle button controls open/close)
  if (isCollapsed && isMobile) {
    return null;
  }

  return (
    <div
      className={`node-palette${isMobile ? ' mobile-sheet' : ''}`}
      ref={paletteRef}
      style={isMobile && sheetHeight !== null ? { height: sheetHeight } : undefined}
    >
      {isMobile && (
        <div
          className="palette-drag-handle"
          ref={handleRef}
        />
      )}
      {/* palette-body scrolls independently — drag handle stays outside overflow */}
      <div className={isMobile ? 'palette-body' : undefined}>
      <div className="palette-header">
        <h3 className="palette-title">Node Palette</h3>
        <button className="palette-toggle" onClick={onToggleCollapse} title="Collapse Palette">
          ◀
        </button>
      </div>

      {isConnected && (
        <button
          className="palette-discover-btn"
          onClick={handleDiscover}
          disabled={isDiscovering}
        >
          {isDiscovering ? '🔄 Discovering...' : '🔍 Discover ROS'}
        </button>
      )}

      {/* Control Flow Section */}
      <div className="palette-section">
        <div className="palette-section-header" onClick={() => toggleSection('control')}>
          <span className="palette-section-icon">{expandedSections.control ? '▼' : '▶'}</span>
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
                <span className="palette-node-icon">{node.icon}</span>
                <span className="palette-node-label">{node.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ROS Actions Section */}
      <div className="palette-section">
        <div className="palette-section-header" onClick={() => toggleSection('actions')}>
          <span className="palette-section-icon">{expandedSections.actions ? '▼' : '▶'}</span>
          <span className="palette-section-title">ROS Actions</span>
          <span className="palette-section-count">{rosResources.actions.length}</span>
        </div>
        {expandedSections.actions && (
          <div className="palette-section-content">
            {rosResources.actions.length === 0 ? (
              <div className="palette-empty">
                {isConnected ? 'No actions found' : 'Connect to ROS first'}
              </div>
            ) : (
              rosResources.actions.map((action, index) => (
                <div
                  key={`${action.name}-${index}`}
                  className="palette-node palette-node-ros"
                  draggable
                  onDragStart={(e) => handleDragStart(e, BehaviorNodeType.Action, action)}
                  onClick={() => onAddNode?.(BehaviorNodeType.Action, action)}
                  title={action.name}
                >
                  <span className="palette-node-icon">⚡</span>
                  <span className="palette-node-label">{action.name}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ROS Services Section */}
      <div className="palette-section">
        <div className="palette-section-header" onClick={() => toggleSection('services')}>
          <span className="palette-section-icon">{expandedSections.services ? '▼' : '▶'}</span>
          <span className="palette-section-title">ROS Services</span>
          <span className="palette-section-count">{rosResources.services.length}</span>
        </div>
        {expandedSections.services && (
          <div className="palette-section-content">
            {rosResources.services.length === 0 ? (
              <div className="palette-empty">
                {isConnected ? 'No services found' : 'Connect to ROS first'}
              </div>
            ) : (
              rosResources.services.map((service, index) => (
                <div
                  key={`${service.name}-${index}`}
                  className="palette-node palette-node-ros"
                  draggable
                  onDragStart={(e) => handleDragStart(e, BehaviorNodeType.Service, service)}
                  onClick={() => onAddNode?.(BehaviorNodeType.Service, service)}
                  title={service.name}
                >
                  <span className="palette-node-icon">🔧</span>
                  <span className="palette-node-label">{service.name}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* ROS Topics Section */}
      <div className="palette-section">
        <div className="palette-section-header" onClick={() => toggleSection('topics')}>
          <span className="palette-section-icon">{expandedSections.topics ? '▼' : '▶'}</span>
          <span className="palette-section-title">ROS Topics</span>
          <span className="palette-section-count">{rosResources.topics.length}</span>
        </div>
        {expandedSections.topics && (
          <div className="palette-section-content">
            {rosResources.topics.length === 0 ? (
              <div className="palette-empty">
                {isConnected ? 'No topics found' : 'Connect to ROS first'}
              </div>
            ) : (
              rosResources.topics.map((topic, index) => (
                <div
                  key={`${topic.name}-${index}`}
                  className="palette-node palette-node-ros"
                  draggable
                  onDragStart={(e) => handleDragStart(e, BehaviorNodeType.Topic, topic)}
                  onClick={() => onAddNode?.(BehaviorNodeType.Topic, topic)}
                  title={topic.name}
                >
                  <span className="palette-node-icon">📡</span>
                  <span className="palette-node-label">{topic.name}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
      </div>{/* end palette-body */}
    </div>
  );
};

export default NodePalette;
