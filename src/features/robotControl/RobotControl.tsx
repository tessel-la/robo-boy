import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { FiAlertCircle, FiBell, FiCheck, FiChevronDown, FiLock, FiUnlock, FiX } from 'react-icons/fi';
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
  const nameEdited = useRef(false);
  const savedLabel = status?.clients.find(client => client.id === status.selfId)?.label;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const seenRequests = useRef<string[]>([]);
  const menuId = useId();
  useEffect(() => {
    nameEdited.current = false;
  }, [session]);
  useEffect(() => {
    if (!nameEdited.current) setLabel(savedLabel ?? '');
  }, [savedLabel, session]);
  useEffect(() => {
    const incoming = status?.owner === status?.selfId && status?.token ? (status.requests ?? []) : [];
    if (incoming.some(request => !seenRequests.current.includes(request.id)) && detailsRef.current) {
      // Show each new request once, without moving focus away from robot controls.
      detailsRef.current.open = true;
    }
    seenRequests.current = incoming.map(request => request.id);
  }, [status]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) detailsRef.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && detailsRef.current?.open) {
        detailsRef.current.open = false;
        detailsRef.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  if (!ros) return null;
  const owned = Boolean(status?.owner === status?.selfId && status?.token);
  const description = !status
    ? 'Control gateway unavailable — commands are disabled. Update the ROS stack.'
    : !status.ready
      ? 'Waiting for behavior-tree runner status.'
      : status.state === 'blocked' || status.state === 'draining'
        ? status.reason
        : status.external?.enabled && !status.external.allowControl
          ? status.external.reason
          : owned && status.managing
            ? status.reason
            : owned
              ? `You have control${status.pending ? ` · ${status.pending} running request(s)` : ''}`
              : status.owner
                ? `Read-only · ${status.ownerLabel} has control`
                : 'Read-only · Control available';
  const others = status?.clients.filter(client => client.id !== status.selfId) ?? [];
  const nameSaved = Boolean(label.trim() && label.trim() === savedLabel);
  const canSetName = Boolean(status && label.trim() && !nameSaved);
  const requests = owned ? (status?.requests ?? []) : [];
  const requestPending = status?.request?.state === 'pending' || status?.request?.state === 'accepted';
  const canRequest =
    status?.ready &&
    (!status.external?.enabled || status.external.ready) &&
    (status.state === 'available' || (status.state === 'owned' && status.owner !== status.selfId));
  const blocked = Boolean(status?.error || status?.state === 'blocked');
  const StatusIcon = blocked || !status ? FiAlertCircle : requests.length ? FiBell : owned ? FiUnlock : FiLock;
  const summary = blocked
    ? 'Command blocked'
    : status?.state === 'draining'
      ? 'Finishing work'
      : status?.external?.enabled && !status.external.allowControl
        ? 'Robot-side lock'
        : owned
          ? 'Control: you'
          : status?.owner
            ? `Control: ${status.ownerLabel}`
            : 'Read-only';
  return (
    <details ref={detailsRef} className={`robot-control ${owned ? 'has-control' : ''} ${blocked ? 'is-blocked' : ''}`}>
      <summary
        aria-label={`Robot control: ${status?.error || description}${requests.length ? `, ${requests.length} control request(s)` : ''}`}
        title={status?.error || description}
        aria-haspopup="dialog"
        aria-controls={menuId}
      >
        <StatusIcon aria-hidden="true" />
        <span className="robot-control-label" role="status" aria-live="polite">
          {summary}
        </span>
        <FiChevronDown className="robot-control-chevron" aria-hidden="true" />
        {requests.length > 0 && (
          <span className="robot-control-request-count" aria-hidden="true">
            {requests.length}
          </span>
        )}
      </summary>
      <div className="robot-control-popover" id={menuId} role="dialog" aria-label="Robot control">
        <div className="robot-control-heading">
          <span>Robot control</span>
          <button
            type="button"
            className="robot-control-close"
            aria-label="Close robot control"
            onClick={() => {
              if (detailsRef.current) detailsRef.current.open = false;
              detailsRef.current?.querySelector('summary')?.focus();
            }}
          >
            <FiX aria-hidden="true" />
          </button>
        </div>
        <div className="robot-control-status">
          <StatusIcon aria-hidden="true" />
          <p role="status" aria-live="polite">
            {description}
          </p>
        </div>
        {status?.error && (
          <p className="robot-control-error" role="alert">
            {status.error}
          </p>
        )}
        {status?.reason && status.reason !== description && <p>{status.reason}</p>}
        {status?.external?.enabled && (
          <p className="robot-control-request-message" role="status" aria-live="polite">
            {status.external.reason && status.external.reason !== description
              ? status.external.reason
              : 'The robot-side controller must approve each control request.'}
          </p>
        )}
        {requests.length > 0 && (
          <div className="robot-control-requests" aria-label="Incoming control requests">
            {requests.map(request => (
              <div className="robot-control-request" key={request.id}>
                <p role="status" aria-live="polite">
                  <strong>{request.label}</strong> requests control.
                </p>
                <div className="robot-control-request-actions">
                  <button
                    className="robot-control-action is-primary"
                    type="button"
                    disabled={
                      !status?.ready || status.state !== 'owned' || Boolean(status.pending) || request.ownerApproved
                    }
                    onClick={() => session?.command('approve', { requestId: request.id })}
                    aria-label={`Grant control to ${request.label}`}
                  >
                    {request.ownerApproved ? 'Consent sent' : 'Grant'}
                  </button>
                  <button
                    className="robot-control-action"
                    type="button"
                    onClick={() => session?.command('deny', { requestId: request.id })}
                    aria-label={`Deny control to ${request.label}`}
                  >
                    Deny
                  </button>
                </div>
                {request.ownerApproved && status?.external?.enabled && !request.externalApproved && (
                  <small>Waiting for robot-side approval.</small>
                )}
              </div>
            ))}
            {Boolean(status?.pending) && <small>Finish or stop running work before granting control.</small>}
          </div>
        )}
        {!owned && status?.request && status.request.state !== 'granted' && (
          <p className="robot-control-request-message" role="status" aria-live="polite">
            {status.request.message}
          </p>
        )}
        {owned ? (
          <button className="robot-control-action is-release" type="button" onClick={() => session?.command('release')}>
            Release control{status?.pending ? ' and stop work' : ''}
          </button>
        ) : status?.adoptable ? (
          <button
            className="robot-control-action is-primary"
            type="button"
            disabled={requestPending || (status.external?.enabled && !status.external.ready)}
            onClick={() => session?.command('adopt')}
          >
            {requestPending ? 'Request sent' : 'Manage running tree'}
          </button>
        ) : (
          <button
            className="robot-control-action is-primary"
            type="button"
            disabled={!canRequest || requestPending}
            onClick={() => session?.command(status?.owner ? 'request' : 'acquire')}
          >
            {requestPending ? 'Request sent' : 'Request control'}
          </button>
        )}
        {!owned && status?.request?.state === 'pending' && (
          <button
            className="robot-control-action"
            type="button"
            onClick={() => session?.command('cancel_request', { requestId: status.request?.id })}
          >
            Cancel request
          </button>
        )}
        <form
          className="robot-control-section"
          onSubmit={event => {
            event.preventDefault();
            if (canSetName) {
              nameEdited.current = false;
              session?.command('identify', { label: label.trim() });
            }
          }}
        >
          <label htmlFor={`${menuId}-name`}>Session name</label>
          <div className="robot-control-name-row">
            <input
              id={`${menuId}-name`}
              value={label}
              placeholder={savedLabel || 'Your session name'}
              aria-describedby={savedLabel ? `${menuId}-name-status` : undefined}
              maxLength={64}
              onChange={event => {
                nameEdited.current = true;
                setLabel(event.target.value);
              }}
            />
            <button
              className={`robot-control-action ${nameSaved ? 'is-saved' : ''}`}
              type="submit"
              disabled={!canSetName}
            >
              {nameSaved && <FiCheck aria-hidden="true" />}
              {nameSaved ? 'Saved' : 'Set name'}
            </button>
          </div>
          {savedLabel && (
            <p id={`${menuId}-name-status`} className="robot-control-name-status" role="status" aria-live="polite">
              {nameSaved ? `Name saved as ${savedLabel}.` : `Current name: ${savedLabel}`}
            </p>
          )}
        </form>
        {owned && others.length > 0 && (
          <div className="robot-control-section">
            <label htmlFor={`${menuId}-transfer`}>Transfer to</label>
            <select id={`${menuId}-transfer`} value={target} onChange={event => setTarget(event.target.value)}>
              <option value="">Select session</option>
              {others.map(client => (
                <option key={client.id} value={client.id}>
                  {client.label}
                </option>
              ))}
            </select>
            <button
              className="robot-control-action"
              type="button"
              disabled={Boolean(status?.pending) || !others.some(client => client.id === target)}
              onClick={() => session?.command('transfer', { target })}
            >
              Transfer control
            </button>
            {Boolean(status?.pending) && <small>Finish or stop running work before transferring.</small>}
          </div>
        )}
        <small className="robot-control-footer">
          Control releases after 2 minutes without commands. Running work keeps control until it finishes.
        </small>
      </div>
    </details>
  );
}
