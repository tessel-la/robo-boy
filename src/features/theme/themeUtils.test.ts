import { describe, it, expect } from 'vitest'
import {
  DEFAULT_THEMES,
  THEME_STORAGE_KEY,
  CUSTOM_THEMES_STORAGE_KEY,
  generateThemeCss,
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
})

