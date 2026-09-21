import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Vector2 } from 'three';
import { activateDomTarget } from './domInteraction';

afterEach(() => vi.restoreAllMocks());

it('sends exactly one bubbling click to the React control, without a held robot command', () => {
  const click = vi.fn();
  const press = vi.fn();
  const { container } = render(<button onClick={click} onMouseDown={press}><span>Run</span></button>);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, writable: true, value: vi.fn(() => screen.getByText('Run')) });
  activateDomTarget(container, new Vector2(0.5, 0.5));
  expect(click).toHaveBeenCalledOnce();
  expect(press).not.toHaveBeenCalled();
});

it('does not replay into another panel or a disabled control', () => {
  const click = vi.fn();
  const { container } = render(<button disabled onClick={click}>Run</button>);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, writable: true, value: vi.fn(() => screen.getByText('Run')) });
  activateDomTarget(container, new Vector2(0.5, 0.5));
  expect(click).not.toHaveBeenCalled();
  document.elementFromPoint = vi.fn(() => document.body);
  activateDomTarget(container, new Vector2(0.5, 0.5));
  expect(click).not.toHaveBeenCalled();
});
