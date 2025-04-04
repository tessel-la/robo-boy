import { useState, useEffect } from 'react';
import './App.css';
// import Navbar from './components/Navbar';
import EntrySection from './components/EntrySection';
import MainControlView from './components/MainControlView';
import ThemeToggle from './components/ThemeToggle';

export interface ConnectionParams {
  ros2Option: 'domain' | 'ip'; // Now required
  ros2Value: string | number;   // Now required
}

function App() {
  const [connectionParams, setConnectionParams] = useState<ConnectionParams | null>(null);
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
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
      <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
    </div>
  );
}

export default App; 