import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import './ImportReview.css';

export interface ImportReview {
  title: string;
  items: string[];
  details: string[];
  action?: string;
}
let closePrevious: (() => void) | undefined;
function ReviewDialog({ review, finish }: { review: ImportReview; finish: (accepted: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="content-import-dialog"
      aria-labelledby="content-import-title"
      onClick={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onCancel={event => {
        event.preventDefault();
        finish(false);
      }}
    >
      <header>
        <h2 id="content-import-title">{review.title}</h2>
      </header>
      <div className="content-import-body">
        <ul>
          {review.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
        {review.details.map((detail, index) => (
          <p key={index}>{detail}</p>
        ))}
      </div>
      <footer>
        <button autoFocus onClick={() => finish(false)}>
          {review.action ? 'Cancel' : 'Close'}
        </button>
        {review.action && (
          <button className="content-import-primary" onClick={() => finish(true)}>
            {review.action}
          </button>
        )}
      </footer>
    </dialog>
  );
}
/** Lazy-loaded, inert text-only preview. The caller owns the commit after acceptance. */
export function reviewImport(review: ImportReview, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  closePrevious?.();
  const previousFocus = document.activeElement;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  return new Promise(resolve => {
    let settled = false;
    const cancel = () => finish(false);
    const finish = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      if (closePrevious === cancel) closePrevious = undefined;
      // Do not unmount a root while React is dispatching its click event.
      queueMicrotask(() => {
        root.unmount();
        host.remove();
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
        resolve(accepted && !signal?.aborted);
      });
    };
    closePrevious = cancel;
    signal?.addEventListener('abort', cancel, { once: true });
    root.render(<ReviewDialog review={review} finish={finish} />);
  });
}
export const showImportError = (message: string, signal?: AbortSignal) =>
  reviewImport({ title: 'Unable to import', items: [], details: [message] }, signal);
