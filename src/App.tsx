import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import './App.css';
// import Navbar from './components/Navbar';
import EntrySection from './components/EntrySection';
import ConnectionTabs from './components/ConnectionTabs';
import TitleBar from './components/TitleBar';
import ThemeSelector from './features/theme/components/ThemeSelector';
import {
  CustomTheme,
  DEFAULT_THEMES,
  THEME_STORAGE_KEY,
  CUSTOM_THEMES_STORAGE_KEY,
  generateThemeCss,
} from './features/theme/themeUtils';
import { RuntimeConfigProvider } from './runtime/runtimeConfig';
import {
  createConnectionSessionId,
  describeConnectionTarget,
  type ConnectionParams,
  type ConnectionStatus,
  type ConnectionTarget,
} from './runtime/connections';

export type { ConnectionParams } from './runtime/connections';

const MainControlView = lazy(() => import('./components/MainControlView'));
const ThemeCreator = lazy(() => import('./features/theme/components/ThemeCreator'));

interface ConnectionSession extends ConnectionTarget {
  id: string;
  status: ConnectionStatus;
  isClosing: boolean;
}

const safeGetStorageItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn(`Unable to read ${key} from localStorage. Falling back to defaults.`, error);
    return null;
  }
};

const safeSetStorageItem = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Unable to save ${key} to localStorage.`, error);
  }
};

function App() {
  const [connectionSessions, setConnectionSessions] = useState<ConnectionSession[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [isAddingConnection, setIsAddingConnection] = useState(false);
  const closeTimersRef = useRef(new Map<string, number>());

  // --- Theme State ---
  const [selectedThemeId, setSelectedThemeId] = useState<string>(() => {
    return safeGetStorageItem(THEME_STORAGE_KEY) || 'dark';
  });

  const [customThemes, setCustomThemes] = useState<CustomTheme[]>(() => {
    const stored = safeGetStorageItem(CUSTOM_THEMES_STORAGE_KEY);
    try {
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error('Failed to parse custom themes from localStorage', e);
      return [];
    }
  });

  const [isThemeCreatorOpen, setIsThemeCreatorOpen] = useState(false);
  const [themeToEdit, setThemeToEdit] = useState<CustomTheme | null>(null);

  // Ref for the dynamic style tag
  const themeStyleTagRef = useRef<HTMLStyleElement | null>(null);

  useEffect(
    () => () => {
      closeTimersRef.current.forEach(timer => window.clearTimeout(timer));
      closeTimersRef.current.clear();
    },
    []
  );

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
    safeSetStorageItem(THEME_STORAGE_KEY, selectedThemeId);
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
      console.error('Cannot add theme: Missing data.');
      return;
    }
    // Ensure iconId is valid if provided
    // if (newTheme.iconId && !availableIconIds.includes(newTheme.iconId)) {
    //     console.warn(`Invalid iconId ${newTheme.iconId} provided for new theme. Using default.`);
    //     newTheme.iconId = undefined; // Or set a default iconId
    // }
    const updatedThemes = [...customThemes, newTheme];
    setCustomThemes(updatedThemes);
    safeSetStorageItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(updatedThemes));
    selectTheme(newTheme.id);
  };

  const updateCustomTheme = (updatedTheme: CustomTheme) => {
    // Add validation for iconId if needed
    const updatedThemes = customThemes.map(t => (t.id === updatedTheme.id ? updatedTheme : t));
    setCustomThemes(updatedThemes);
    safeSetStorageItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(updatedThemes));
  };

  const deleteCustomTheme = (themeIdToDelete: string) => {
    const updatedThemes = customThemes.filter((t: CustomTheme) => t.id !== themeIdToDelete);
    setCustomThemes(updatedThemes);
    safeSetStorageItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(updatedThemes));
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
    const target = describeConnectionTarget(params);
    const existing = connectionSessions.find(session => session.key === target.key && !session.isClosing);
    if (existing) {
      setActiveConnectionId(existing.id);
      setIsAddingConnection(false);
      return;
    }

    const session: ConnectionSession = {
      ...target,
      id: createConnectionSessionId(),
      status: 'connecting',
      isClosing: false,
    };
    setConnectionSessions(previous => [...previous, session]);
    setActiveConnectionId(session.id);
    setIsAddingConnection(false);
    console.log('Opening connection:', target.description);
  };

  const handleSelectConnection = (id: string) => {
    if (!connectionSessions.some(session => session.id === id && !session.isClosing)) return;
    setActiveConnectionId(id);
    setIsAddingConnection(false);
  };

  const handleCloseConnection = (id: string) => {
    const closingIndex = connectionSessions.findIndex(session => session.id === id);
    if (closingIndex < 0 || connectionSessions[closingIndex].isClosing || closeTimersRef.current.has(id)) return;

    const remaining = connectionSessions.filter(session => session.id !== id && !session.isClosing);
    setConnectionSessions(previous =>
      previous.map(session => (session.id === id ? { ...session, isClosing: true } : session))
    );

    if (activeConnectionId === id && !isAddingConnection) {
      const next = remaining[Math.min(closingIndex, remaining.length - 1)] || null;
      setActiveConnectionId(next?.id || null);
      setIsAddingConnection(!next);
    }

    // First render the session as inactive. Panel cleanup can then publish neutral control values
    // while its ROS socket still exists; removing the owner on the next task closes that socket.
    const timer = window.setTimeout(() => {
      closeTimersRef.current.delete(id);
      setConnectionSessions(previous => previous.filter(session => session.id !== id));
    }, 0);
    closeTimersRef.current.set(id, timer);
  };

  const handleConnectionStatusChange = (id: string, status: ConnectionStatus) => {
    setConnectionSessions(previous => {
      const index = previous.findIndex(session => session.id === id);
      if (index < 0 || previous[index].status === status) return previous;
      const next = [...previous];
      next[index] = { ...next[index], status };
      return next;
    });
  };

  // Combine default and custom themes for the selector
  const allThemesForSelector = [
    ...DEFAULT_THEMES.map(id => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), isDefault: true })),
    ...customThemes.map((t: CustomTheme) => ({ id: t.id, name: t.name, iconId: t.iconId, isDefault: false })),
  ];

  return (
    <>
      <TitleBar />
      <div className="App">
        <main>
          <div className="connection-shell">
            <div className="connection-shell-content">
              {connectionSessions.map(session => {
                const isActive = !isAddingConnection && activeConnectionId === session.id && !session.isClosing;
                return (
                  <section
                    id={`connection-session-${session.id}`}
                    className="connection-session"
                    role="tabpanel"
                    aria-label={session.label}
                    aria-hidden={!isActive}
                    hidden={!isActive}
                    key={session.id}
                  >
                    <RuntimeConfigProvider connectionParams={session.params}>
                      <Suspense fallback={<div className="app-loading-workspace">Loading workspace...</div>}>
                        <MainControlView
                          connectionParams={session.params}
                          isActive={isActive}
                          storageScope={session.storageScope}
                          onConnectionStatusChange={status => handleConnectionStatusChange(session.id, status)}
                          onDisconnect={() => handleCloseConnection(session.id)}
                          connectionNavigation={
                            <ConnectionTabs
                              tabs={connectionSessions}
                              activeTabId={activeConnectionId}
                              isAdding={isAddingConnection}
                              onSelect={handleSelectConnection}
                              onClose={handleCloseConnection}
                              onAdd={() => setIsAddingConnection(true)}
                            />
                          }
                        />
                      </Suspense>
                    </RuntimeConfigProvider>
                  </section>
                );
              })}
              {(connectionSessions.length === 0 || isAddingConnection) && (
                <section className="connection-picker" aria-label="Open a robot connection">
                  {connectionSessions.length > 0 && (
                    <div className="connection-picker-top-bar">
                      <ConnectionTabs
                        tabs={connectionSessions}
                        activeTabId={activeConnectionId}
                        isAdding
                        onSelect={handleSelectConnection}
                        onClose={handleCloseConnection}
                        onAdd={() => setIsAddingConnection(true)}
                      />
                    </div>
                  )}
                  <EntrySection onConnect={handleConnect} embedded={connectionSessions.length > 0} />
                </section>
              )}
            </div>
          </div>
        </main>
        <ThemeSelector
          currentThemeId={selectedThemeId}
          selectTheme={selectTheme}
          themes={allThemesForSelector}
          openThemeCreator={openThemeCreator}
          deleteTheme={deleteCustomTheme}
        />
        {isThemeCreatorOpen && (
          <Suspense fallback={null}>
            <ThemeCreator isOpen onClose={closeThemeCreator} onSave={handleSaveTheme} existingTheme={themeToEdit} />
          </Suspense>
        )}
      </div>
    </>
  );
}

export default App;
