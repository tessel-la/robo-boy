import React, { useEffect, useRef, useState, RefObject, useCallback } from 'react';
import ReactDOM from 'react-dom'; // Import ReactDOM for Portal
import { PanelType } from './MainControlView'; // Import PanelType
import './AddPanelMenu.css'; // Create CSS next
import { GamepadType } from './gamepads/GamepadInterface';
import { loadGamepadLibrary, deleteCustomGamepad } from '../features/customGamepad/gamepadStorage';

interface AddPanelMenuProps {
  isOpen: boolean;
  onSelectType: (type: PanelType, layoutId?: string) => void;
  onClose: () => void;
  onOpenCustomEditor: (layoutId?: string) => void;
  addButtonRef: RefObject<HTMLButtonElement>; // Re-add button ref
  refreshKey?: number; // New prop to force refresh
  onCustomGamepadDeleted?: () => void; // Callback when a custom gamepad is deleted
}

// Define available panel types here or pass them as props
const availablePanelTypes = [
  { type: GamepadType.Voice, label: 'Voice Control' },
  { type: GamepadType.Drone, label: 'Drone Control' },
  { type: GamepadType.Manipulator, label: 'Manipulator Control' },
  { type: GamepadType.Custom, label: 'Custom Gamepad' },
  // Add other layouts here as they are created
];

// Find or create the portal root element
let portalRoot = document.getElementById('portal-root');
if (!portalRoot) {
  portalRoot = document.createElement('div');
  portalRoot.setAttribute('id', 'portal-root');
  document.body.appendChild(portalRoot);
}

const AddPanelMenu: React.FC<AddPanelMenuProps> = ({
  isOpen,
  onSelectType,
  onClose,
  onOpenCustomEditor,
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
  const customGamepads = gamepadLibrary.filter((item: any) => !item.isDefault);

  if (!isOpen || !portalRoot) { // Also check if portalRoot exists
    return null;
  }

  const handleMenuItemClick = (panelInfo: any) => {
    if (panelInfo.type === GamepadType.Custom) {
      onOpenCustomEditor();
    } else {
      onSelectType(panelInfo.type);
    }
  };

  const handleCustomGamepadSelect = (layoutId: string) => {
    onSelectType(GamepadType.Custom, layoutId);
  };

  const handleDeleteCustomGamepad = (layoutId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent triggering the select action
    deleteCustomGamepad(layoutId);
    // Force re-render by reloading from localStorage
    // Note: This won't automatically refresh, user needs to reopen menu
    // For full refresh, parent component should manage the refreshKey
    if (onCustomGamepadDeleted) {
      onCustomGamepadDeleted();
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
            <h4>Default Layouts</h4>
            <ul>
              {availablePanelTypes.filter(p => p.type !== GamepadType.Custom).map(panelInfo => (
                <li key={panelInfo.type}>
                  <button onClick={() => onSelectType(panelInfo.type)}>
                    {panelInfo.label}
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
                    >
                      ✏️
                    </button>
                    <button 
                      className="delete-gamepad-button"
                      onClick={(e) => handleDeleteCustomGamepad(gamepad.id, e)}
                      title="Delete custom gamepad"
                    >
                      ×
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
              <span className="icon">✏️</span>
              Create Custom Gamepad
            </button>
          </div>
        </div>
      </div>,
      portalRoot // Target element for the portal
  );
};

export default AddPanelMenu; 