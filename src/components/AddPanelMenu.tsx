import React, { useEffect, useRef, useState, RefObject } from 'react';
import ReactDOM from 'react-dom'; // Import ReactDOM for Portal
import './AddPanelMenu.css'; // Create CSS next
import { loadGamepadLibrary, deleteCustomGamepad } from '../features/customGamepad/gamepadStorage';

const IconPencil = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 2.5l2.5 2.5L5 13.5l-3 .5.5-3L11 2.5z"/>
  </svg>
);
const IconTrash = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="1,4 15,4"/>
    <path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/>
    <path d="M3 4l1 9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-9"/>
  </svg>
);
const IconPlus = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="8" y1="2" x2="8" y2="14"/>
    <line x1="2" y1="8" x2="14" y2="8"/>
  </svg>
);

interface AddPanelMenuProps {
  isOpen: boolean;
  onSelectLayout: (layoutId: string) => void;
  onClose: () => void;
  onOpenCustomEditor: (layoutId?: string) => void;
  onOpenTemplate: (layoutId: string) => void;
  addButtonRef: RefObject<HTMLButtonElement>; // Re-add button ref
  refreshKey?: number; // New prop to force refresh
  onCustomGamepadDeleted?: (layoutId: string) => void; // Callback when a custom gamepad is deleted
}

// Find or create the portal root element
let portalRoot = document.getElementById('portal-root');
if (!portalRoot) {
  portalRoot = document.createElement('div');
  portalRoot.setAttribute('id', 'portal-root');
  document.body.appendChild(portalRoot);
}

const AddPanelMenu: React.FC<AddPanelMenuProps> = ({
  isOpen,
  onSelectLayout,
  onClose,
  onOpenCustomEditor,
  onOpenTemplate,
  addButtonRef, // Use the ref
  refreshKey, // Use the refreshKey prop
  onCustomGamepadDeleted, // Use the onCustomGamepadDeleted prop
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  // Calculate position based on button ref
  useEffect(() => {
    if (isOpen && addButtonRef.current && menuRef.current) {
      const buttonRect = addButtonRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Adjust margins based on screen size
      const margin = viewportWidth < 480 ? 8 : viewportWidth < 768 ? 12 : 16;

      // Calculate menu width - more conservative to fit content
      const menuWidth = Math.min(280, viewportWidth - (2 * margin));

      // Calculate available space more conservatively
      const spaceBelow = viewportHeight - buttonRect.bottom - margin - 20; // Extra buffer
      const spaceAbove = buttonRect.top - margin - 20; // Extra buffer

      // Determine if menu should open upward or downward
      const openUpward = spaceBelow < 150 && spaceAbove > spaceBelow;

      // Calculate max height based on chosen direction, with conservative limits
      const maxHeight = Math.min(
        openUpward ? spaceAbove : spaceBelow,
        300 // Cap at 300px to ensure manageability
      );

      // Calculate horizontal position - align with button
      let left = buttonRect.right - menuWidth;

      // Ensure menu stays within horizontal bounds
      if (left < margin) {
        left = margin;
      } else if (left + menuWidth > viewportWidth - margin) {
        left = viewportWidth - menuWidth - margin;
      }

      // Calculate vertical position
      let top;
      const gap = 8;

      if (openUpward) {
        top = buttonRect.top - gap; // Position from here, will expand upward with transform
      } else {
        top = buttonRect.bottom + gap;
      }

      // Ensure top position doesn't go negative or exceed viewport
      if (openUpward) {
        top = Math.max(margin, top);
      } else {
        top = Math.min(top, viewportHeight - maxHeight - margin);
      }

      // Apply positioning with content-based sizing
      setMenuStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: `${menuWidth}px`,
        maxHeight: `${maxHeight}px`,
        transform: openUpward ? 'translateY(-100%)' : 'none',
        opacity: 1,
        zIndex: 9999,
        overflowY: 'auto',
        overflowX: 'hidden',
        boxSizing: 'border-box',
      });
    } else {
      // Reset styles when hiding
      setMenuStyle({ display: 'none', transform: 'none', opacity: 0 });
    }
  }, [isOpen, addButtonRef]);

  // Effect to handle clicks outside the menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(event.target as Node) &&
        addButtonRef.current && !addButtonRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen, onClose, addButtonRef]);

  // Load custom gamepads (refreshKey forces re-evaluation)
  // This must be called before any early returns to follow Rules of Hooks
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gamepadLibrary = React.useMemo(() => loadGamepadLibrary(), [refreshKey]);
  const templates = gamepadLibrary.filter(item => item.isDefault);
  const customGamepads = gamepadLibrary.filter((item: any) => !item.isDefault);

  if (!isOpen || !portalRoot) { // Also check if portalRoot exists
    return null;
  }

  const handleCustomGamepadSelect = (layoutId: string) => {
    onSelectLayout(layoutId);
  };

  const handleDeleteCustomGamepad = (layoutId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent triggering the select action
    deleteCustomGamepad(layoutId);
    // Force re-render by reloading from localStorage
    // Note: This won't automatically refresh, user needs to reopen menu
    // For full refresh, parent component should manage the refreshKey
    if (onCustomGamepadDeleted) {
      onCustomGamepadDeleted(layoutId);
    }
  };

  const handleEditCustomGamepad = (layoutId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent triggering the select action
    onOpenCustomEditor(layoutId);
  };

  // Render into the portal
  return ReactDOM.createPortal(
    <div
      className="add-panel-menu" // Keep class for styling (colors, padding etc.)
      ref={menuRef}
      style={menuStyle} // Apply dynamic style
    >
      <div
        className="add-panel-menu-content"
        style={{
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden'
        }}
      >
        <div className="menu-section">
          <h4>Templates</h4>
          <ul>
            {templates.map(template => (
              <li key={template.id}>
                <button onClick={() => onOpenTemplate(template.id)} title={template.description}>
                  {template.name}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {customGamepads.length > 0 && (
          <div className="menu-section">
            <h4>Custom Layouts</h4>
            <ul>
              {customGamepads.map(gamepad => (
                <li key={gamepad.id} className="custom-gamepad-item">
                  <button
                    className="custom-gamepad-button"
                    onClick={() => handleCustomGamepadSelect(gamepad.id)}
                  >
                    {gamepad.name}
                  </button>
                  <button
                    className="edit-gamepad-button"
                    onClick={(e) => handleEditCustomGamepad(gamepad.id, e)}
                    title="Edit custom gamepad"
                    aria-label="Edit"
                  >
                    <IconPencil />
                  </button>
                  <button
                    className="delete-gamepad-button"
                    onClick={(e) => handleDeleteCustomGamepad(gamepad.id, e)}
                    title="Delete custom gamepad"
                    aria-label="Delete"
                  >
                    <IconTrash />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="menu-section">
          <button
            className="create-custom-button"
            onClick={() => onOpenCustomEditor()}
          >
            <IconPlus />
            Create Custom Gamepad
          </button>
        </div>
      </div>
    </div>,
    portalRoot // Target element for the portal
  );
};

export default AddPanelMenu; 
