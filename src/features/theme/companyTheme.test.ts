import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../enterprise/config', () => ({
  brand: {
    theme: {
      id: 'sunrise-company',
      name: 'Sunrise',
      fontFamily: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
      colors: { primary: '#fa6147', secondary: '#111111', background: '#e5e5df', text: '#0e0e08' },
    },
  },
}));
import { applyThemeToDocument, readStoredTheme, themeStorageKey } from './themeUtils';
afterEach(() => {
  localStorage.clear();
  document.getElementById('robo-boy-custom-theme')?.remove();
});
it('starts with the company theme, preserves an explicit choice and never changes another edition’s selection', () => {
  localStorage.setItem('appTheme', 'dark');
  const initial = readStoredTheme();
  expect(initial.themeId).toBe('sunrise-company');
  expect(initial.customThemes.map(theme => theme.id)).toContain('sunrise-company');
  expect(applyThemeToDocument(initial.themeId, initial.customThemes)).toBe('sunrise-company');
  expect(document.getElementById('robo-boy-custom-theme')?.textContent).toContain('--primary-color: #fa6147');
  localStorage.setItem(themeStorageKey(), 'light');
  expect(readStoredTheme().themeId).toBe('light');
  expect(localStorage.getItem('appTheme')).toBe('dark');
});
