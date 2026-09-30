import { useState } from 'react';
import { FiCopy, FiTrendingUp } from 'react-icons/fi';

interface Props {
  value: unknown;
  previous?: unknown;
  path?: string;
  name?: string;
  /** Shows only fields whose path contains this text, with their parents opened. */
  query?: string;
  onPlot?: (path: string) => void;
  onCopy: (text: string) => void;
  depth?: number;
}

const childPath = (parent: unknown, path: string, key: string) =>
  Array.isArray(parent) ? `${path}[${key}]` : path ? `${path}.${key}` : key;

/** Whether this field or anything below it matches. Previews are already bounded, so this stays cheap. */
export const matchesField = (value: unknown, path: string, query: string): boolean => {
  if (!query || path.toLowerCase().includes(query)) return true;
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => matchesField(item, childPath(value, path, key), query));
};

export default function ValueTree({
  value,
  previous,
  path = '',
  name = 'Message',
  query = '',
  onPlot,
  onCopy,
  depth = 0,
}: Props) {
  const [open, setOpen] = useState(depth === 0);
  const wanted = query.trim().toLowerCase();
  const compound = value !== null && typeof value === 'object';
  const entries = compound
    ? Object.entries(value).filter(([key, item]) => matchesField(item, childPath(value, path, key), wanted))
    : [];
  const expanded = open || Boolean(wanted);
  const previousObject = previous && typeof previous === 'object' ? (previous as Record<string, unknown>) : {};
  // Previews use prototype-less objects (safe for any key), which String() cannot convert: only leaves are text.
  const text = compound ? '' : typeof value === 'string' ? value : String(value);
  const changed = previous !== undefined && !compound && value !== previous;
  return (
    <div className={`de-value-node${changed ? ' is-changed' : ''}`}>
      <div className="de-value-line">
        {compound ? (
          <button className="de-value-expand" aria-expanded={expanded} onClick={() => setOpen(!open)}>
            <span>{expanded ? '▾' : '▸'}</span>
            <strong>{name}</strong>
            <small>{Array.isArray(value) ? `[${Object.keys(value).length}]` : `{${Object.keys(value).length}}`}</small>
          </button>
        ) : (
          <>
            <strong title={path}>{name}</strong>
            <span className={`de-value-${typeof value}`} title={text}>
              {text}
            </span>
          </>
        )}
        {path && (
          <div className="de-field-actions">
            <button aria-label={`Copy path ${path}`} title="Copy field path" onClick={() => onCopy(path)}>
              <FiCopy />
            </button>
            {typeof value === 'number' && Number.isFinite(value) && onPlot && (
              <button aria-label={`Plot ${path}`} title="Plot in Time Series" onClick={() => onPlot(path)}>
                <FiTrendingUp />
              </button>
            )}
          </div>
        )}
      </div>
      {compound && expanded && (
        <div className="de-value-children">
          {depth === 0 && wanted && !entries.length && <p className="de-muted">No field matches “{query}”.</p>}
          {entries.map(([key, item]) => (
            <ValueTree
              key={key}
              name={key}
              path={childPath(value, path, key)}
              value={item}
              previous={previousObject[key]}
              query={query}
              onCopy={onCopy}
              onPlot={onPlot}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
