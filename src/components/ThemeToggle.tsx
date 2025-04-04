import React from 'react';
import './ThemeToggle.css'; // We'll create this CSS file next

interface ThemeToggleProps {
  theme: string;
  toggleTheme: () => void;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, toggleTheme }) => {
  return (
    <button onClick={toggleTheme} className="theme-toggle-button">
      {theme === 'light' ? '🌙' : '☀️'} {/* Use icons for toggle */}
    </button>
  );
};

export default ThemeToggle; 