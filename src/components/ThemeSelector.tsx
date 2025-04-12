import React, { useState, useEffect, useRef } from 'react';
import './ThemeSelector.css'; // Renamed CSS file

interface ThemeSelectorProps { // Renamed interface
  currentTheme: string;
  selectTheme: (themeName: string) => void; // Now accepts the theme name
  themes: string[]; // Added themes array prop
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

const SolarizedIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>
    {/* Simple half-moon overlay */}
    {/* <path d="M12 18A6 6 0 0012 6V18z" fill="currentColor" stroke="none"/> */}
  </svg>
);

const ThemeSelector: React.FC<ThemeSelectorProps> = ({ currentTheme, selectTheme, themes }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null); // Ref for the container

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const handleThemeSelect = (themeName: string) => {
    selectTheme(themeName); // Call parent function with selected theme
    setIsMenuOpen(false); // Close menu after selection
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

  const getIcon = (themeName: string) => {
      switch (themeName) {
          case 'light': return <SunIcon />;
          case 'dark': return <MoonIcon />;
          case 'solarized': return <SolarizedIcon />;
          default: return <SunIcon />; // Default to sun
      }
  };
  
  const getLabel = (themeName: string) => {
      return `Switch to ${themeName.charAt(0).toUpperCase() + themeName.slice(1)} theme`;
  };

  return (
    <div className="theme-selector-container" ref={containerRef}> {/* Add container and ref */}
        <button 
            onClick={toggleMenu} // Toggle menu on click
            className={`theme-selector-button ${currentTheme}`}
            aria-label="Select theme"
            title="Select theme"
            aria-haspopup="true" // Indicate popup
            aria-expanded={isMenuOpen} // Indicate state
        >
            <div className="icon-wrapper">
                {/* Show icon representing the CURRENT theme */} 
                {getIcon(currentTheme)} 
            </div>
        </button>

        {/* Popup Menu */}
        <div className={`theme-popup-menu ${isMenuOpen ? 'open' : ''}`}> 
            {themes.map(themeName => (
                <button
                    key={themeName}
                    onClick={() => handleThemeSelect(themeName)}
                    className={currentTheme === themeName ? 'active' : ''} // Highlight active theme
                    aria-pressed={currentTheme === themeName} // Indicate active state
                >
                    {getIcon(themeName)} {/* Icon next to name */}
                    <span>{themeName.charAt(0).toUpperCase() + themeName.slice(1)}</span>
                </button>
            ))}
        </div>
    </div>
  );
};

export default ThemeSelector; // Renamed export 