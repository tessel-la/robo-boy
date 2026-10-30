import { useEffect, useId, useRef, useState } from 'react';
import { FiCheck, FiChevronDown } from 'react-icons/fi';

interface Props {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; detail?: string }>;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** Source names wrap in both the selection and its searchable choices. */
export default function SourcePicker({ label, value, options, onChange, placeholder = 'Choose a signal…' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const choicesId = useId();
  const selected = options.find(option => option.value === value);
  const matches = options.filter(option =>
    `${option.label} ${option.detail ?? ''}`.toLowerCase().includes(query.toLowerCase())
  );
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div
      ref={root}
      className="timeseries-source-picker"
      onBlur={event => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <span className="timeseries-source-label">{label}</span>
      <button
        ref={trigger}
        type="button"
        className="timeseries-source-trigger"
        aria-label={label}
        aria-describedby={`${choicesId}-selection`}
        aria-expanded={open}
        aria-controls={open ? choicesId : undefined}
        onClick={() => {
          setQuery('');
          setOpen(!open);
        }}
      >
        <span id={`${choicesId}-selection`}>
          <span>{selected?.label ?? placeholder}</span>
          {selected?.detail && <small>{selected.detail}</small>}
        </span>
        <FiChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div id={choicesId} className="timeseries-source-choices" role="group" aria-label={`${label} choices`}>
          <input
            ref={search}
            type="search"
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder="Filter by name or topic…"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <div className="timeseries-source-results">
            {matches.map(option => (
              <button
                key={option.value}
                type="button"
                aria-pressed={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                <span>
                  <span>{option.label}</span>
                  {option.detail && <small>{option.detail}</small>}
                </span>
                {option.value === value && <FiCheck aria-hidden="true" />}
              </button>
            ))}
            {!matches.length && <p role="status">No matching sources.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
