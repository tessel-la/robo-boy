import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const [frame, setFrame] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(option => option.value === value);
  const grouped = useMemo(() => {
    const groups = new Map<string, ContainedSelectOption[]>();
    options.forEach(option => {
      const group = option.group || '';
      groups.set(group, [...(groups.get(group) || []), option]);
    });
    return Array.from(groups.entries());
  }, [options]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const width = Math.min(Math.max(rect.width, 220), window.innerWidth - margin * 2);
      const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin);
      const below = window.innerHeight - rect.bottom - margin;
      const above = rect.top - margin;
      const opensBelow = below >= 180 || below >= above;
      const maxHeight = Math.max(120, Math.min(300, opensBelow ? below : above));
      setFrame(opensBelow
        ? { left, top: rect.bottom + 4, width, maxHeight }
        : { left, bottom: window.innerHeight - rect.top + 4, width, maxHeight });
    };
    const close = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', close);
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
        onClick={() => setOpen(current => !current)}
      >
        <span>{selected?.label || 'Select…'}</span><i aria-hidden="true" />
      </button>
      {open && createPortal(
        <div className="contained-select-popover" style={frame} role="listbox" aria-label={`${ariaLabel} options`}>
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
