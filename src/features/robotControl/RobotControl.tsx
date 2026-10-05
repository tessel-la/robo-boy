import { useState, useSyncExternalStore } from 'react';
import type { Ros } from 'roslib';
import { controlSessionFor } from './ControlSession';
import './RobotControl.css';

const emptySubscribe = () => () => {};
const emptySnapshot = () => null;

export function RobotControl({ ros }: { ros: Ros | null }) {
  const session = controlSessionFor(ros);
  const status = useSyncExternalStore(session?.subscribe ?? emptySubscribe, session?.getSnapshot ?? emptySnapshot);
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  if (!ros) return null;
  const owned = Boolean(status?.owner === status?.selfId && status?.token);
  const description = !status
    ? 'Control gateway unavailable — commands are disabled. Update the ROS stack.'
    : !status.ready
      ? 'Waiting for behavior-tree runner status.'
      : status.state === 'blocked' || status.state === 'draining'
        ? status.reason
        : owned && status.managing
          ? status.reason
          : owned
            ? `You have control${status.pending ? ` · ${status.pending} running request(s)` : ''}`
            : status.owner
              ? `Read-only · ${status.ownerLabel} has control`
              : 'Read-only · Control available';
  const others = status?.clients.filter(client => client.id !== status.selfId) ?? [];
  return (
    <details className={`robot-control ${owned ? 'has-control' : ''}`}>
      <summary aria-label={`Robot control: ${description}`} title={status?.error || description}>
        <span role="status" aria-live="polite">
          {status?.error
            ? `Command blocked: ${status.error}`
            : status?.state === 'blocked'
              ? 'Control blocked'
              : status?.state === 'draining'
                ? 'Finishing work'
                : owned
                  ? 'Control: you'
                  : status?.owner
                    ? `Control: ${status.ownerLabel}`
                    : 'Read-only'}
        </span>
      </summary>
      <div className="robot-control-popover">
        <p role="status" aria-live="polite">
          {description}
        </p>
        {status?.error && <p role="alert">{status.error}</p>}
        {status?.reason && status.reason !== description && <p>{status.reason}</p>}
        <label>
          Session name
          <input value={label} maxLength={64} onChange={event => setLabel(event.target.value)} />
        </label>
        <button
          type="button"
          disabled={!status || !label.trim()}
          onClick={() => session?.command('identify', { label })}
        >
          Set name
        </button>
        {owned ? (
          <>
            <button type="button" onClick={() => session?.command('release')}>
              Release control{status?.pending ? ' and stop work' : ''}
            </button>
            {others.length > 0 && (
              <>
                <label>
                  Transfer to
                  <select value={target} onChange={event => setTarget(event.target.value)}>
                    <option value="">Select session</option>
                    {others.map(client => (
                      <option key={client.id} value={client.id}>
                        {client.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={Boolean(status?.pending) || !others.some(client => client.id === target)}
                  onClick={() => session?.command('transfer', { target })}
                >
                  Transfer control
                </button>
              </>
            )}
          </>
        ) : status?.adoptable ? (
          <button type="button" onClick={() => session?.command('adopt')}>
            Manage running tree
          </button>
        ) : (
          <button
            type="button"
            disabled={!status?.ready || status.state !== 'available'}
            onClick={() => session?.command('acquire')}
          >
            Request control
          </button>
        )}
        <small>
          One session controls this robot. Finish or stop running work before transferring. Idle control expires after 2
          minutes.
        </small>
      </div>
    </details>
  );
}
