import React, { ReactNode, useEffect, useRef, useState } from 'react';

import './TreePanelChrome.css';

type MenuResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

interface MenuFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TreePanelMenuClassNames {
  button?: string;
  overlay?: string;
  panel?: string;
  resizeHandle?: string;
}

interface TreePanelMenuProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  triggerContent: ReactNode;
  triggerAfter?: ReactNode;
  triggerBarClassName?: string;
  menuContent: ReactNode;
  buttonLabel: string;
  buttonTitle?: string;
  disabled?: boolean;
  warningCount?: number;
  buttonTestId?: string;
  panelTestId?: string;
  panelLabel?: string;
  classNames?: TreePanelMenuClassNames;
}

const joinClasses = (...classes: Array<string | undefined>) => classes.filter(Boolean).join(' ');

const TreePanelMenu: React.FC<TreePanelMenuProps> = ({
  open,
  onOpen,
  onClose,
  triggerContent,
  triggerAfter,
  triggerBarClassName,
  menuContent,
  buttonLabel,
  buttonTitle,
  disabled = false,
  warningCount = 0,
  buttonTestId,
  panelTestId,
  panelLabel = 'Tree controls',
  classNames,
}) => {
  const [menuFrame, setMenuFrame] = useState<MenuFrame | null>(null);
  const [activeResizeCorner, setActiveResizeCorner] = useState<MenuResizeCorner | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setMenuFrame(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const closeMenu = () => {
    setActiveResizeCorner(null);
    onClose();
  };

  const getConstrainedMenuFrame = (frame: MenuFrame, overlayRect: DOMRect): MenuFrame => {
    const margin = 8;
    const availableWidth = Math.max(180, overlayRect.width - margin * 2);
    const availableHeight = Math.max(220, overlayRect.height - margin * 2);
    const minWidth = Math.min(240, availableWidth);
    const minHeight = Math.min(220, availableHeight);
    const width = Math.min(Math.max(frame.width, minWidth), availableWidth);
    const height = Math.min(Math.max(frame.height, minHeight), availableHeight);
    const left = Math.min(Math.max(frame.left, margin), overlayRect.width - width - margin);
    const top = Math.min(Math.max(frame.top, margin), overlayRect.height - height - margin);

    return {
      left: Math.max(margin, left),
      top: Math.max(margin, top),
      width,
      height,
    };
  };

  const handleResizeStart = (corner: MenuResizeCorner, event: React.PointerEvent<HTMLDivElement>) => {
    if (!overlayRef.current || !panelRef.current) return;

    event.preventDefault();
    event.stopPropagation();

    const overlayRect = overlayRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const startFrame: MenuFrame = {
      left: panelRect.left - overlayRect.left,
      top: panelRect.top - overlayRect.top,
      width: panelRect.width,
      height: panelRect.height,
    };
    const startX = event.clientX;
    const startY = event.clientY;
    const movesLeft = corner.includes('w');
    const movesUp = corner.includes('n');
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    setActiveResizeCorner(corner);
    setMenuFrame(startFrame);
    document.body.style.cursor = `${corner}-resize`;
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      let nextFrame: MenuFrame = {
        left: movesLeft ? startFrame.left + deltaX : startFrame.left,
        top: movesUp ? startFrame.top + deltaY : startFrame.top,
        width: movesLeft ? startFrame.width - deltaX : startFrame.width + deltaX,
        height: movesUp ? startFrame.height - deltaY : startFrame.height + deltaY,
      };
      const constrained = getConstrainedMenuFrame(nextFrame, overlayRect);

      if (movesLeft && constrained.width !== nextFrame.width) {
        nextFrame.left = startFrame.left + startFrame.width - constrained.width;
      }
      if (movesUp && constrained.height !== nextFrame.height) {
        nextFrame.top = startFrame.top + startFrame.height - constrained.height;
      }
      setMenuFrame(getConstrainedMenuFrame(nextFrame, overlayRect));
    };

    const handlePointerUp = () => {
      setActiveResizeCorner(null);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  return (
    <>
      <div className={triggerBarClassName}>
        <button
          type="button"
          className={joinClasses('tree-panel-menu-button', classNames?.button)}
          onClick={onOpen}
          disabled={disabled}
          title={buttonTitle}
          aria-label={buttonLabel}
          data-testid={buttonTestId}
        >
          <svg
            className="tree-panel-menu-icon"
            width="14"
            height="11"
            viewBox="0 0 14 11"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect y="0" width="14" height="1.8" rx="0.9" />
            <rect y="4.6" width="14" height="1.8" rx="0.9" />
            <rect y="9.2" width="14" height="1.8" rx="0.9" />
          </svg>
          {triggerContent}
          {warningCount > 0 && (
            <span
              className="tree-panel-menu-warning"
              aria-label={`${warningCount} warning${warningCount === 1 ? '' : 's'}`}
            >
              {warningCount}
            </span>
          )}
        </button>
        {triggerAfter}
      </div>

      {open && (
        <div
          className={joinClasses('tree-panel-menu-overlay', classNames?.overlay)}
          onClick={closeMenu}
          ref={overlayRef}
        >
          <div
            className={joinClasses(
              'tree-panel-menu-panel',
              activeResizeCorner ? 'is-resizing' : undefined,
              classNames?.panel
            )}
            onClick={event => event.stopPropagation()}
            data-testid={panelTestId}
            ref={panelRef}
            style={menuFrame ?? undefined}
            role="dialog"
            aria-label={panelLabel}
          >
            {menuContent}
            {(['nw', 'ne', 'sw', 'se'] as const).map(corner => (
              <div
                key={corner}
                className={joinClasses('tree-panel-menu-resize-handle', corner, classNames?.resizeHandle)}
                role="separator"
                aria-label={`Resize menu from ${corner} corner`}
                onPointerDown={event => handleResizeStart(corner, event)}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
};

export default TreePanelMenu;
