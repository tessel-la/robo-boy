// src/features/theme/themeUtils.ts

// Define the structure for a custom theme
export interface CustomTheme {
  id: string; // Unique identifier (e.g., timestamp or UUID)
  name: string;
  iconId?: string; // Make icon optional
  colors: {
    primary: string;
    secondary: string;
    background: string;
    text?: string;
    border?: string;
    cardBg?: string;
    buttonText?: string;
  };
}

// Default themes (cannot be edited/deleted in this basic setup)
export const DEFAULT_THEMES = ['light', 'dark', 'solarized'];
export const THEME_STORAGE_KEY = 'appTheme';
export const CUSTOM_THEMES_STORAGE_KEY = 'customThemes';

// Helper to generate dynamic CSS (basic version)
export const generateThemeCss = (theme: CustomTheme): string => {
  const colors = theme.colors;
  // Map custom theme colors to CSS variables
  // Add fallbacks or more complex logic as needed
  // Define hover/darker variants based on the primary color (example using basic logic)
  // TODO: Use a proper color library (like tinycolor2) for better manipulation
  const primary = colors.primary || '#000000';
  const secondary = colors.secondary || '#888888';
  const background = colors.background || '#ffffff';
  const text = colors.text || (isColorDark(background) ? '#ffffff' : '#000000');
  const border = colors.border || (isColorDark(background) ? '#555555' : '#cccccc');
  const cardBg = colors.cardBg || (isColorDark(background) ? '#333333' : '#f8f8f8');
  const buttonText = colors.buttonText || (isColorDark(primary) ? '#ffffff' : '#000000');

  // Basic hover/darker logic (placeholder - replace with library)
  const primaryHover = lightenDarkenColor(primary, -15);
  const primaryDarker = lightenDarkenColor(primary, -30);
  const errorColor = '#dc322f'; // Example error color
  const errorHover = lightenDarkenColor(errorColor, -15);
  const errorRgb = hexToRgb(errorColor)?.join(', ') || '220, 50, 47';


  return `
    :root[data-theme="${theme.id}"] {
      --primary-color: ${primary};
      --primary-hover-color: ${primaryHover};
      --primary-darker-color: ${primaryDarker};
      --secondary-color: ${secondary};
      --background-color: ${background};
      --background-secondary: ${lightenDarkenColor(background, isColorDark(background) ? 5 : -5)}; /* Slightly lighter/darker bg */
      --text-color: ${text};
      --text-secondary: ${lightenDarkenColor(text, isColorDark(text) ? 20 : -20)}; /* Adjust secondary text */
      --border-color: ${border};
      --card-bg: ${cardBg};
      --card-border: ${lightenDarkenColor(border, isColorDark(border) ? 10 : -10)}; /* Slightly adjust card border */
      --button-text-color: ${buttonText};
      --error-color: ${errorColor};
      --error-hover-color: ${errorHover};
      --error-rgb: ${errorRgb};
    }
  `;
};

// --- Simple Color Helper Functions (Replace with a library like tinycolor2 later) ---

function lightenDarkenColor(col: string, amt: number): string {
    col = col.startsWith('#') ? col.substring(1) : col;
    let usePound = true;
    if (col.length === 3) { // Handle shorthand hex
        col = col[0] + col[0] + col[1] + col[1] + col[2] + col[2];
    }
    if (col.length !== 6) {
        console.warn("Invalid hex color for lighten/darken:", col); 
        return '#000000'; // Return black on error
    }

    const num = parseInt(col, 16);
    let r = (num >> 16) + amt;
    if (r > 255) r = 255;
    else if (r < 0) r = 0;

    let b = ((num >> 8) & 0x00FF) + amt;
    if (b > 255) b = 255;
    else if (b < 0) b = 0;

    let g = (num & 0x0000FF) + amt;
    if (g > 255) g = 255;
    else if (g < 0) g = 0;

    return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
}

function hexToRgb(hex: string): [number, number, number] | null {
    hex = hex.startsWith('#') ? hex.substring(1) : hex;
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length !== 6) return null;
    const bigint = parseInt(hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return [r, g, b];
}

// Basic check for perceived brightness (doesn't account for color nuances)
function isColorDark(hex: string): boolean {
    const rgb = hexToRgb(hex);
    if (!rgb) return false; // Assume light if invalid
    // Formula for perceived brightness (YIQ)
    const yiq = ((rgb[0] * 299) + (rgb[1] * 587) + (rgb[2] * 114)) / 1000;
    return yiq < 128;
} 