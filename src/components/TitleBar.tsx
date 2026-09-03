import React, { useCallback, useEffect, useState } from 'react';
import type { Window } from '@tauri-apps/api/window';
import { getDesktopWindow } from '../runtime/desktopWindow';
import { isDesktopRuntime } from '../runtime/runtimeConfig';
import './TitleBar.css';

const withAppWindow = async (run: (appWindow: Window) => unknown): Promise<void> => {
  await run(await getDesktopWindow());
};

// An undecorated window loses the frame the desktop would normally use to resize it, so the
// edges are redrawn here and handed back to the compositor on press.
const RESIZE_EDGES = [
  { edge: 'n', direction: 'North' },
  { edge: 's', direction: 'South' },
  { edge: 'e', direction: 'East' },
  { edge: 'w', direction: 'West' },
  { edge: 'ne', direction: 'NorthEast' },
  { edge: 'nw', direction: 'NorthWest' },
  { edge: 'se', direction: 'SouthEast' },
  { edge: 'sw', direction: 'SouthWest' },
] as const;

// The window API keeps its direction union private, so it is taken from the table above:
// an edge that does not name a real direction stops being a type error waiting to happen.
type ResizeDirection = (typeof RESIZE_EDGES)[number]['direction'];

const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isDesktopRuntime()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void withAppWindow(async appWindow => {
      const readState = async () => {
        const maximized = await appWindow.isMaximized();
        if (!cancelled) setIsMaximized(maximized);
      };
      await readState();
      // Maximizing is not always the app's own doing: a keyboard shortcut or a window tiling
      // gesture has to reach the button too.
      const stop = await appWindow.onResized(() => void readState());
      if (cancelled) stop();
      else unlisten = stop;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const minimize = useCallback(() => void withAppWindow(w => w.minimize()), []);
  const toggleMaximize = useCallback(() => void withAppWindow(w => w.toggleMaximize()), []);
  const close = useCallback(() => void withAppWindow(w => w.close()), []);

  const startResize = useCallback((direction: ResizeDirection) => {
    void withAppWindow(appWindow => appWindow.startResizeDragging(direction));
  }, []);

  if (!isDesktopRuntime()) return null;

  return (
    <>
      <header className="title-bar" data-tauri-drag-region>
        <div className="title-bar-brand">
          <span className="title-bar-mark" aria-hidden="true" />
          <span className="title-bar-name">ROBO&middot;BOY</span>
        </div>

        <div className="title-bar-controls">
          <button type="button" className="title-bar-button" onClick={minimize} aria-label="Minimise">
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 5h8" />
            </svg>
          </button>
          <button
            type="button"
            className="title-bar-button"
            onClick={toggleMaximize}
            aria-label={isMaximized ? 'Restore' : 'Maximise'}
          >
            {isMaximized ? (
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2.5 3.5h4v4h-4z" />
                <path d="M3.5 3.5v-1h4v4h-1" />
              </svg>
            ) : (
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 2h6v6H2z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="title-bar-button title-bar-button-close"
            onClick={close}
            aria-label="Close"
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>
        </div>
      </header>

      {RESIZE_EDGES.map(({ edge, direction }) => (
        <div
          key={edge}
          className={`title-bar-resize title-bar-resize-${edge}`}
          onMouseDown={() => startResize(direction)}
        />
      ))}
    </>
  );
};

export default TitleBar;
