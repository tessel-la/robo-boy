import { useEffect, useState } from 'react';
import { RENEWAL_NOTICE_MS } from './session';

interface Props {
  expires: number;
  waiting: boolean;
  error: string;
  native: boolean;
  onRenew: () => void;
  onCancel: () => void;
}

/** Warns before the gateway ends the session, without covering robot controls. */
export default function SessionRenewal({ expires, waiting, error, native, onRenew, onCancel }: Props) {
  const [now, setNow] = useState(Date.now);
  const [dismissed, setDismissed] = useState(false);
  const remaining = expires - now;
  const warning = remaining <= RENEWAL_NOTICE_MS;
  useEffect(() => {
    if (!warning) {
      const timer = setTimeout(() => setNow(Date.now()), expires - RENEWAL_NOTICE_MS - Date.now());
      return () => clearTimeout(timer);
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expires, warning]);
  // A dismissed notice returns for the final minute.
  if (!warning || remaining <= 0 || (dismissed && remaining > 60000 && !error)) return null;
  const minutes = Math.ceil(remaining / 60000);
  return (
    <aside className="enterprise-renewal" role="status" aria-label="Session expiry">
      <p>
        <strong>
          {remaining < 60000
            ? 'Your session ends in less than a minute.'
            : `Your session ends in ${minutes} minute${minutes === 1 ? '' : 's'}.`}
        </strong>{' '}
        {waiting
          ? native
            ? 'Complete sign-in in your browser, then return here.'
            : 'Complete sign-in in the new tab, then return here.'
          : 'Sign in again to keep your robot connections.'}
      </p>
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
      <div>
        {waiting ? (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <>
            <button className="enterprise-primary" type="button" onClick={onRenew}>
              Sign in again
            </button>
            <button type="button" onClick={() => setDismissed(true)}>
              Later
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
