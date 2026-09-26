import { afterEach, describe, it, expect } from 'vitest'
import {
  DEFAULT_THEMES,
  DEFAULT_THEME_FONT_FAMILY,
  FONT_OPTIONS,
  THEME_STORAGE_KEY,
  CUSTOM_THEMES_STORAGE_KEY,
  generateThemeCss,
  applyThemeToDocument,
  readStoredTheme,
  type CustomTheme,
} from './themeUtils'

describe('themeUtils', () => {
  describe('constants', () => {
    it('should have correct default themes', () => {
      expect(DEFAULT_THEMES).toEqual(['light', 'dark', 'solarized'])
    })

    it('should have correct storage keys', () => {
      expect(THEME_STORAGE_KEY).toBe('appTheme')
      expect(CUSTOM_THEMES_STORAGE_KEY).toBe('customThemes')
    })
  })

  describe('generateThemeCss', () => {
    it('should generate CSS with theme colors', () => {
      const theme: CustomTheme = {
        id: 'test-theme',
        name: 'Test Theme',
        colors: {
          primary: '#ff0000',
          secondary: '#00ff00',
          background: '#ffffff',
        },
      }

      const css = generateThemeCss(theme)

      expect(css).toContain(':root[data-theme="test-theme"]')
      expect(css).toContain('--primary-color: #ff0000')
      expect(css).toContain('--secondary-color: #00ff00')
      expect(css).toContain('--background-color: #ffffff')
    })

    it('should use fallback colors when not provided', () => {
      const theme: CustomTheme = {
        id: 'minimal',
        name: 'Minimal',
        colors: {
          primary: '',
          secondary: '',
          background: '',
        },
      }

      const css = generateThemeCss(theme)

      expect(css).toContain('--primary-color: #000000')
      expect(css).toContain('--secondary-color: #888888')
      expect(css).toContain('--background-color: #ffffff')
    })

    it('should generate light text for dark backgrounds', () => {
      const theme: CustomTheme = {
        id: 'dark-theme',
        name: 'Dark',
        colors: {
          primary: '#4a90d9',
          secondary: '#888888',
          background: '#1a1a1a', // Dark background
        },
      }

      const css = generateThemeCss(theme)

      expect(css).toContain('--text-color: #ffffff')
    })

    it('should generate dark text for light backgrounds', () => {
      const theme: CustomTheme = {
        id: 'light-theme',
        name: 'Light',
        colors: {
          primary: '#4a90d9',
          secondary: '#888888',
          background: '#ffffff', // Light background
        },
      }

      const css = generateThemeCss(theme)

      expect(css).toContain('--text-color: #000000')
    })

    it('should respect provided text color', () => {
      const theme: CustomTheme = {
        id: 'custom-text',
        name: 'Custom Text',
        colors: {
          primary: '#4a90d9',
          secondary: '#888888',
          background: '#ffffff',
          text: '#333333',
        },
      }

      const css = generateThemeCss(theme)

      expect(css).toContain('--text-color: #333333')
    })

    it('should respect provided border color', () => {
      const theme: CustomTheme = {
        id: 'custom-border',
        name: 'Custom Border',
        colors: {
          primary: '#4a90d9',
          secondary: '#888888',
          background: '#ffffff',
          border: '#aabbcc',
        },
      }

      const css = generateThemeCss(theme)

      expect(css).toContain('--border-color: #aabbcc')
    })

    it('should respect provided cardBg color', () => {
      const theme: CustomTheme = {
        id: 'custom-card',
        name: 'Custom Card',
        colors: {
          primary: '#4a90d9',
          secondary: '#888888',
          background: '#ffffff',
          cardBg: '#f0f0f0',
        },
      }

      const css = generateThemeCss(theme)

      expect(css).toContain('--card-bg: #f0f0f0')
    })

    it('should respect provided buttonText color', () => {
      const theme: CustomTheme = {
        id: 'custom-button',
        name: 'Custom Button',
        colors: {
          primary: '#4a90d9',
          secondary: '#888888',
          background: '#ffffff',
          buttonText: '#ffffff',
        },
      }

      const css = generateThemeCss(theme)

      expect(css).toContain('--button-text-color: #ffffff')
    })

    it('should generate hover and darker variants', () => {
      const theme: CustomTheme = {
        id: 'variants',
        name: 'Variants Test',
        colors: {
          primary: '#4a90d9',
          secondary: '#888888',
          background: '#ffffff',
        },
      }

      const css = generateThemeCss(theme)

      expect(css).toContain('--primary-hover-color:')
      expect(css).toContain('--primary-darker-color:')
      expect(css).toContain('--error-color: #dc322f')
      expect(css).toContain('--error-hover-color:')
      expect(css).toContain('--error-rgb:')
    })

    it('should generate the default app font when no custom font is provided', () => {
      const theme: CustomTheme = {
        id: 'default-font',
        name: 'Default Font',
        colors: {
          primary: '#4a90d9',
          secondary: '#888888',
          background: '#ffffff',
        },
      }

      const css = generateThemeCss(theme)

      expect(css).toContain(`--font-family-ui: ${DEFAULT_THEME_FONT_FAMILY}`)
    })

    it('should respect selected font families from the font catalog', () => {
      const selectedFont = FONT_OPTIONS.find(option => option.label === 'Georgia')?.value
      const theme: CustomTheme = {
        id: 'custom-font',
        name: 'Custom Font',
        fontFamily: selectedFont,
        colors: {
          primary: '#4a90d9',
          secondary: '#888888',
          background: '#ffffff',
        },
      }

      const css = generateThemeCss(theme)

      expect(css).toContain(`--font-family-ui: ${selectedFont}`)
    })

    it('should ignore font families outside the font catalog', () => {
      const theme: CustomTheme = {
        id: 'invalid-font',
        name: 'Invalid Font',
        fontFamily: 'Comic Sans MS',
        colors: {
          primary: '#4a90d9',
          secondary: '#888888',
          background: '#ffffff',
        },
      }

      const css = generateThemeCss(theme)

      expect(css).toContain(`--font-family-ui: ${DEFAULT_THEME_FONT_FAMILY}`)
    })

    it('should handle shorthand hex colors', () => {
      const theme: CustomTheme = {
        id: 'shorthand',
        name: 'Shorthand',
        colors: {
          primary: '#f00', // Shorthand for #ff0000
          secondary: '#0f0',
          background: '#fff',
        },
      }

      // Should not throw and should generate valid CSS
      const css = generateThemeCss(theme)

      expect(css).toContain(':root[data-theme="shorthand"]')
      expect(css).toContain('--primary-color: #f00')
    })

    it('should handle invalid hex colors gracefully', () => {
      const theme: CustomTheme = {
        id: 'invalid',
        name: 'Invalid',
        colors: {
          primary: 'not-a-color',
          secondary: '#888888',
          background: '#ffffff',
        },
      }

      // Should not throw
      const css = generateThemeCss(theme)

      expect(css).toContain(':root[data-theme="invalid"]')
    })
  })

  describe('document theme', () => {
    const ocean: CustomTheme = { id: 'ocean', name: 'Ocean', colors: { primary: '#0077be', secondary: '#88a', background: '#001f3f' } }

    afterEach(() => {
      localStorage.clear()
      document.documentElement.removeAttribute('data-theme')
      document.head.querySelectorAll('style').forEach(style => style.remove())
    })

    it('applies a default theme without leaving custom theme CSS behind', () => {
      applyThemeToDocument('ocean', [ocean])
      expect(applyThemeToDocument('solarized', [ocean])).toBe('solarized')
      expect(document.documentElement.getAttribute('data-theme')).toBe('solarized')
      expect(document.head.querySelectorAll('style')).toHaveLength(0)
    })

    it('keeps a single style element for custom themes and updates it in place', () => {
      applyThemeToDocument('ocean', [ocean])
      applyThemeToDocument('ocean', [{ ...ocean, colors: { ...ocean.colors, primary: '#ff8722' } }])
      const styles = document.head.querySelectorAll('style')
      expect(styles).toHaveLength(1)
      expect(styles[0].textContent).toContain(':root[data-theme="ocean"]')
      expect(styles[0].textContent).toContain('--primary-color: #ff8722')
      expect(document.documentElement.getAttribute('data-theme')).toBe('ocean')
    })

    it('falls back to the dark theme for an unknown custom theme', () => {
      expect(applyThemeToDocument('deleted-theme', [ocean])).toBe('dark')
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })

    it('reads the stored selection and tolerates corrupt custom themes', () => {
      expect(readStoredTheme()).toEqual({ themeId: 'dark', customThemes: [] })
      localStorage.setItem(THEME_STORAGE_KEY, 'ocean')
      localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify([ocean]))
      expect(readStoredTheme()).toEqual({ themeId: 'ocean', customThemes: [ocean] })
      localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, '{not json')
      expect(readStoredTheme().customThemes).toEqual([])
    })
  })
})
