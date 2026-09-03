import React, { useEffect, useRef, useState } from 'react';
import {
  FaCheck,
  FaEraser,
  FaFont,
  FaLongArrowAltRight,
  FaPen,
  FaRegSquare,
  FaTimes,
  FaTrash,
  FaUndo,
} from 'react-icons/fa';
import './BehaviorTreeSketchEditor.css';

const SKETCH_WIDTH = 1200;
const SKETCH_HEIGHT = 800;
const COLORS = ['#16181d', '#2563eb', '#dc2626', '#f2b705', '#16a34a'];

type SketchTool = 'pen' | 'eraser' | 'text' | 'rectangle' | 'arrow';
type SketchPoint = { x: number; y: number };
type SketchElement =
  | { id: number; kind: 'stroke'; points: SketchPoint[]; color: string; width: number }
  | { id: number; kind: 'text'; point: SketchPoint; color: string; size: number; value: string }
  | { id: number; kind: 'arrow'; start: SketchPoint; end: SketchPoint; color: string; width: number }
  | {
      id: number;
      kind: 'rectangle';
      start: SketchPoint;
      end: SketchPoint;
      color: string;
      width: number;
      text?: string;
      textSize: number;
    };

interface PendingText {
  target: 'canvas' | 'rectangle';
  rectangleId?: number;
  point: SketchPoint;
  left: number;
  top: number;
  maxWidth?: number;
  value: string;
}

interface BehaviorTreeSketchEditorProps {
  onAttach: (dataUrl: string) => void;
  onClose: () => void;
}

const drawSketch = (context: CanvasRenderingContext2D, elements: SketchElement[]) => {
  context.save();
  context.clearRect(0, 0, SKETCH_WIDTH, SKETCH_HEIGHT);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, SKETCH_WIDTH, SKETCH_HEIGHT);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  elements.forEach(element => {
    if (element.kind === 'text') {
      context.fillStyle = element.color;
      context.font = `600 ${element.size}px sans-serif`;
      context.textAlign = 'left';
      context.textBaseline = 'top';
      context.fillText(element.value, element.point.x, element.point.y);
      return;
    }

    if (element.kind === 'rectangle') {
      const left = Math.min(element.start.x, element.end.x);
      const top = Math.min(element.start.y, element.end.y);
      const width = Math.abs(element.end.x - element.start.x);
      const height = Math.abs(element.end.y - element.start.y);
      context.strokeStyle = element.color;
      context.lineWidth = element.width;
      context.strokeRect(left, top, width, height);
      if (element.text) {
        context.fillStyle = element.color;
        context.font = `600 ${element.textSize}px sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(element.text, left + width / 2, top + height / 2, Math.max(20, width - 20));
      }
      return;
    }

    if (element.kind === 'arrow') {
      const angle = Math.atan2(element.end.y - element.start.y, element.end.x - element.start.x);
      const headLength = Math.max(24, element.width * 4);
      context.beginPath();
      context.strokeStyle = element.color;
      context.lineWidth = element.width;
      context.moveTo(element.start.x, element.start.y);
      context.lineTo(element.end.x, element.end.y);
      context.moveTo(element.end.x, element.end.y);
      context.lineTo(
        element.end.x - headLength * Math.cos(angle - Math.PI / 6),
        element.end.y - headLength * Math.sin(angle - Math.PI / 6)
      );
      context.moveTo(element.end.x, element.end.y);
      context.lineTo(
        element.end.x - headLength * Math.cos(angle + Math.PI / 6),
        element.end.y - headLength * Math.sin(angle + Math.PI / 6)
      );
      context.stroke();
      return;
    }

    if (element.points.length === 0) return;
    context.beginPath();
    context.strokeStyle = element.color;
    context.lineWidth = element.width;
    context.moveTo(element.points[0].x, element.points[0].y);
    element.points.slice(1).forEach(point => context.lineTo(point.x, point.y));
    if (element.points.length === 1) context.lineTo(element.points[0].x + 0.01, element.points[0].y + 0.01);
    context.stroke();
  });
  context.restore();
};

const BehaviorTreeSketchEditor: React.FC<BehaviorTreeSketchEditorProps> = ({ onAttach, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const activeElementRef = useRef<number | null>(null);
  const activeStartRef = useRef<SketchPoint | null>(null);
  const latestPointRef = useRef<SketchPoint | null>(null);
  const pendingTextRef = useRef<PendingText | null>(null);
  const nextIdRef = useRef(1);
  const [tool, setTool] = useState<SketchTool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(10);
  const [pendingText, setPendingText] = useState<PendingText | null>(null);
  const [elements, setElements] = useState<SketchElement[]>([]);

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (context) drawSketch(context, elements);
  }, [elements]);

  const updatePendingText = (next: PendingText | null) => {
    pendingTextRef.current = next;
    setPendingText(next);
  };

  const commitPendingText = () => {
    const pending = pendingTextRef.current;
    if (!pending) return;
    updatePendingText(null);
    const value = pending.value.trim();
    if (!value) return;
    if (pending.target === 'rectangle' && pending.rectangleId !== undefined) {
      setElements(previous =>
        previous.map(element =>
          element.kind === 'rectangle' && element.id === pending.rectangleId ? { ...element, text: value } : element
        )
      );
      return;
    }
    setElements(previous => [
      ...previous,
      {
        id: nextIdRef.current++,
        kind: 'text',
        point: pending.point,
        color,
        size: Math.max(32, strokeWidth * 4),
        value,
      },
    ]);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pendingTextRef.current) updatePendingText(null);
        else onClose();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        updatePendingText(null);
        setElements(previous => previous.slice(0, -1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>): SketchPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = bounds.width || SKETCH_WIDTH;
    const height = bounds.height || SKETCH_HEIGHT;
    const clientX = Number.isFinite(event.clientX) ? event.clientX : bounds.left;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : bounds.top;
    return {
      x: Math.max(0, Math.min(SKETCH_WIDTH, ((clientX - bounds.left) / width) * SKETCH_WIDTH)),
      y: Math.max(0, Math.min(SKETCH_HEIGHT, ((clientY - bounds.top) / height) * SKETCH_HEIGHT)),
    };
  };

  const getEditorPosition = (canvas: HTMLCanvasElement, point: SketchPoint) => {
    const bounds = canvas.getBoundingClientRect();
    return {
      left: canvas.offsetLeft + (point.x / SKETCH_WIDTH) * bounds.width,
      top: canvas.offsetTop + (point.y / SKETCH_HEIGHT) * bounds.height,
    };
  };

  const openTextEditor = (
    canvas: HTMLCanvasElement,
    point: SketchPoint,
    target: PendingText['target'],
    rectangleId?: number,
    maxWidth?: number
  ) => {
    commitPendingText();
    updatePendingText({ target, rectangleId, point, ...getEditorPosition(canvas, point), maxWidth, value: '' });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = getPoint(event);
    if (tool === 'text') {
      openTextEditor(event.currentTarget, point, 'canvas');
      return;
    }

    commitPendingText();
    const id = nextIdRef.current++;
    activePointerRef.current = event.pointerId;
    activeElementRef.current = id;
    activeStartRef.current = point;
    latestPointRef.current = point;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setElements(previous => [
      ...previous,
      tool === 'rectangle'
        ? {
            id,
            kind: 'rectangle',
            start: point,
            end: point,
            color,
            width: strokeWidth,
            textSize: Math.max(32, strokeWidth * 4),
          }
        : tool === 'arrow'
          ? { id, kind: 'arrow', start: point, end: point, color, width: strokeWidth }
          : {
              id,
              kind: 'stroke',
              points: [point],
              color: tool === 'eraser' ? '#ffffff' : color,
              width: tool === 'eraser' ? Math.max(28, strokeWidth * 2.5) : strokeWidth,
            },
    ]);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId || activeElementRef.current === null) return;
    event.preventDefault();
    const point = getPoint(event);
    latestPointRef.current = point;
    const activeId = activeElementRef.current;
    setElements(previous =>
      previous.map(element => {
        if (element.id !== activeId) return element;
        if (element.kind === 'stroke') return { ...element, points: [...element.points, point] };
        if (element.kind === 'rectangle') return { ...element, end: point };
        if (element.kind === 'arrow') return { ...element, end: point };
        return element;
      })
    );
  };

  const finishElement = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    const activeId = activeElementRef.current;
    const start = activeStartRef.current;
    const end = latestPointRef.current;
    activePointerRef.current = null;
    activeElementRef.current = null;
    activeStartRef.current = null;
    latestPointRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (tool === 'rectangle' && activeId !== null && start && end) {
      const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const bounds = event.currentTarget.getBoundingClientRect();
      const displayedWidth = (Math.abs(end.x - start.x) / SKETCH_WIDTH) * bounds.width;
      openTextEditor(event.currentTarget, center, 'rectangle', activeId, Math.max(72, displayedWidth - 12));
    }
  };

  const selectTool = (nextTool: SketchTool) => {
    commitPendingText();
    setTool(nextTool);
  };

  const undo = () => {
    updatePendingText(null);
    setElements(previous => previous.slice(0, -1));
  };

  const clear = () => {
    updatePendingText(null);
    setElements([]);
  };

  const attachSketch = () => {
    commitPendingText();
    const canvas = canvasRef.current;
    if (!canvas || elements.length === 0) return;
    window.requestAnimationFrame(() => onAttach(canvas.toDataURL('image/png')));
  };

  return (
    <div className="bt-sketch-overlay" onPointerDown={event => event.target === event.currentTarget && onClose()}>
      <section className="bt-sketch-editor" role="dialog" aria-modal="true" aria-labelledby="bt-sketch-title">
        <header className="bt-sketch-header">
          <h3 id="bt-sketch-title">Sketch attachment</h3>
          <button type="button" onClick={onClose} aria-label="Close sketch editor" title="Close">
            <FaTimes aria-hidden="true" />
          </button>
        </header>

        <div className="bt-sketch-toolbar" aria-label="Sketch tools">
          <div className="bt-sketch-tool-group" role="group" aria-label="Drawing tool">
            <button
              type="button"
              className={tool === 'pen' ? 'active' : ''}
              onClick={() => selectTool('pen')}
              aria-label="Pen"
              title="Pen"
            >
              <FaPen aria-hidden="true" />
            </button>
            <button
              type="button"
              className={tool === 'eraser' ? 'active' : ''}
              onClick={() => selectTool('eraser')}
              aria-label="Eraser"
              title="Eraser"
            >
              <FaEraser aria-hidden="true" />
            </button>
            <button
              type="button"
              className={tool === 'text' ? 'active' : ''}
              onClick={() => selectTool('text')}
              aria-label="Text"
              title="Text"
            >
              <FaFont aria-hidden="true" />
            </button>
            <button
              type="button"
              className={tool === 'rectangle' ? 'active' : ''}
              onClick={() => selectTool('rectangle')}
              aria-label="Rectangle"
              title="Rectangle"
            >
              <FaRegSquare aria-hidden="true" />
            </button>
            <button
              type="button"
              className={tool === 'arrow' ? 'active' : ''}
              onClick={() => selectTool('arrow')}
              aria-label="Arrow"
              title="Arrow"
            >
              <FaLongArrowAltRight aria-hidden="true" />
            </button>
          </div>

          <div className="bt-sketch-colors" role="group" aria-label="Drawing color">
            {COLORS.map(value => (
              <button
                type="button"
                key={value}
                className={color === value ? 'active' : ''}
                style={{ '--sketch-color': value } as React.CSSProperties}
                onClick={() => setColor(value)}
                aria-label={`Use ${value}`}
                title={value}
              />
            ))}
            <label className="bt-sketch-custom-color" title="Custom color">
              <input
                type="color"
                value={color}
                onChange={event => setColor(event.target.value)}
                aria-label="Custom drawing color"
              />
            </label>
          </div>

          <label className="bt-sketch-width">
            <span>Size</span>
            <input
              type="range"
              min="4"
              max="28"
              step="2"
              value={strokeWidth}
              onChange={event => setStrokeWidth(Number(event.target.value))}
              aria-label="Drawing size"
            />
          </label>

          <div className="bt-sketch-history-actions">
            <button
              type="button"
              onClick={undo}
              disabled={elements.length === 0 && !pendingText}
              aria-label="Undo sketch change"
              title="Undo"
            >
              <FaUndo aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={elements.length === 0 && !pendingText}
              aria-label="Clear sketch"
              title="Clear"
            >
              <FaTrash aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="bt-sketch-canvas-stage">
          <canvas
            ref={canvasRef}
            width={SKETCH_WIDTH}
            height={SKETCH_HEIGHT}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishElement}
            onPointerCancel={finishElement}
            aria-label="Behavior tree sketch canvas"
          />
          {pendingText && (
            <input
              className={`bt-sketch-inline-text ${pendingText.target === 'rectangle' ? 'inside-rectangle' : ''}`}
              style={{ left: pendingText.left, top: pendingText.top, maxWidth: pendingText.maxWidth }}
              value={pendingText.value}
              onChange={event => updatePendingText({ ...pendingText, value: event.target.value })}
              onBlur={commitPendingText}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  commitPendingText();
                }
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  updatePendingText(null);
                }
              }}
              onPointerDown={event => event.stopPropagation()}
              placeholder="Type…"
              aria-label={pendingText.target === 'rectangle' ? 'Rectangle text' : 'Sketch text'}
              autoFocus
            />
          )}
        </div>

        <footer className="bt-sketch-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={attachSketch} disabled={elements.length === 0}>
            <FaCheck aria-hidden="true" />
            Attach sketch
          </button>
        </footer>
      </section>
    </div>
  );
};

export default BehaviorTreeSketchEditor;
