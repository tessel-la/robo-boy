import React, { RefObject } from 'react';
import { ActivePanel } from './MainControlView'; // Remove PanelType import if not used
import './ControlPanelTabs.css'; // Create CSS file next
// import AddPanelMenu from './AddPanelMenu'; // Remove import

// --- Icons --- (Consider moving to a dedicated icons file)
const IconAdd = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 9a.75.75 0 00-1.5 0v2.25H9a.75.75 0 000 1.5h2.25V15a.75.75 0 001.5 0v-2.25H15a.75.75 0 000-1.5h-2.25V9z" clipRule="evenodd" /></svg>;
const IconClose = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" width="0.8em" height="0.8em"><path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14zm2.78-4.22a.75.75 0 0 1-1.06 1.06L8 9.06l-1.72 1.72a.75.75 0 1 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 1.06-1.06L8 6.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L9.06 8l1.72 1.72Z" clipRule="evenodd" /></svg>;
// --- End Icons ---

interface ControlPanelTabsProps {
  panels: ActivePanel[];
  selectedPanelId: string | null;
  onSelectPanel: (id: string) => void;
  onAddPanelToggle: () => void; // Simple toggle handler
  onRemovePanel: (id: string) => void;
  addButtonRef: RefObject<HTMLButtonElement>; // Need the ref prop
}

const ControlPanelTabs: React.FC<ControlPanelTabsProps> = ({
  panels,
  selectedPanelId,
  onSelectPanel,
  onAddPanelToggle, // Simple toggle
  onRemovePanel,
  addButtonRef, // Use the ref
}) => {

  const handleRemoveClick = (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    e.stopPropagation();
    onRemovePanel(id);
  };

  return (
    <div className="control-panel-tabs-container">
      <div className="control-panel-tabs">
        {panels.map(panel => (
          <div
            key={panel.id}
            role="tab"
            tabIndex={panel.id === selectedPanelId ? 0 : -1}
            onClick={() => onSelectPanel(panel.id)}
            className={`tab-button ${panel.id === selectedPanelId ? 'active' : ''}`}
            title={panel.name}
            aria-selected={panel.id === selectedPanelId}
          >
            <span className="tab-name">{panel.name}</span>
            {panels.length > 1 && (
              <button
                onClick={(e) => handleRemoveClick(e, panel.id)}
                className="tab-remove-button"
                aria-label={`Remove ${panel.name}`}
                title="Remove Panel"
              >
                <IconClose />
              </button>
            )}
          </div>
        ))}
        <button 
          ref={addButtonRef} // Attach the ref
          className="tab-add-button" 
          onClick={onAddPanelToggle} // Call the toggle
          aria-label="Add Panel"
          title="Add Panel"
        >
          <IconAdd />
        </button>
      </div>
    </div>
  );
};

export default ControlPanelTabs; 