import React, { useState, useEffect, useRef } from 'react';
import './ThemeSelector.css'; // Renamed CSS file

// Define the structure for the theme data passed to the selector
interface SelectorThemeData {
  id: string; // Can be default name ('light') or custom ID
  name: string; // Display name
  isDefault: boolean;
}

// Add Edit and Delete Icons (Example SVGs)
const EditIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const DeleteIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;

interface ThemeSelectorProps {
  currentThemeId: string; // Changed from currentTheme
  selectTheme: (themeId: string) => void; // Changed argument name
  themes: SelectorThemeData[]; // Use the new interface
  openThemeCreator: (themeId?: string | null) => void; // Optional ID for editing
  deleteTheme: (themeId: string) => void;
}

const SunIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const MoonIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

// Rename SolarizedIcon, maybe represent sand/sun
const SandIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {/* Simple sun over waves/sand */}
    <path d="M12 17.657l-6.364-6.364a9 9 0 1112.728 0L12 17.657zM12 12a3 3 0 100-6 3 3 0 000 6z" />
    <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707"/>
  </svg>
);

// Add more icon options
const PaletteIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0L12 2.69z"/>
        <circle cx="12" cy="8.5" r=".5" fill="currentColor"/><circle cx="10" cy="10.5" r=".5" fill="currentColor"/><circle cx="14" cy="10.5" r=".5" fill="currentColor"/><circle cx="12" cy="12.5" r=".5" fill="currentColor"/>
    </svg>
);
const StarIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
);

// Map icon IDs to components
const iconMap: { [key: string]: React.FC } = {
    sun: SunIcon,
    moon: MoonIcon,
    sand: SandIcon,
    palette: PaletteIcon,
    star: StarIcon,
};
export const availableIconIds = Object.keys(iconMap);

// Updated getIcon helper
const getIcon = (themeIdOrIconId: string) => {
    // First check if it's a known default theme ID
    switch (themeIdOrIconId) {
        case 'light': return iconMap.sun ? <SunIcon /> : null;
        case 'dark': return iconMap.moon ? <MoonIcon /> : null;
        case 'solarized': return iconMap.sand ? <SandIcon /> : null;
    }
    // Otherwise, assume it's an iconId from a custom theme
    const IconComponent = iconMap[themeIdOrIconId];
    return IconComponent ? <IconComponent /> : <PaletteIcon />; // Fallback to palette if iconId invalid/missing
};

const ThemeSelector: React.FC<ThemeSelectorProps> = ({ 
    currentThemeId, 
    selectTheme, 
    themes, 
    openThemeCreator, 
    deleteTheme
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const handleThemeSelect = (themeId: string) => {
    selectTheme(themeId); // Pass the ID
    setIsMenuOpen(false);
  };

  const handleEdit = (e: React.MouseEvent, themeId: string) => {
      e.stopPropagation(); // Prevent theme selection
      openThemeCreator(themeId);
      setIsMenuOpen(false);
  };

  const handleDelete = (e: React.MouseEvent, themeId: string, themeName: string) => {
      e.stopPropagation(); // Prevent theme selection
      // Basic confirmation
      if (window.confirm(`Are you sure you want to delete the theme "${themeName}"?`)) {
          deleteTheme(themeId);
          setIsMenuOpen(false); // Close menu after deletion
      }
  };

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  return (
    <div className="theme-selector-container" ref={containerRef}>
        <button 
            onClick={toggleMenu}
            className={`theme-selector-button ${currentThemeId}`}
            aria-label="Select theme"
            title="Select theme"
            aria-haspopup="true"
            aria-expanded={isMenuOpen}
        >
            <div className="icon-wrapper">
                {getIcon(currentThemeId)} {/* Use currentThemeId */}
            </div>
        </button>

        {/* Popup Menu */}
        <div className={`theme-popup-menu ${isMenuOpen ? 'open' : ''}`}> 
            {themes.map(themeData => (
                <div key={themeData.id} className="theme-item-row"> {/* Wrap button and actions */}
                    <button
                        onClick={() => handleThemeSelect(themeData.id)}
                        className={`theme-select-button ${currentThemeId === themeData.id ? 'active' : ''}`} 
                        aria-pressed={currentThemeId === themeData.id}
                    >
                        {getIcon(themeData.id)} 
                        <span>{themeData.name}</span>
                    </button>
                    {!themeData.isDefault && (
                        <div className="theme-item-actions">
                            <button 
                                className="action-button edit-button"
                                onClick={(e) => handleEdit(e, themeData.id)}
                                title={`Edit ${themeData.name}`}
                                aria-label={`Edit ${themeData.name}`}
                            >
                                <EditIcon />
                            </button>
                            <button 
                                className="action-button delete-button"
                                onClick={(e) => handleDelete(e, themeData.id, themeData.name)}
                                title={`Delete ${themeData.name}`}
                                aria-label={`Delete ${themeData.name}`}
                             >
                                <DeleteIcon />
                            </button>
                        </div>
                    )}
                </div>
            ))}
            <button 
                className="create-new-theme-button"
                onClick={() => { openThemeCreator(); setIsMenuOpen(false); }}>
                    Create New Theme...
             </button> 
        </div>
    </div>
  );
};

export default ThemeSelector; 