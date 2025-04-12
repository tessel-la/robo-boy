import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { CustomTheme } from '../App'; // Import the theme type
import './ThemeCreator.css';
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs

interface ThemeCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (theme: CustomTheme) => void; // Can be add or update
  existingTheme?: CustomTheme | null; // Pass existing theme for editing
}

// Default colors for new themes
const DEFAULT_NEW_THEME_COLORS = {
  primary: '#3498db', // Blue
  secondary: '#9b59b6', // Purple
  background: '#ecf0f1', // Light grey
  text: '#2c3e50', // Dark blue/grey
  border: '#bdc3c7', // Medium grey
  cardBg: '#ffffff', // White
  buttonText: '#ffffff' // White
};

const ThemeCreator: React.FC<ThemeCreatorProps> = ({
  isOpen,
  onClose,
  onSave,
  existingTheme = null,
}) => {
  const [themeName, setThemeName] = useState('');
  const [colors, setColors] = useState(DEFAULT_NEW_THEME_COLORS);

  // Populate form if editing an existing theme
  useEffect(() => {
    if (existingTheme) {
      setThemeName(existingTheme.name);
      setColors({ ...DEFAULT_NEW_THEME_COLORS, ...existingTheme.colors });
    } else {
      setThemeName('');
      setColors(DEFAULT_NEW_THEME_COLORS);
    }
  }, [existingTheme, isOpen]);

  const handleColorChange = (colorName: keyof CustomTheme['colors'], value: string) => {
    setColors((prev: typeof DEFAULT_NEW_THEME_COLORS) => ({ ...prev, [colorName]: value }));
  };

  const handleSave = () => {
    if (!themeName.trim()) {
      alert('Please enter a theme name.');
      return;
    }
    const currentId = (existingTheme as CustomTheme | null)?.id || uuidv4();
    const themeToSave: CustomTheme = {
      id: currentId,
      name: themeName.trim(),
      colors: {
          primary: colors.primary,
          secondary: colors.secondary,
          background: colors.background,
          text: colors.text,
          border: colors.border,
          cardBg: colors.cardBg,
          buttonText: colors.buttonText,
      },
    };
    onSave(themeToSave);
    onClose();
  };

  // Handle backdrop click to close
  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  // Use Portal to render the modal at the body level
  return ReactDOM.createPortal(
    <div className={`theme-creator-backdrop ${isOpen ? 'open' : ''}`} onClick={handleBackdropClick}>
      <div className="theme-creator-modal">
        <h2>{existingTheme ? 'Edit Theme' : 'Create New Theme'}</h2>
        <form className="theme-creator-form" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
          <div className="form-group">
            <label htmlFor="themeName">Theme Name</label>
            <input
              type="text"
              id="themeName"
              value={themeName}
              onChange={(e) => setThemeName(e.target.value)}
              placeholder="e.g., My Awesome Theme"
              required
            />
          </div>

          <div className="form-group">
            <label>Base Colors</label>
            <div className="color-input-group">
              {/* Map over defined default keys to ensure order and inclusion */}
              {(Object.keys(DEFAULT_NEW_THEME_COLORS) as Array<keyof typeof DEFAULT_NEW_THEME_COLORS>).map((key) => (
                  <div className="color-input-item" key={key}>
                    <label htmlFor={`color-${key}`}>
                      <input
                        type="color"
                        id={`color-${key}`}
                        value={colors[key] ?? '#000000'} // Provide a fallback value for the input
                        onChange={(e) => handleColorChange(key, e.target.value)}
                      />
                      {/* Simple label generation */}
                      {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                    </label>
                  </div>
              ))}
             </div>
          </div>

          {/* Placeholder for Icon Selector */}

          <div className="theme-creator-actions">
            <button type="button" className="cancel-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="save-button">Save Theme</button>
          </div>
        </form>
      </div>
    </div>,
    document.body // Target element for the portal
  );
};

export default ThemeCreator; 