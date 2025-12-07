import { useState, useEffect, useRef } from 'react';
import './App.css';
// import Navbar from './components/Navbar';
import EntrySection from './components/EntrySection';
import MainControlView from './components/MainControlView';
import ThemeSelector from './features/theme/components/ThemeSelector';
import ThemeCreator from './features/theme/components/ThemeCreator';
import {
  CustomTheme,
  DEFAULT_THEMES,
  THEME_STORAGE_KEY,
  CUSTOM_THEMES_STORAGE_KEY,
  generateThemeCss
} from './features/theme/themeUtils';

export interface ConnectionParams {
  ros2Option: 'domain' | 'ip'; // Now required
  ros2Value: string | number;   // Now required
}

function App() {
  const [connectionParams, setConnectionParams] = useState<ConnectionParams | null>(null);

  // --- Theme State ---
  const [selectedThemeId, setSelectedThemeId] = useState<string>(() => {
    return localStorage.getItem(THEME_STORAGE_KEY) || 'dark';
  });

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
    if (themeStyleTagRef.current) {
      themeStyleTagRef.current.remove();
      themeStyleTagRef.current = null;
    }

    // Check if it's a default theme
    if (DEFAULT_THEMES.includes(selectedThemeId)) {
      document.documentElement.setAttribute('data-theme', selectedThemeId);
      // Style tag already removed at effect start
      console.log(`Applied default theme: ${selectedThemeId}`);
    } else {
      // It's a custom theme
      const customTheme = customThemes.find((t: CustomTheme) => t.id === selectedThemeId);
      if (customTheme) {
        // Generate and apply dynamic CSS
        const css = generateThemeCss(customTheme);
        // Previous tag already removed at effect start
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
        // Style tag already removed at effect start
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
    // Add basic validation for iconId if it's added
    if (!newTheme.name || !newTheme.colors.primary || !newTheme.colors.secondary || !newTheme.colors.background) {
      console.error("Cannot add theme: Missing data.");
      return;
    }
    // Ensure iconId is valid if provided
    // if (newTheme.iconId && !availableIconIds.includes(newTheme.iconId)) {
    //     console.warn(`Invalid iconId ${newTheme.iconId} provided for new theme. Using default.`);
    //     newTheme.iconId = undefined; // Or set a default iconId
    // }
    const updatedThemes = [...customThemes, newTheme];
    setCustomThemes(updatedThemes);
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(updatedThemes));
    selectTheme(newTheme.id);
  };

  const updateCustomTheme = (updatedTheme: CustomTheme) => {
    // Add validation for iconId if needed
    const updatedThemes = customThemes.map(t => t.id === updatedTheme.id ? updatedTheme : t);
    setCustomThemes(updatedThemes);
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(updatedThemes));
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
    ...customThemes.map((t: CustomTheme) => ({ id: t.id, name: t.name, iconId: t.iconId, isDefault: false }))
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