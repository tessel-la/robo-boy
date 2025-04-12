import { useState, useEffect } from 'react';
import './App.css';
// import Navbar from './components/Navbar';
import EntrySection from './components/EntrySection';
import MainControlView from './components/MainControlView';
import ThemeSelector from './components/ThemeSelector';

export interface ConnectionParams {
  ros2Option: 'domain' | 'ip'; // Now required
  ros2Value: string | number;   // Now required
}

const THEMES = ['light', 'dark', 'solarized']; // Define available themes
const THEME_STORAGE_KEY = 'appTheme';

function App() {
  const [connectionParams, setConnectionParams] = useState<ConnectionParams | null>(null);

  // Initialize theme state from local storage or default to 'dark'
  const [theme, setTheme] = useState(() => {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return storedTheme && THEMES.includes(storedTheme) ? storedTheme : 'dark';
  });

  // Apply theme to document and store in local storage
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    console.log(`Theme set to: ${theme}`);
  }, [theme]);

  // Function to set a specific theme
  const selectTheme = (themeName: string) => {
    if (THEMES.includes(themeName)) {
      setTheme(themeName);
    } else {
      console.warn(`Attempted to set invalid theme: ${themeName}`);
    }
  };

  const handleConnect = (params: ConnectionParams) => {
    setConnectionParams(params);
    console.log('Connecting with:', params); // Logs only ROS 2 params
  };

  const handleDisconnect = () => {
    setConnectionParams(null);
    console.log('Disconnected');
  };

  return (
    <div className="App">
      <main>
        {!connectionParams ? (
          <EntrySection onConnect={handleConnect} />
        ) : (
          <MainControlView
            connectionParams={connectionParams}
            onDisconnect={handleDisconnect}
          />
        )}
      </main>
      <ThemeSelector 
          currentTheme={theme} 
          selectTheme={selectTheme} // Pass the specific theme setter function
          themes={THEMES} // Pass themes for the menu
      />
    </div>
  );
}

export default App; 