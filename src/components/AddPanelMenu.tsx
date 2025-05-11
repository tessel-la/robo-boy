import React, { useEffect, useRef, useState, RefObject } from 'react';
import ReactDOM from 'react-dom'; // Import ReactDOM for Portal
import { PanelType } from './MainControlView'; // Import PanelType
import './AddPanelMenu.css'; // Create CSS next
import { GamepadType } from './gamepads/GamepadInterface';

interface AddPanelMenuProps {
  isOpen: boolean;
  onSelectType: (type: PanelType) => void;
  onClose: () => void;
  addButtonRef: RefObject<HTMLButtonElement>; // Re-add button ref
}

// Define available panel types here or pass them as props
const availablePanelTypes = [
  { type: GamepadType.Standard, label: 'Standard Pad' },
  { type: GamepadType.Voice, label: 'Voice Control' },
  { type: GamepadType.GameBoy, label: 'GameBoy' },
  { type: GamepadType.Drone, label: 'Drone Control' },
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
  addButtonRef, // Use the ref
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

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

  if (!isOpen || !portalRoot) { // Also check if portalRoot exists
    return null;
  }

  // Render into the portal
  return ReactDOM.createPortal(
      <div 
        className="add-panel-menu" // Keep class for styling (colors, padding etc.)
        ref={menuRef} 
        style={menuStyle} // Apply dynamic style
      >
        <ul>
          {availablePanelTypes.map(panelInfo => (
            <li key={panelInfo.type}>
              <button onClick={() => onSelectType(panelInfo.type)}>
                {panelInfo.label}
              </button>
            </li>
          ))}
        </ul>
      </div>,
      portalRoot // Target element for the portal
  );
};

export default AddPanelMenu; 