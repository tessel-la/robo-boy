import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { CustomTheme } from '../../features/theme/themeUtils'; // Updated path
import './ThemeCreator.css';
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs
// Removed incorrect import again

// --- Icons needed for ThemeCreator --- 
// (Copied from ThemeSelector - consider creating a shared icon file later)
const SunIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);
const MoonIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);
const SandIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 17.657l-6.364-6.364a9 9 0 1112.728 0L12 17.657zM12 12a3 3 0 100-6 3 3 0 000 6z" /><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707"/>
  </svg>
);
const PaletteIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0L12 2.69z"/><circle cx="12" cy="8.5" r=".5" fill="currentColor"/><circle cx="10" cy="10.5" r=".5" fill="currentColor"/><circle cx="14" cy="10.5" r=".5" fill="currentColor"/><circle cx="12" cy="12.5" r=".5" fill="currentColor"/>
    </svg>
);
const StarIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
);
// Map icon IDs to components locally for the creator
const creatorIconMap: { [key: string]: React.FC } = {
    sun: SunIcon,
    moon: MoonIcon,
    sand: SandIcon,
    palette: PaletteIcon,
    star: StarIcon,
};
const creatorAvailableIconIds = Object.keys(creatorIconMap);
// --- End Icons --- 

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
  const [selectedIconId, setSelectedIconId] = useState<string>('palette'); // Default icon

  // Populate form if editing an existing theme
  useEffect(() => {
    if (existingTheme) {
      setThemeName(existingTheme.name);
      setColors({ ...DEFAULT_NEW_THEME_COLORS, ...existingTheme.colors });
      setSelectedIconId(existingTheme.iconId || 'palette'); // Use existing or default
    } else {
      setThemeName('');
      setColors(DEFAULT_NEW_THEME_COLORS);
      setSelectedIconId('palette'); // Reset to default for new theme
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
    const themeToSave: CustomTheme = {
      id: existingTheme?.id || uuidv4(),
      name: themeName.trim(),
      iconId: selectedIconId, // Save the selected icon ID
      colors: colors, // Pass the full colors object
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

          {/* --- Icon Selector --- */}
          <div className="form-group">
            <label>Icon</label>
            <div className="icon-selector-group">
                {creatorAvailableIconIds.map(iconId => { // Use local IDs
                    const IconComp = creatorIconMap[iconId]; // Use local map
                    return (
                        <button
                            type="button"
                            key={iconId}
                            className={`icon-select-button ${selectedIconId === iconId ? 'selected' : ''}`}
                            onClick={() => setSelectedIconId(iconId)}
                            title={iconId}
                            aria-label={`Select ${iconId} icon`}
                            aria-pressed={selectedIconId === iconId}
                         >
                            {/* Render the component directly */}
                            {IconComp ? <IconComp /> : null}
                        </button>
                    );
                 })}
            </div>
          </div>
          {/* --- End Icon Selector --- */}

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