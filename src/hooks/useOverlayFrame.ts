import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { clampOverlayFrame, type OverlayFrame } from '../utils/jointStates';

/** An overlay lives inside its 3D panel, rather than in window coordinates. */
export function useOverlayFrame(
  container: RefObject<HTMLDivElement | null>,
  saved: OverlayFrame | undefined,
  onSave: (frame: OverlayFrame) => void
) {
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<OverlayFrame>();
  const gesture = useRef<{
    id: number;
    target: HTMLElement;
    x: number;
    y: number;
    frame: OverlayFrame;
    resize: boolean;
  }>();
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const update = () => setBounds({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);
  useEffect(() => setDraft(undefined), [saved]);
  useEffect(
    () => () => {
      const current = gesture.current;
      if (current?.target.hasPointerCapture?.(current.id)) current.target.releasePointerCapture(current.id);
    },
    []
  );
  const frame = clampOverlayFrame(draft ?? saved, bounds.width, bounds.height);
  const clamp = (value: OverlayFrame) => clampOverlayFrame(value, bounds.width, bounds.height);
  const start = (event: PointerEvent<HTMLElement>, resize: boolean) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      id: event.pointerId,
      target: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      frame,
      resize,
    };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.id) return;
    const dx = event.clientX - current.x,
      dy = event.clientY - current.y;
    setDraft(
      clamp(
        current.resize
          ? { ...current.frame, width: current.frame.width + dx, height: current.frame.height + dy }
          : { ...current.frame, left: current.frame.left + dx, top: current.frame.top + dy }
      )
    );
  };
  const end = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.id) return;
    gesture.current = undefined;
    if (current.target.hasPointerCapture(event.pointerId)) current.target.releasePointerCapture(event.pointerId);
    onSave(frame);
    setDraft(undefined);
  };
  return { frame, start, move, end, change: (value: OverlayFrame) => onSave(clamp(value)) };
}
