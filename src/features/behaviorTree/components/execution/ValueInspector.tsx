import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiDownload, FiX } from 'react-icons/fi';
import {
  describeImage,
  detectRichValue,
  formatBytes,
  imageSource,
  isImage,
  type EncodedImage,
  type RawImage,
} from '../../execution/richValues';

/** How much of a payload is drawn before the operator asks for more: large results must not swamp the panel. */
export const INSPECTOR_LIMITS = {
  children: 40,
  stringChars: 280,
  depth: 10,
  inlineNumbers: 12,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array);

const entriesOf = (value: unknown): Array<[string, unknown]> =>
  Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'structure_needs_at_least_one_member');

/** The one-line look of a value inside a collapsed row. */
function preview(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[${value.length} item${value.length === 1 ? '' : 's'}]`;
  if (isRecord(value)) {
    const count = entriesOf(value).length;
    return count === 0 ? '{}' : `{${count} field${count === 1 ? '' : 's'}}`;
  }
  return '';
}

const isPrimitive = (value: unknown) => value === null || (typeof value !== 'object' && typeof value !== 'function');

/** A number array short enough to read on one line, e.g. a position or a covariance row. */
const isInlineNumbers = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.length <= INSPECTOR_LIMITS.inlineNumbers
  && value.every(item => typeof item === 'number');

const Primitive: React.FC<{ value: unknown }> = ({ value }) => {
  const [expanded, setExpanded] = useState(false);
  if (value === null) return <span className="bt-value-null">null</span>;
  if (value === undefined) return <span className="bt-value-null">undefined</span>;
  if (typeof value === 'boolean') return <span className={`bt-value-bool ${value ? 'true' : 'false'}`}>{String(value)}</span>;
  if (typeof value === 'number' || typeof value === 'bigint') return <span className="bt-value-number">{String(value)}</span>;
  if (typeof value === 'string') {
    if (value === '') return <span className="bt-value-null">empty text</span>;
    const long = value.length > INSPECTOR_LIMITS.stringChars;
    return (
      <span className="bt-value-string">
        {long && !expanded ? `${value.slice(0, INSPECTOR_LIMITS.stringChars)}…` : value}
        {long && (
          <button type="button" className="bt-value-more" onClick={() => setExpanded(open => !open)}>
            {expanded ? 'Show less' : `Show all ${value.length.toLocaleString()} characters`}
          </button>
        )}
      </span>
    );
  }
  // Functions, symbols: never expected from ROS, but never allowed to break the panel either.
  return <span className="bt-value-null">{String(value)}</span>;
};

export const ImagePreview: React.FC<{ image: RawImage | EncodedImage; label?: string }> = ({ image, label }) => {
  const [enlarged, setEnlarged] = useState(false);
  // Small images are enlarged with visible pixels rather than blurred.
  const [isSmall, setIsSmall] = useState(false);
  const { src, error } = useMemo(() => {
    try {
      return { src: imageSource(image), error: undefined };
    } catch (reason) {
      return { src: undefined, error: reason instanceof Error ? reason.message : 'The image could not be decoded.' };
    }
  }, [image]);

  useEffect(() => {
    if (!enlarged) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setEnlarged(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enlarged]);

  const caption = describeImage(image);
  if (!src) {
    return <div className="bt-image-error" role="note">{error} <span>{caption}</span></div>;
  }
  const name = !label ? 'Image' : /image|img|photo|picture|frame/i.test(label) ? label : `${label} image`;
  return (
    <figure className="bt-image-preview">
      <button type="button" className="bt-image-thumb" onClick={() => setEnlarged(true)} aria-label={`Enlarge ${name}`}>
        <img src={src} alt={name} />
      </button>
      <figcaption>{caption}</figcaption>
      {enlarged && createPortal(
        <div className="bt-image-lightbox" role="dialog" aria-modal="true" aria-label={name} onClick={() => setEnlarged(false)}>
          <div className="bt-image-lightbox-frame" onClick={event => event.stopPropagation()}>
            <div className="bt-image-lightbox-bar">
              <span>{name} · {caption}</span>
              <a href={src} download={`${(label || 'image').replace(/[^\w.-]+/g, '_')}.${image.kind === 'raw-image' ? 'png' : image.mime.split('/')[1]}`} aria-label="Save image">
                <FiDownload aria-hidden="true" />
              </a>
              <button type="button" onClick={() => setEnlarged(false)} aria-label="Close image">
                <FiX aria-hidden="true" />
              </button>
            </div>
            <img
              src={src}
              alt={name}
              className={isSmall ? 'is-small' : undefined}
              onLoad={event => setIsSmall(event.currentTarget.naturalWidth < 480)}
            />
          </div>
        </div>,
        document.body
      )}
    </figure>
  );
};

interface NodeProps {
  name: string;
  value: unknown;
  depth: number;
  /** The objects this value sits inside: a value that is one of them would nest forever. */
  ancestors: readonly unknown[];
  /** Inside an image's own fields: its pixel data is summarised, not previewed a second time. */
  withinImage?: boolean;
}

const Children: React.FC<{ value: unknown; depth: number; ancestors: readonly unknown[]; withinImage?: boolean }> = ({
  value,
  depth,
  ancestors,
  withinImage,
}) => {
  const [shown, setShown] = useState(INSPECTOR_LIMITS.children);
  const entries = entriesOf(value);
  if (entries.length === 0) return <div className="bt-value-empty">No fields</div>;
  return (
    <ul className="bt-value-children">
      {entries.slice(0, shown).map(([key, child]) => (
        <ValueRow key={key} name={key} value={child} depth={depth + 1} ancestors={[...ancestors, value]} withinImage={withinImage} />
      ))}
      {entries.length > shown && (
        <li>
          <button type="button" className="bt-value-more" onClick={() => setShown(count => count + INSPECTOR_LIMITS.children)}>
            Show {Math.min(INSPECTOR_LIMITS.children, entries.length - shown)} more of {entries.length - shown}
          </button>
        </li>
      )}
    </ul>
  );
};

const ValueRow: React.FC<NodeProps> = ({ name, value, depth, ancestors, withinImage }) => {
  // Kept while the value is the same, so an image is decoded once rather than at every render.
  const rich = useMemo(() => detectRichValue(value, name), [name, value]);
  const isContainer = !rich && (Array.isArray(value) || isRecord(value));
  const small = isContainer && entriesOf(value).length <= 4 && entriesOf(value).every(([, child]) => isPrimitive(child));
  const [open, setOpen] = useState(depth <= 1 || small);
  const [showFields, setShowFields] = useState(false);
  const cyclic = typeof value === 'object' && value !== null && ancestors.includes(value);

  if (cyclic) {
    return <li className="bt-value-row"><span className="bt-value-key">{name}:</span><span className="bt-value-null">(repeats an outer value)</span></li>;
  }
  if (isImage(rich) && withinImage) {
    return (
      <li className="bt-value-row">
        <span className="bt-value-key">{name}:</span>
        <span className="bt-value-binary">Image data · {describeImage(rich)}</span>
      </li>
    );
  }
  if (isImage(rich)) {
    return (
      <li className="bt-value-row rich">
        <div className="bt-value-line">
          <span className="bt-value-key">{name}:</span>
          {isRecord(value) && (
            <button type="button" className="bt-value-more" onClick={() => setShowFields(shownFields => !shownFields)}>
              {showFields ? 'Hide fields' : 'Fields'}
            </button>
          )}
        </div>
        <ImagePreview image={rich} label={name} />
        {showFields && <Children value={value} depth={depth} ancestors={ancestors} withinImage />}
      </li>
    );
  }
  if (rich?.kind === 'binary') {
    return (
      <li className="bt-value-row">
        <span className="bt-value-key">{name}:</span>
        <span className="bt-value-binary">Binary data · {formatBytes(rich.byteLength)}</span>
      </li>
    );
  }
  if (isInlineNumbers(value)) {
    return (
      <li className="bt-value-row">
        <span className="bt-value-key">{name}:</span>
        <span className="bt-value-number">[{value.join(', ')}]</span>
      </li>
    );
  }
  if (!isContainer) {
    return (
      <li className="bt-value-row">
        <span className="bt-value-key">{name}:</span>
        <Primitive value={value} />
      </li>
    );
  }
  if (depth > INSPECTOR_LIMITS.depth) {
    return <li className="bt-value-row"><span className="bt-value-key">{name}:</span><span className="bt-value-null">{preview(value)} (nested too deep to show)</span></li>;
  }
  return (
    <li className={`bt-value-row container ${open ? 'open' : ''}`}>
      <button type="button" className="bt-value-toggle" onClick={() => setOpen(isOpen => !isOpen)} aria-expanded={open}>
        <span className="bt-value-caret" aria-hidden="true" />
        <span className="bt-value-key">{name}:</span>
        <span className="bt-value-summary">{preview(value)}</span>
      </button>
      {open && <Children value={value} depth={depth} ancestors={ancestors} />}
    </li>
  );
};

/**
 * Any ROS payload, readable: fields and array items as an expandable tree, text and numbers as they are, images as
 * previews and binary data as its size. Large payloads are shown a page at a time.
 */
const ValueInspector: React.FC<{ value: unknown; label?: string; emptyText?: string }> = ({ value, label, emptyText = 'Nothing returned' }) => {
  const rich = useMemo(() => detectRichValue(value, label), [label, value]);
  if (isImage(rich) || rich?.kind === 'binary' || !(Array.isArray(value) || isRecord(value))) {
    return (
      <ul className="bt-value-tree root-primitive">
        <ValueRow name={label ?? 'value'} value={value} depth={0} ancestors={[]} />
      </ul>
    );
  }
  if (entriesOf(value).length === 0) return <div className="bt-value-empty">{emptyText}</div>;
  return (
    <div className="bt-value-tree">
      <Children value={value} depth={0} ancestors={[]} />
    </div>
  );
};

/** A payload as JSON for the clipboard: byte arrays as base64, as rosbridge would send them. */
export function payloadToJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) => (item instanceof Uint8Array ? `<${item.length} bytes>` : typeof item === 'bigint' ? String(item) : item),
    2
  ) ?? String(value);
}

export default ValueInspector;
