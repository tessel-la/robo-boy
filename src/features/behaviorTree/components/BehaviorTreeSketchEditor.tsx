import React, { useEffect, useRef, useState } from 'react';
import { FaCheck, FaEraser, FaFont, FaPen, FaTimes, FaTrash, FaUndo } from 'react-icons/fa';
import './BehaviorTreeSketchEditor.css';

const SKETCH_WIDTH = 1200;
const SKETCH_HEIGHT = 800;
const COLORS = ['#16181d', '#2563eb', '#dc2626', '#f2b705', '#16a34a'];

type SketchTool = 'pen' | 'eraser' | 'text';
type SketchPoint = { x: number; y: number };
type SketchElement =
  | { id: number; kind: 'stroke'; points: SketchPoint[]; color: string; width: number }
  | { id: number; kind: 'text'; point: SketchPoint; color: string; size: number; value: string };

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
      context.textBaseline = 'top';
      context.fillText(element.value, element.point.x, element.point.y);
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
  const nextIdRef = useRef(1);
  const [tool, setTool] = useState<SketchTool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(10);
  const [textValue, setTextValue] = useState('');
  const [elements, setElements] = useState<SketchElement[]>([]);

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (context) drawSketch(context, elements);
  }, [elements]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
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
    return {
      x: Math.max(0, Math.min(SKETCH_WIDTH, ((event.clientX - bounds.left) / width) * SKETCH_WIDTH)),
      y: Math.max(0, Math.min(SKETCH_HEIGHT, ((event.clientY - bounds.top) / height) * SKETCH_HEIGHT)),
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = getPoint(event);
    if (tool === 'text') {
      const value = textValue.trim();
      if (!value) return;
      setElements(previous => [
        ...previous,
        { id: nextIdRef.current++, kind: 'text', point, color, size: Math.max(32, strokeWidth * 4), value },
      ]);
      setTextValue('');
      return;
    }

    const id = nextIdRef.current++;
    activePointerRef.current = event.pointerId;
    activeElementRef.current = id;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setElements(previous => [
      ...previous,
      {
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
    const activeId = activeElementRef.current;
    setElements(previous =>
      previous.map(element =>
        element.id === activeId && element.kind === 'stroke'
          ? { ...element, points: [...element.points, point] }
          : element
      )
    );
  };

  const finishStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    activeElementRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const attachSketch = () => {
    const canvas = canvasRef.current;
    if (!canvas || elements.length === 0) return;
    onAttach(canvas.toDataURL('image/png'));
  };

  return (
    <div className="bt-sketch-overlay" onPointerDown={event => event.target === event.currentTarget && onClose()}>
      <section
        className={`bt-sketch-editor${tool === 'text' ? ' has-text-tool' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bt-sketch-title"
      >
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
              onClick={() => setTool('pen')}
              aria-label="Pen"
              title="Pen"
            >
              <FaPen aria-hidden="true" />
            </button>
            <button
              type="button"
              className={tool === 'eraser' ? 'active' : ''}
              onClick={() => setTool('eraser')}
              aria-label="Eraser"
              title="Eraser"
            >
              <FaEraser aria-hidden="true" />
            </button>
            <button
              type="button"
              className={tool === 'text' ? 'active' : ''}
              onClick={() => setTool('text')}
              aria-label="Text"
              title="Text"
            >
              <FaFont aria-hidden="true" />
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
              onClick={() => setElements(previous => previous.slice(0, -1))}
              disabled={elements.length === 0}
              aria-label="Undo sketch change"
              title="Undo"
            >
              <FaUndo aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setElements([])}
              disabled={elements.length === 0}
              aria-label="Clear sketch"
              title="Clear"
            >
              <FaTrash aria-hidden="true" />
            </button>
          </div>
        </div>

        {tool === 'text' && (
          <input
            className="bt-sketch-text-input"
            value={textValue}
            onChange={event => setTextValue(event.target.value)}
            placeholder="Type text, then tap the canvas"
            aria-label="Sketch text"
            autoFocus
          />
        )}

        <div className="bt-sketch-canvas-stage">
          <canvas
            ref={canvasRef}
            width={SKETCH_WIDTH}
            height={SKETCH_HEIGHT}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            aria-label="Behavior tree sketch canvas"
          />
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
