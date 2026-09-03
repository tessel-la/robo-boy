import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ContainedSelect.css';

export interface ContainedSelectOption {
  value: string;
  label: string;
  group?: string;
}

interface Props {
  ariaLabel: string;
  value: string;
  options: ContainedSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

const mobileQuery = '(max-width: 600px), (pointer: coarse)';
const VIEWPORT_MARGIN = 8;
const POPOVER_GAP = 4;

export interface VisibleViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const computeContainedSelectFrame = (
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width'>,
  viewport: VisibleViewport
): React.CSSProperties => {
  const viewRight = viewport.left + viewport.width;
  const viewBottom = viewport.top + viewport.height;
  const availableWidth = Math.max(0, viewport.width - VIEWPORT_MARGIN * 2);
  const width = Math.min(Math.max(rect.width, 220), availableWidth);
  const left = Math.min(
    Math.max(rect.left, viewport.left + VIEWPORT_MARGIN),
    Math.max(viewport.left + VIEWPORT_MARGIN, viewRight - width - VIEWPORT_MARGIN)
  );
  const below = Math.max(0, viewBottom - rect.bottom - POPOVER_GAP - VIEWPORT_MARGIN);
  const above = Math.max(0, rect.top - viewport.top - POPOVER_GAP - VIEWPORT_MARGIN);
  const opensBelow = below >= 180 || below >= above;
  const maxHeight = Math.min(300, opensBelow ? below : above);
  const idealTop = opensBelow ? rect.bottom + POPOVER_GAP : rect.top - POPOVER_GAP - maxHeight;
  const top = Math.min(
    Math.max(idealTop, viewport.top + VIEWPORT_MARGIN),
    Math.max(viewport.top + VIEWPORT_MARGIN, viewBottom - maxHeight - VIEWPORT_MARGIN)
  );
  return { left, top, width, maxHeight, visibility: 'visible' };
};

const useContainedMode = () => {
  const [contained, setContained] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(mobileQuery).matches
  ));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(mobileQuery);
    const update = () => setContained(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return contained;
};

const ContainedSelect: React.FC<Props> = ({ ariaLabel, value, options, onChange, disabled = false }) => {
  const contained = useContainedMode();
  const [open, setOpen] = useState(false);
  const [frame, setFrame] = useState<React.CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value);
  const grouped = useMemo(() => {
    const groups = new Map<string, ContainedSelectOption[]>();
    options.forEach(option => {
      const group = option.group || '';
      groups.set(group, [...(groups.get(group) || []), option]);
    });
    return Array.from(groups.entries());
  }, [options]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const visualViewport = window.visualViewport;
      setFrame(computeContainedSelectFrame(rect, {
        left: visualViewport?.offsetLeft ?? 0,
        top: visualViewport?.offsetTop ?? 0,
        width: visualViewport?.width ?? window.innerWidth,
        height: visualViewport?.height ?? window.innerHeight,
      }));
    };
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const visualViewport = window.visualViewport;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('orientationchange', place);
    window.addEventListener('scroll', place, true);
    visualViewport?.addEventListener('resize', place);
    visualViewport?.addEventListener('scroll', place);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('orientationchange', place);
      window.removeEventListener('scroll', place, true);
      visualViewport?.removeEventListener('resize', place);
      visualViewport?.removeEventListener('scroll', place);
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  if (!contained) {
    return (
      <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        {grouped.map(([group, groupOptions]) => group ? (
          <optgroup key={group} label={group}>
            {groupOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </optgroup>
        ) : groupOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>))}
      </select>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="contained-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => { setFrame(null); setOpen(current => !current); }}
      >
        <span>{selected?.label || 'Select…'}</span><i aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          className="contained-select-popover"
          style={frame || { visibility: 'hidden' }}
          role="listbox"
          aria-label={`${ariaLabel} options`}
        >
          {grouped.map(([group, groupOptions]) => (
            <React.Fragment key={group || 'options'}>
              {group && <div className="contained-select-group">{group}</div>}
              {groupOptions.map(option => (
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={option.value === value ? 'selected' : ''}
                  key={option.value}
                  onClick={() => { onChange(option.value); setOpen(false); triggerRef.current?.focus(); }}
                >{option.label}</button>
              ))}
            </React.Fragment>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

export default ContainedSelect;
