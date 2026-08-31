import type { RoboBoyPanelThemeSnapshot, RoboBoyPanelThemeToken } from './types';

export const PANEL_THEME_TOKENS: readonly RoboBoyPanelThemeToken[] = [
  '--primary-color',
  '--primary-hover-color',
  '--primary-darker-color',
  '--secondary-color',
  '--background-color',
  '--background-secondary',
  '--text-color',
  '--text-secondary',
  '--border-color',
  '--border-color-light',
  '--card-bg',
  '--card-border',
  '--button-text-color',
  '--error-color',
  '--success-color',
  '--warning-color',
  '--font-family-ui',
] as const;

const FALLBACK_TOKENS: Record<RoboBoyPanelThemeToken, string> = {
  '--primary-color': '#32cd32',
  '--primary-hover-color': '#28a745',
  '--primary-darker-color': '#218838',
  '--secondary-color': '#6c757d',
  '--background-color': '#ffffff',
  '--background-secondary': '#f8f9fa',
  '--text-color': '#212529',
  '--text-secondary': '#6c757d',
  '--border-color': '#dee2e6',
  '--border-color-light': '#adb5bd',
  '--card-bg': '#ffffff',
  '--card-border': '#dee2e6',
  '--button-text-color': '#ffffff',
  '--error-color': '#dc3545',
  '--success-color': '#2e7d32',
  '--warning-color': '#f59f00',
  '--font-family-ui': "'Courier New', Courier, monospace",
};

const isDarkColor = (value: string): boolean => {
  const match = value.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  if (match) {
    const [, red, green, blue] = match.map(Number);
    return red * 0.299 + green * 0.587 + blue * 0.114 < 128;
  }
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return document.documentElement.dataset.theme === 'dark';
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return red * 0.299 + green * 0.587 + blue * 0.114 < 128;
};

export const readPanelTheme = (element: Element): RoboBoyPanelThemeSnapshot => {
  const styles = getComputedStyle(element);
  const tokens = Object.fromEntries(
    PANEL_THEME_TOKENS.map(token => [token, styles.getPropertyValue(token).trim() || FALLBACK_TOKENS[token]])
  ) as Record<RoboBoyPanelThemeToken, string>;
  return {
    colorScheme: isDarkColor(tokens['--background-color']) ? 'dark' : 'light',
    tokens,
  };
};
