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
  { type: GamepadType.Standard, label: 'Standard Pad' },
  { type: GamepadType.Voice, label: 'Voice Control' },
  { type: GamepadType.GameBoy, label: 'GameBoy' },
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
      
      // Calculate menu dimensions
      const menuWidth = Math.min(
        menuRef.current.offsetWidth || 250,
        viewportWidth - (2 * margin)
      );
      
      // Calculate available space with better small screen handling
      const spaceBelow = viewportHeight - buttonRect.bottom;
      const spaceAbove = buttonRect.top;
      
      // For very small screens, prioritize showing more content
      const minMenuHeight = viewportHeight < 500 ? 150 : 180;
      const maxMenuHeight = Math.min(
        450,
        viewportHeight - (2 * margin)
      );
      
      // Determine if menu should open upward or downward
      const openUpward = spaceBelow < minMenuHeight && spaceAbove > spaceBelow;
      
      // Calculate final height
      const availableHeight = openUpward ? spaceAbove - margin : spaceBelow - margin;
      const menuHeight = Math.max(minMenuHeight, Math.min(maxMenuHeight, availableHeight));
      
      // Calculate horizontal position - always try to align with button first
      let left = buttonRect.right - menuWidth; // Right-align with button
      
      // Ensure menu stays within horizontal bounds
      if (left < margin) {
        left = margin;
      } else if (left + menuWidth > viewportWidth - margin) {
        left = viewportWidth - menuWidth - margin;
      }
      
      // Calculate vertical position - always try to position near button first
      let top;
      const gap = 8; // Gap between button and menu
      
      if (openUpward) {
        top = buttonRect.top - menuHeight - gap;
      } else {
        top = buttonRect.bottom + gap;
      }
      
      // Only adjust vertical position if it goes outside bounds
      if (top < margin) {
        top = margin;
      } else if (top + menuHeight > viewportHeight - margin) {
        top = viewportHeight - menuHeight - margin;
      }

      setMenuStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: `${menuWidth}px`,
        height: `${menuHeight}px`,
        opacity: 1, 
        zIndex: 9999,
        overflowY: 'auto',
        overflowX: 'hidden',
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
        <div className="add-panel-menu-content">
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