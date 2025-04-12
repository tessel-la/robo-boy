import React, { useEffect, useRef, useState, RefObject } from 'react';
import ReactDOM from 'react-dom'; // Import ReactDOM for Portal
import { PanelType } from './MainControlView'; // Import PanelType
import './AddPanelMenu.css'; // Create CSS next

interface AddPanelMenuProps {
  isOpen: boolean;
  onSelectType: (type: PanelType) => void;
  onClose: () => void;
  addButtonRef: RefObject<HTMLButtonElement>; // Re-add button ref
}

// Define available panel types here or pass them as props
const availablePanelTypes: { type: PanelType, label: string }[] = [
  { type: 'pad', label: 'Pad Control' },
  { type: 'voice', label: 'Voice Control' },
  // { type: 'gameboy', label: 'GameBoy Control' }, // Add later
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
      const menuWidth = menuRef.current.offsetWidth || 150; // Use default width if offsetWidth is 0 initially
      setMenuStyle({
        position: 'fixed',
        top: `${buttonRect.bottom + window.scrollY + 4}px`,
        left: `${buttonRect.right + window.scrollX - menuWidth}px`,
        opacity: 1, // Set opacity directly to 1
      });
    } else {
      setMenuStyle({ display: 'none' });
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