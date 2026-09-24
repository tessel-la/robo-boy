import { useEffect, useId, useRef, useState } from 'react';
import { FiCheck, FiChevronUp, FiX } from 'react-icons/fi';
import { displayName, type TimeseriesSeriesConfig } from './config';

interface Props {
  series: TimeseriesSeriesConfig[];
  values: Record<string, string>;
  onToggle: (id: string) => void;
}

export default function TimeSeriesLegend({ series, values, onToggle }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const id = useId();
  const compact = series.length > 3;
  const open = compact && expanded;
  const visible = series.filter(s => s.enabled);
  const close = () => {
    setExpanded(false);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    picker.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const signalButton = (s: TimeseriesSeriesConfig, switcher = false) => (
    <button
      key={s.id}
      className="timeseries-legend-signal"
      aria-pressed={s.enabled}
      aria-label={displayName(s)}
      onClick={() => onToggle(s.id)}
      title={`${displayName(s)} · ${values[s.id] ?? '—'}`}
    >
      <i style={{ background: s.color }} aria-hidden="true" />
      <span>{displayName(s)}</span>
      <strong>{values[s.id] ?? '—'}</strong>
      {switcher && (
        <span className="timeseries-signal-switch" aria-hidden="true">
          <span>
            <FiCheck />
          </span>
        </span>
      )}
    </button>
  );

  if (!series.length) return null;
  const matches = series.filter(s => `${displayName(s)} ${s.topic}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="timeseries-legend" aria-label="Signal visibility and values" ref={root}>
      {compact ? (
        <button
          className="timeseries-legend-trigger"
          ref={trigger}
          aria-label="Switch signals"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setQuery('');
            setExpanded(!open);
          }}
        >
          <span className="timeseries-legend-dots" aria-hidden="true">
            {visible.slice(0, 3).map(s => (
              <i key={s.id} style={{ background: s.color }} />
            ))}
          </span>
          <span>
            {visible.length} / {series.length} visible
          </span>
          <FiChevronUp aria-hidden="true" />
        </button>
      ) : (
        series.map(s => signalButton(s))
      )}
      {open && (
        <div
          id={id}
          ref={picker}
          tabIndex={-1}
          className="timeseries-signal-picker"
          role="group"
          aria-label="Switch signals"
        >
          <header>
            <div>
              <strong>Switch signals</strong>
              <span>Tap to show or hide</span>
            </div>
            <button className="timeseries-icon-button" aria-label="Close signal switcher" onClick={close}>
              <FiX aria-hidden="true" />
            </button>
          </header>
          <input
            type="search"
            aria-label="Find selected signals"
            placeholder="Find a signal…"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <div className="timeseries-signal-list">
            {matches.map(s => signalButton(s, true))}
            {!matches.length && <p role="status">No matching signals. Try another name.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
