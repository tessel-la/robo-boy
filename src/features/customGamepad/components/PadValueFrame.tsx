import React from 'react';
import type { StateTone, ValueLevel } from '../padValues';
import './DataDisplayComponents.css';

interface PadValueFrameProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The component type, as the `pad-<kind>` class. */
  kind: string;
  label?: string;
  /** Shown at the end of the label row: a reading, a count, a delivery status. */
  aside?: React.ReactNode;
  level?: ValueLevel;
  tone?: StateTone;
  /** Why there is no value to show; laid over the component. */
  notice?: string;
  /** Set once the value has gone without an update for too long: the value dims and says so. */
  staleFor?: string;
  children: React.ReactNode;
}

/**
 * The frame every value component shares: its label row, its body, the notice that replaces a missing value and the
 * badge of a stale one. It sizes its contents from its own box (a CSS size container), so a component reads the same
 * at any size the grid gives it.
 */
const PadValueFrame: React.FC<PadValueFrameProps> = ({
  kind,
  label,
  aside,
  level = 'normal',
  tone,
  notice,
  staleFor,
  className,
  children,
  ...rest
}) => (
  <div
    className={[
      'data-display-component pad-value',
      `pad-${kind}`,
      `level-${level}`,
      tone ? `tone-${tone}` : '',
      staleFor ? 'is-stale' : '',
      className ?? '',
    ].filter(Boolean).join(' ')}
    {...rest}
  >
    {(label || aside || staleFor) && (
      <div className="pad-value-header">
        {label && <span className="pad-value-label" title={label}>{label}</span>}
        {(aside || staleFor) && (
          <span className="pad-value-aside">
            {staleFor && <span className="pad-value-stale" title={staleFor} aria-label={staleFor}>Stale</span>}
            {aside}
          </span>
        )}
      </div>
    )}
    <div className="pad-value-body">{children}</div>
    {notice && <div className="data-display-status pad-value-notice">{notice}</div>}
  </div>
);

export default PadValueFrame;
