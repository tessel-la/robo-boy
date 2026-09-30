import { Color } from 'three';
import { DEFAULT_THEME_FONT_FAMILY } from '../../features/theme/themeUtils';
import { readPanelTheme } from '../../panels/theme';
import type { RoboBoyPanelThemeSnapshot } from '../../panels/types';

// Fixed Tessella identity colours; UI and status colours come from the active Robo Boy theme.
export const TESSELLA_BRAND = { dot: '#ff8722' } as const;
const wash = (colour: string, opacity: number) => {
  const rgb = new Color(colour).getHex();
  return `rgba(${rgb >> 16}, ${(rgb >> 8) & 255}, ${rgb & 255}, ${opacity})`;
};

export const resolveXrTheme = ({ tokens }: RoboBoyPanelThemeSnapshot) => {
  const accent = tokens['--primary-color'] || '#32cd32';
  const text = tokens['--text-color'] || '#e0e0e0';
  const muted = tokens['--text-secondary'] || '#adb5bd';
  return {
    background: tokens['--background-color'] || '#121212',
    surface: tokens['--card-bg'] || '#1e1e1e',
    surfaceBorder: tokens['--card-border'] || '#333333',
    border: tokens['--border-color'] || '#444444',
    raised: tokens['--background-secondary'] || '#2c2c2c',
    grid: tokens['--border-color-light'] || '#666666',
    item: tokens['--background-secondary'] || '#2c2c2c',
    itemHover: wash(accent, 0.16),
    itemActive: wash(accent, 0.26),
    itemDisabled: wash(muted, 0.06),
    text,
    textMuted: muted,
    textDisabled: wash(text, 0.5),
    accent,
    accentHover: tokens['--primary-hover-color'] || accent,
    accentText: tokens['--button-text-color'] || '#121212',
    danger: tokens['--error-color'] || '#e74c3c',
    success: tokens['--success-color'] || '#2ecc71',
    font: tokens['--font-family-ui'] || DEFAULT_THEME_FONT_FAMILY,
  };
};
export const XR_THEME = resolveXrTheme({ colorScheme: 'dark', tokens: {} });
let revision = 0;
const listeners = new Set<() => void>();
export const getXrThemeRevision = () => revision;
export const subscribeXrTheme = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** One session-owned observer; canvases and materials share the desktop's resolved CSS tokens. */
export function startXrTheme(): () => void {
  const update = () => {
    const next = resolveXrTheme(readPanelTheme(document.documentElement));
    if (JSON.stringify(next) === JSON.stringify(XR_THEME)) return;
    Object.assign(XR_THEME, next);
    revision += 1;
    for (const listener of listeners) listener();
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}
