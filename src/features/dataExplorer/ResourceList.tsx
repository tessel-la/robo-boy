import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { FiAlertTriangle, FiCheck, FiCopy, FiDisc, FiEye, FiEyeOff, FiHeart, FiStar, FiX } from 'react-icons/fi';
import { COLUMN_MAX, COLUMN_MIN } from './model';
import type { ExplorerColumn, ExplorerConfig, Resource } from './types';

export const ROW_HEIGHT = 58;

export interface ListCell {
  column: ExplorerColumn;
  /** Short heading (fits a phone); the title explains it. */
  label: string;
  title: string;
}

export interface ListColumns {
  /** Number columns after the name, left to right. Rates only exist for topics. */
  cells: ListCell[];
  /** Icon slots at the end of each row (topics only). */
  actionSlots: number;
}

interface Props {
  resources: Resource[];
  config: ExplorerConfig;
  columns: ListColumns;
  loadingText: string;
  checked: ReadonlySet<string>;
  ruleIssues: (resource: Resource) => string[];
  value: (resource: Resource, column: ExplorerColumn) => { text: string; title?: string; trend?: number[] };
  actions: (resource: Resource) => ReactNode;
  onSelect: (id: string) => void;
  onCheck: (ids: string[], checked: boolean) => void;
  onSort: (column: ExplorerConfig['sort']) => void;
  onResize: (columns: ExplorerConfig['columns']) => void;
  bulk: ReactNode;
  renderSparkline: (points: number[], label: string) => ReactNode;
}

const clampWidth = (value: number) => Math.round(Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, value)));

/** A heading cell that sorts on click and, except for the name, resizes from its left edge. */
function Heading({
  label,
  description,
  column,
  config,
  onSort,
  resize,
}: {
  label: string;
  /** What the column holds, shown as a tooltip since headings are kept short. */
  description?: string;
  column: ExplorerConfig['sort'];
  config: ExplorerConfig;
  onSort: (column: ExplorerConfig['sort']) => void;
  resize?: { value: number; onDrag: (width: number) => void; onDone: (width: number) => void };
}) {
  const active = config.sort === column;
  const start = useRef<{ x: number; width: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const drag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!resize) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width: resize.value };
  };
  const move = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!resize || !start.current) return;
    // Dragging the left edge left widens the column.
    const width = clampWidth(start.current.width + start.current.x - event.clientX);
    setLive(width);
    resize.onDrag(width);
  };
  const end = () => {
    if (!resize || !start.current) return;
    start.current = null;
    if (live != null) resize.onDone(live);
    setLive(null);
  };
  return (
    <span
      className={`de-heading-cell${active ? ' is-sorted' : ''}`}
      role="columnheader"
      aria-sort={active ? (config.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {resize && (
        <span
          className="de-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label} column`}
          aria-valuemin={COLUMN_MIN}
          aria-valuemax={COLUMN_MAX}
          aria-valuenow={resize.value}
          tabIndex={0}
          onPointerDown={drag}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={event => {
            const step = event.shiftKey ? 24 : 8;
            if (event.key === 'ArrowLeft') resize.onDone(clampWidth(resize.value + step));
            else if (event.key === 'ArrowRight') resize.onDone(clampWidth(resize.value - step));
            else return;
            event.preventDefault();
          }}
        />
      )}
      <button
        type="button"
        onClick={() => onSort(column)}
        title={`${description ?? label}. Sort${active ? (config.sortDir === 'asc' ? ' descending' : ' ascending') : ''}`}
        aria-label={`Sort by ${description ?? label}`}
      >
        <span>{label}</span>
        <span className="de-sort-mark" aria-hidden="true">
          {active ? (config.sortDir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </span>
  );
}

/**
 * The virtualized resource table: sortable, resizable columns, multi-selection and per-topic
 * actions. Row order only changes when the user sorts, so rows do not move while being read.
 */
export default function ResourceList({
  resources,
  config,
  columns,
  loadingText,
  checked,
  ruleIssues,
  value,
  actions,
  onSelect,
  onCheck,
  onSort,
  onResize,
  bulk,
  renderSparkline,
}: Props) {
  const list = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [widths, setWidths] = useState(config.columns);
  const anchor = useRef<number | null>(null);
  useEffect(() => setWidths(config.columns), [config.columns]);
  useEffect(() => {
    const node = list.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setHeight(node.clientHeight || 400));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setScrollTop(0);
    list.current?.scrollTo({ top: 0 });
  }, [config.kind, config.query]);
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4);
  const last = Math.min(resources.length, first + Math.ceil(height / ROW_HEIGHT) + 8);
  const allChecked = resources.length > 0 && resources.every(resource => checked.has(resource.id));
  const someChecked = !allChecked && resources.some(resource => checked.has(resource.id));
  // Every number column is capped on narrow tiles (--de-col-cap) so the name keeps some room.
  const style = {
    '--de-data-columns': columns.cells.map(cell => `min(${widths[cell.column]}px, var(--de-col-cap, 999px))`).join(' '),
    '--de-action-slots': columns.actionSlots,
  } as CSSProperties;
  return (
    <div className="de-resource-list" data-actions={columns.actionSlots > 0} style={style}>
      {bulk}
      <div ref={list} className="de-list-scroll" onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
        {/* Inside the scroll area (sticky), so it has exactly the rows' width whatever the scrollbar. */}
        <div className="de-table-heading" role="row">
          <span className="de-check-cell" role="columnheader">
            <input
              type="checkbox"
              aria-label={allChecked ? 'Clear selection' : 'Select all shown'}
              checked={allChecked}
              ref={input => {
                if (input) input.indeterminate = someChecked;
              }}
              onChange={() =>
                onCheck(
                  resources.map(resource => resource.id),
                  !allChecked
                )
              }
            />
          </span>
          <Heading label="Name" column="name" config={config} onSort={onSort} />
          {columns.cells.map(cell => (
            <Heading
              key={cell.column}
              label={cell.label}
              description={cell.title}
              column={cell.column}
              config={config}
              onSort={onSort}
              resize={{
                value: widths[cell.column],
                onDrag: width => setWidths(current => ({ ...current, [cell.column]: width })),
                onDone: width => onResize({ ...config.columns, [cell.column]: width }),
              }}
            />
          ))}
          {columns.actionSlots > 0 && (
            <span className="de-actions-heading" role="columnheader">
              Actions
            </span>
          )}
        </div>
        {!resources.length && <p className="de-empty">{loadingText}</p>}
        <div style={{ height: resources.length * ROW_HEIGHT, position: 'relative' }}>
          {resources.slice(first, last).map((resource, offset) => {
            const index = first + offset;
            const issues = ruleIssues(resource);
            const isChecked = checked.has(resource.id);
            return (
              <div
                key={resource.id}
                className={`de-resource-row${config.selected === resource.id ? ' is-selected' : ''}${isChecked ? ' is-checked' : ''}${issues.length ? ' has-warning' : ''}`}
                style={{ top: index * ROW_HEIGHT }}
              >
                <label className="de-check-cell">
                  <input
                    type="checkbox"
                    aria-label={`Select ${resource.name}`}
                    checked={isChecked}
                    onChange={() => undefined}
                    onClick={event => {
                      // Shift-click selects the range from the last clicked row.
                      if (event.shiftKey && anchor.current != null) {
                        const [from, to] = [anchor.current, index].sort((a, b) => a - b);
                        onCheck(
                          resources.slice(from, to + 1).map(item => item.id),
                          !isChecked
                        );
                      } else onCheck([resource.id], !isChecked);
                      anchor.current = index;
                    }}
                  />
                </label>
                <button className="de-resource-main" onClick={() => onSelect(resource.id)}>
                  <span className="de-name-cell">
                    <strong title={resource.name}>
                      {issues.length > 0 && (
                        <span
                          className="de-row-warning"
                          role="img"
                          aria-label="Health rule violated"
                          title={issues.join('\n')}
                        >
                          <FiAlertTriangle aria-hidden="true" />
                        </span>
                      )}
                      {config.pinned.includes(resource.id) && <FiStar className="de-pinned-mark" aria-label="Pinned" />}
                      {resource.name}
                    </strong>
                    <small>
                      {resource.types.join(', ') || (resource.kind === 'node' ? 'ROS node' : 'Type unavailable')}
                    </small>
                  </span>
                  {columns.cells.map(cell => {
                    const shown = value(resource, cell.column);
                    return (
                      <span
                        key={cell.column}
                        className={cell.column === 'rate' ? 'de-rate' : 'de-count'}
                        title={shown.title}
                      >
                        <span>{shown.text}</span>
                        {shown.trend &&
                          shown.trend.length > 1 &&
                          renderSparkline(shown.trend, `${resource.name} frequency trend`)}
                      </span>
                    );
                  })}
                </button>
                {columns.actionSlots > 0 && actions(resource)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The bar shown while rows are checked: bulk actions that make sense for the checked kind. */
export function BulkBar({
  count,
  topics,
  replay,
  allPinned,
  allWatched,
  onWatch,
  onRecord,
  onRules,
  onPin,
  onCopy,
  onClear,
}: {
  count: number;
  topics: boolean;
  replay: boolean;
  allPinned: boolean;
  /** Every checked topic is watched already, so the button stops watching them. */
  allWatched: boolean;
  onWatch: () => void;
  onRecord: () => void;
  onRules: () => void;
  onPin: () => void;
  onCopy: () => void;
  onClear: () => void;
}) {
  if (!count) return null;
  return (
    <div className="de-bulk-bar" role="toolbar" aria-label="Selected resources">
      <span className="de-bulk-count">
        <FiCheck aria-hidden="true" />
        {count} selected
      </span>
      {topics && !replay && (
        <>
          <button
            onClick={onWatch}
            aria-pressed={allWatched}
            title={allWatched ? 'Stop watching the selected topics' : 'Watch traffic of the selected topics'}
            aria-label={allWatched ? 'Stop watching the selected topics' : 'Watch traffic of the selected topics'}
          >
            {allWatched ? <FiEyeOff /> : <FiEye />}
            <span>{allWatched ? 'Unwatch' : 'Watch'}</span>
          </button>
          <button
            onClick={onRecord}
            title="Open recording settings with the selected topics"
            aria-label="Open recording settings with the selected topics"
          >
            <FiDisc />
            <span>Record</span>
          </button>
          <button
            onClick={onRules}
            title="Add a health rule to each selected topic"
            aria-label="Add a health rule to each selected topic"
          >
            <FiHeart />
            <span>Rules</span>
          </button>
        </>
      )}
      <button
        onClick={onPin}
        title={allPinned ? 'Unpin the selected resources' : 'Pin the selected resources'}
        aria-label={allPinned ? 'Unpin the selected resources' : 'Pin the selected resources'}
      >
        <FiStar />
        <span>{allPinned ? 'Unpin' : 'Pin'}</span>
      </button>
      <button onClick={onCopy} title="Copy the selected names" aria-label="Copy the selected names">
        <FiCopy />
        <span>Copy</span>
      </button>
      <button className="de-bulk-clear" onClick={onClear} aria-label="Clear selection" title="Clear selection">
        <FiX />
      </button>
    </div>
  );
}
