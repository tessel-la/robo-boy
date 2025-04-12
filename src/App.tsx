import { useState, useEffect, useRef } from 'react';
import './App.css';
// import Navbar from './components/Navbar';
import EntrySection from './components/EntrySection';
import MainControlView from './components/MainControlView';
import ThemeSelector from './components/ThemeSelector';
import ThemeCreator from './components/ThemeCreator';

export interface ConnectionParams {
  ros2Option: 'domain' | 'ip'; // Now required
  ros2Value: string | number;   // Now required
}

// Define the structure for a custom theme
export interface CustomTheme {
  id: string; // Unique identifier (e.g., timestamp or UUID)
  name: string;
  // icon: string; // Placeholder for icon selection later
  colors: {
    primary: string;
    secondary: string;
    background: string;
    // Add more colors as needed (text, border, etc.)
    text?: string;
    border?: string;
    cardBg?: string;
    buttonText?: string;
  };
}

// Default themes (cannot be edited/deleted in this basic setup)
const DEFAULT_THEMES = ['light', 'dark', 'solarized'];
const THEME_STORAGE_KEY = 'appTheme';
const CUSTOM_THEMES_STORAGE_KEY = 'customThemes';

// Helper to generate dynamic CSS (basic version)
const generateThemeCss = (theme: CustomTheme): string => {
  const colors = theme.colors;
  // Map custom theme colors to CSS variables
  // Add fallbacks or more complex logic as needed
  return `
    :root[data-theme="${theme.id}"] {
      --primary-color: ${colors.primary};
      --secondary-color: ${colors.secondary};
      --background-color: ${colors.background};
      /* Add other variables based on CustomTheme structure */
      ${colors.text ? `--text-color: ${colors.text};` : ''}
      ${colors.border ? `--border-color: ${colors.border};` : ''}
      ${colors.cardBg ? `--card-bg: ${colors.cardBg};` : ''}
      ${colors.buttonText ? `--button-text-color: ${colors.buttonText};` : ''}
      /* Add hover/darker variants dynamically if desired, or use defaults */
      /* --primary-hover-color: ... */ 
    }
  `;
};

function App() {
  const [connectionParams, setConnectionParams] = useState<ConnectionParams | null>(null);

  // --- Theme State ---
  // Load selected theme name
  const [selectedThemeId, setSelectedThemeId] = useState<string>(() => {
    return localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
  });

  // Load custom themes
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>(() => {
    const stored = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    try {
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error("Failed to parse custom themes from localStorage", e);
      return [];
    }
  });

  const [isThemeCreatorOpen, setIsThemeCreatorOpen] = useState(false);
  const [themeToEdit, setThemeToEdit] = useState<CustomTheme | null>(null);

  // Ref for the dynamic style tag
  const themeStyleTagRef = useRef<HTMLStyleElement | null>(null);

  // --- Theme Application Effect ---
  useEffect(() => {
    // Remove previous dynamic styles if they exist
    themeStyleTagRef.current?.remove();
    themeStyleTagRef.current = null;

    // Check if it's a default theme
    if (DEFAULT_THEMES.includes(selectedThemeId)) {
      document.documentElement.setAttribute('data-theme', selectedThemeId);
      console.log(`Applied default theme: ${selectedThemeId}`);
    } else {
      // It's a custom theme
      const customTheme = customThemes.find((t: CustomTheme) => t.id === selectedThemeId);
      if (customTheme) {
        // Generate and apply dynamic CSS
        const css = generateThemeCss(customTheme);
        const styleTag = document.createElement('style');
        styleTag.id = `custom-theme-styles-${customTheme.id}`;
        styleTag.innerHTML = css;
        document.head.appendChild(styleTag);
        themeStyleTagRef.current = styleTag; // Store ref to remove later
        // Set data-theme attribute for potential general custom theme styling
        document.documentElement.setAttribute('data-theme', customTheme.id);
        console.log(`Applied custom theme: ${customTheme.name} (ID: ${customTheme.id})`);
      } else {
        // Fallback if custom theme not found (e.g., deleted)
        console.warn(`Custom theme with ID ${selectedThemeId} not found. Falling back to dark.`);
        document.documentElement.setAttribute('data-theme', 'dark');
        setSelectedThemeId('dark'); // Reset state
      }
    }
    // Save the selected theme ID
    localStorage.setItem(THEME_STORAGE_KEY, selectedThemeId);

  }, [selectedThemeId, customThemes]); // Re-run when selection or custom themes change

  // --- Theme CRUD Functions ---
  const selectTheme = (themeId: string) => {
    // Check if themeId is valid (either default or custom)
    const isValidDefault = DEFAULT_THEMES.includes(themeId);
    const isValidCustom = customThemes.some((t: CustomTheme) => t.id === themeId);
    if (isValidDefault || isValidCustom) {
        setSelectedThemeId(themeId);
    } else {
        console.warn(`Attempted to set invalid theme ID: ${themeId}`);
    }
  };

  const addCustomTheme = (newTheme: CustomTheme) => {
    // Basic validation: ensure colors are present
    if (!newTheme.name || !newTheme.colors.primary || !newTheme.colors.secondary || !newTheme.colors.background) {
      console.error("Cannot add theme: Missing name or required colors.");
      return; // Maybe show user feedback
    }
    const updatedThemes = [...customThemes, newTheme];
    setCustomThemes(updatedThemes);
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(updatedThemes));
    selectTheme(newTheme.id); // Select the newly added theme
  };

  const updateCustomTheme = (updatedTheme: CustomTheme) => {
    const updatedThemes = customThemes.map((t: CustomTheme) => t.id === updatedTheme.id ? updatedTheme : t);
    setCustomThemes(updatedThemes);
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(updatedThemes));
    // If the updated theme is the currently selected one, the effect will re-apply it
  };

  const deleteCustomTheme = (themeIdToDelete: string) => {
    const updatedThemes = customThemes.filter((t: CustomTheme) => t.id !== themeIdToDelete);
    setCustomThemes(updatedThemes);
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(updatedThemes));
    // If the deleted theme was selected, fall back to default
    if (selectedThemeId === themeIdToDelete) {
      selectTheme('dark'); 
    }
  };

  // --- Theme Creator Control ---
  const openThemeCreator = (themeToEditId: string | null = null) => {
      if (themeToEditId) {
          const foundTheme = customThemes.find(t => t.id === themeToEditId);
          setThemeToEdit(foundTheme || null);
      } else {
          setThemeToEdit(null); // Ensure it's null for creating new
      }
      setIsThemeCreatorOpen(true);
  };

  const closeThemeCreator = () => {
      setIsThemeCreatorOpen(false);
      setThemeToEdit(null); // Clear theme being edited
  };

  const handleSaveTheme = (theme: CustomTheme) => {
      if (customThemes.some(t => t.id === theme.id)) {
          // ID exists, so update
          updateCustomTheme(theme);
      } else {
          // New theme, add it
          addCustomTheme(theme);
      }
      // closeThemeCreator(); // Closed by ThemeCreator itself
  };

  // --- Connection Handlers ---
  const handleConnect = (params: ConnectionParams) => {
    setConnectionParams(params);
    console.log('Connecting with:', params); // Logs only ROS 2 params
  };

  const handleDisconnect = () => {
    setConnectionParams(null);
    console.log('Disconnected');
  };

  // Combine default and custom themes for the selector
  const allThemesForSelector = [
      ...DEFAULT_THEMES.map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), isDefault: true })),
      ...customThemes.map((t: CustomTheme) => ({ id: t.id, name: t.name, isDefault: false }))
  ];

  return (
    <div className="App">
      <main>
        {!connectionParams ? (
          <EntrySection onConnect={handleConnect} />
        ) : (
          <MainControlView
            connectionParams={connectionParams}
            onDisconnect={handleDisconnect}
            // Potentially pass theme management functions down if needed
          />
        )}
      </main>
      <ThemeSelector 
          currentThemeId={selectedThemeId}
          selectTheme={selectTheme} 
          themes={allThemesForSelector}
          openThemeCreator={openThemeCreator}
          deleteTheme={deleteCustomTheme}
      />
      <ThemeCreator 
          isOpen={isThemeCreatorOpen}
          onClose={closeThemeCreator}
          onSave={handleSaveTheme}
          existingTheme={themeToEdit}
      />
    </div>
  );
}

export default App; 