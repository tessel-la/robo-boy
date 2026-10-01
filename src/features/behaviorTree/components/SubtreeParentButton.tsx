import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaLevelUpAlt } from 'react-icons/fa';
import './SubtreeParentButton.css';

type Anchor = { x: number; y: number };

// Shared by the JSON and native editors: keep navigation beside the visible graph,
// outside its zoom transform, and refresh after layout, pan or panel resizing.
export function useSubtreeReturnAnchor(
  canvasRef: React.RefObject<HTMLDivElement>,
  active: boolean,
  view: string | readonly string[],
  nodes: readonly { id: string }[]
) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const frame = useRef<number | null>(null);
  const update = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (!active) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!active) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const canvasRect = canvas.getBoundingClientRect();
      const nodeElements = Array.from(canvas.querySelectorAll<HTMLElement>('.react-flow__node'));

      if (nodeElements.length === 0) {
        setAnchor({ x: 16, y: 64 });
        return;
      }

      const bounds = nodeElements.reduce(
        (acc, element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 && rect.height <= 0) return acc;
          return {
            left: Math.min(acc.left, rect.left),
            top: Math.min(acc.top, rect.top),
            right: Math.max(acc.right, rect.right),
            bottom: Math.max(acc.bottom, rect.bottom),
          };
        },
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
      );

      if (!Number.isFinite(bounds.left)) {
        setAnchor({ x: 16, y: 64 });
        return;
      }

      const x = Math.min(Math.max(bounds.left - canvasRect.left - 2, 8), Math.max(canvasRect.width - 132, 8));
      const aboveY = bounds.top - canvasRect.top - 46;
      const y =
        aboveY >= 8
          ? aboveY
          : Math.min(Math.max(bounds.bottom - canvasRect.top + 10, 8), Math.max(canvasRect.height - 40, 8));

      setAnchor(previous => (previous?.x === x && previous?.y === y ? previous : { x, y }));
    });
  }, [active, canvasRef]);
  useEffect(() => {
    update();
  }, [update, view, nodes]);
  useEffect(() => {
    if (!active) return;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    // React Flow may commit its fit/zoom transform after the move callback.
    // Measure after the actual DOM transform so Parent stays beside the graph.
    const layoutObserver = new MutationObserver(records => {
      if (
        records.some(
          record =>
            record.type === 'childList' ||
            (record.target as Element).matches('.react-flow__viewport, .react-flow__node')
        )
      )
        update();
    });
    if (canvasRef.current) {
      observer?.observe(canvasRef.current);
      layoutObserver.observe(canvasRef.current, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style'],
      });
    }
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      layoutObserver.disconnect();
      window.removeEventListener('resize', update);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [active, canvasRef, update]);
  return active ? anchor : null;
}

export default function SubtreeParentButton({ anchor, onNavigate }: { anchor: Anchor; onNavigate: () => void }) {
  return (
    <button
      type="button"
      className="bt-subtree-parent-action"
      style={{ left: anchor.x, top: anchor.y }}
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        onNavigate();
      }}
      title="Back to parent tree"
      aria-label="Back to parent tree"
      data-testid="bt-subtree-parent"
    >
      <FaLevelUpAlt aria-hidden="true" />
      <span>Parent</span>
    </button>
  );
}
