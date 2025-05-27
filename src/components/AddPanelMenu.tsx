import React, { useEffect, useRef, useState, RefObject } from 'react';
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
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [refreshKey, setRefreshKey] = useState(0);

  // Calculate position based on button ref
  useEffect(() => {
    if (isOpen && addButtonRef.current && menuRef.current) {
      const buttonRect = addButtonRef.current.getBoundingClientRect();
      const menuWidth = menuRef.current.offsetWidth || 150; // Need menu width
      const viewportWidth = window.innerWidth;
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const margin = 10; // Small margin from viewport edge

      // Initial desired position (right-aligned with button)
      let desiredLeft = buttonRect.right + scrollX - menuWidth;
      
      // Check for right edge overflow
      if (buttonRect.right + scrollX > viewportWidth) {
          // If button's right edge is off-screen, align menu's right edge to viewport edge
          desiredLeft = viewportWidth - menuWidth - margin;
      }

      // Check for left edge overflow (less common, but good practice)
      if (desiredLeft < scrollX + margin) {
          desiredLeft = scrollX + margin;
      }

      setMenuStyle({
        position: 'fixed',
        top: `${buttonRect.bottom + scrollY + 4}px`,
        left: `${desiredLeft}px`, // Use the potentially adjusted left position
        // Remove the transform
        // transform: 'translateX(-100%)',
        opacity: 1, 
        zIndex: 9999, // Add high z-index
      });
    } else {
      // Reset styles when hiding (keep display: none)
      setMenuStyle({ display: 'none', transform: 'none', opacity: 0 });
    }
    // Add menuRef.current?.offsetWidth to dependencies? Might cause loops. Let's test without first.
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
    setRefreshKey((prev: number) => prev + 1); // Force re-render to update the list
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
      </div>,
      portalRoot // Target element for the portal
  );
};

export default AddPanelMenu; 