import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BehaviorTreeSketchEditor from './BehaviorTreeSketchEditor';

const canvasContext = {
  save: vi.fn(),
  restore: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  strokeRect: vi.fn(),
  fillText: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  lineCap: 'round',
  lineJoin: 'round',
  font: '',
  textAlign: 'left',
  textBaseline: 'top',
};

describe('BehaviorTreeSketchEditor', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      canvasContext as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,c2tldGNo');
    Object.values(canvasContext).forEach(value => {
      if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws with pointer input and attaches a PNG', async () => {
    const onAttach = vi.fn();
    render(<BehaviorTreeSketchEditor onAttach={onAttach} onClose={vi.fn()} />);
    const canvas = screen.getByLabelText('Behavior tree sketch canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => undefined,
    });

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 180, clientY: 140 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 180, clientY: 140 });
    fireEvent.click(screen.getByRole('button', { name: 'Attach sketch' }));

    expect(canvasContext.stroke).toHaveBeenCalled();
    await waitFor(() => expect(onAttach).toHaveBeenCalledWith('data:image/png;base64,c2tldGNo'));
  });

  it('places text, supports undo, and clears the canvas', async () => {
    render(<BehaviorTreeSketchEditor onAttach={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    fireEvent.pointerDown(screen.getByLabelText('Behavior tree sketch canvas'), {
      pointerId: 2,
      clientX: 100,
      clientY: 80,
    });
    fireEvent.change(screen.getByLabelText('Sketch text'), { target: { value: 'Dock here' } });
    fireEvent.keyDown(screen.getByLabelText('Sketch text'), { key: 'Enter' });

    await waitFor(() =>
      expect(canvasContext.fillText).toHaveBeenCalledWith('Dock here', expect.any(Number), expect.any(Number))
    );
    expect(screen.getByRole('button', { name: 'Attach sketch' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Undo sketch change' }));
    expect(screen.getByRole('button', { name: 'Attach sketch' })).toBeDisabled();

    fireEvent.pointerDown(screen.getByLabelText('Behavior tree sketch canvas'), {
      pointerId: 3,
      clientX: 120,
      clientY: 100,
    });
    fireEvent.change(screen.getByLabelText('Sketch text'), { target: { value: 'Retry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear sketch' }));
    expect(screen.getByRole('button', { name: 'Attach sketch' })).toBeDisabled();
  });

  it('draws a rectangle and places inline text inside it', async () => {
    render(<BehaviorTreeSketchEditor onAttach={vi.fn()} onClose={vi.fn()} />);
    const canvas = screen.getByLabelText('Behavior tree sketch canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    fireEvent.pointerDown(canvas, { pointerId: 4, clientX: 40, clientY: 40 });
    fireEvent.pointerMove(canvas, { pointerId: 4, clientX: 260, clientY: 180 });
    fireEvent.pointerUp(canvas, { pointerId: 4, clientX: 260, clientY: 180 });

    const input = screen.getByLabelText('Rectangle text');
    fireEvent.change(input, { target: { value: 'Recovery' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(canvasContext.strokeRect).toHaveBeenCalled());
    expect(canvasContext.fillText).toHaveBeenCalledWith(
      'Recovery',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('draws an arrow with a directional head', async () => {
    render(<BehaviorTreeSketchEditor onAttach={vi.fn()} onClose={vi.fn()} />);
    const canvas = screen.getByLabelText('Behavior tree sketch canvas');
    fireEvent.click(screen.getByRole('button', { name: 'Arrow' }));
    fireEvent.pointerDown(canvas, { pointerId: 5, clientX: 40, clientY: 60 });
    fireEvent.pointerMove(canvas, { pointerId: 5, clientX: 280, clientY: 180 });
    fireEvent.pointerUp(canvas, { pointerId: 5, clientX: 280, clientY: 180 });

    await waitFor(() => expect(canvasContext.stroke).toHaveBeenCalled());
    expect(canvasContext.moveTo.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(canvasContext.lineTo.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('button', { name: 'Attach sketch' })).toBeEnabled();
  });
});
