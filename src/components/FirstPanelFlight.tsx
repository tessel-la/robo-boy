import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './FirstPanelFlight.css';

export interface FlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const FLIGHT_MS = 720;
/** The part of the flight after which the circle is at the button and only shrinks into it. */
export const ARRIVAL = 0.84;
const ROUNDED = 0.2;

const center = (rect: FlightRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The first panel's button, rounding into a circle and gliding into the toolbar's add button along a
 * gentle curve (the two buttons are often stacked straight above each other, and a straight line
 * reads as a slide rather than a move), then shrinking into it.
 */
export function flightKeyframes(from: FlightRect, to: FlightRect): Keyframe[] {
  const a = center(from), b = center(to);
  const round = from.height;
  const small = Math.max(to.width, to.height) * 0.8;
  const bulge = (b.x >= a.x ? -1 : 1) * Math.min(80, Math.max(40, Math.abs(a.y - b.y) * 0.2));
  const control = { x: (a.x + b.x) / 2 + bulge, y: (a.y + b.y) / 2 };
  // Every frame names its opacity: a property left to the first and last frames alone would be
  // eased across the whole flight with the first segment's curve, and fade out early.
  const box = (x: number, y: number, width: number, height: number, extra: Keyframe = {}): Keyframe => ({
    transform: `translate(${x - width / 2}px, ${y - height / 2}px)`, width: `${width}px`, height: `${height}px`, opacity: 1, ...extra,
  });
  const path: Keyframe[] = [];
  for (let step = 1; step <= 8; step++) {
    const t = easeInOut(step / 8), u = 1 - t;
    const size = round + (small - round) * t;
    path.push(box(u * u * a.x + 2 * u * t * control.x + t * t * b.x, u * u * a.y + 2 * u * t * control.y + t * t * b.y, size, size,
      { offset: ROUNDED + (ARRIVAL - ROUNDED) * (step / 8), borderRadius: '50%', ...(step === 8 ? { easing: 'ease-in' } : {}) }));
  }
  return [
    box(a.x, a.y, from.width, from.height, { offset: 0, borderRadius: '7px', easing: 'ease-out' }),
    box(a.x, a.y, round, round, { offset: ROUNDED, borderRadius: '50%' }),
    ...path,
    box(b.x, b.y, small * 0.5, small * 0.5, { offset: 1, borderRadius: '50%', opacity: 0 }),
  ];
}

interface Props {
  from: FlightRect;
  to: FlightRect;
  icon: ReactNode;
  label: string;
  /** The circle reached the button. */
  onArrive: () => void;
  /** The circle has sunk into the button; the overlay can go. */
  onDone: () => void;
}

export default function FirstPanelFlight({ from, to, icon, label, onArrive, onDone }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const callbacks = useRef({ onArrive, onDone });
  callbacks.current = { onArrive, onDone };

  useLayoutEffect(() => {
    const element = body.current;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!element || typeof element.animate !== 'function' || reduced) {
      callbacks.current.onArrive();
      callbacks.current.onDone();
      return;
    }
    const timing = { duration: FLIGHT_MS, fill: 'forwards' as const };
    const flight = element.animate(flightKeyframes(from, to), timing);
    const width = text.current?.offsetWidth ?? 0;
    const label = text.current?.animate([
      { opacity: 1, maxWidth: `${width}px`, marginLeft: '8px' },
      { offset: ROUNDED, opacity: 0, maxWidth: '0px', marginLeft: '0px' },
      { opacity: 0, maxWidth: '0px', marginLeft: '0px' },
    ], timing);
    let arrived = false;
    const arrive = () => { if (!arrived) { arrived = true; callbacks.current.onArrive(); } };
    const timer = setTimeout(arrive, FLIGHT_MS * ARRIVAL);
    flight.onfinish = () => { arrive(); callbacks.current.onDone(); };
    return () => { clearTimeout(timer); flight.cancel(); label?.cancel(); };
  }, [from, to]);

  return createPortal(
    <div className="first-panel-flight" ref={body} aria-hidden="true">
      <span className="first-panel-flight-glyph">{icon}</span>
      <span className="first-panel-flight-label" ref={text}>{label}</span>
    </div>,
    document.body,
  );
}
