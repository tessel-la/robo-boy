import { describe, it, expect } from 'vitest'
import { ComponentInteractionMode } from './types'

describe('types', () => {
  describe('ComponentInteractionMode enum', () => {
    it('should have None mode', () => {
      expect(ComponentInteractionMode.None).toBe('none')
    })

    it('should have Translate mode', () => {
      expect(ComponentInteractionMode.Translate).toBe('translate')
    })

    it('should have Resize mode', () => {
      expect(ComponentInteractionMode.Resize).toBe('resize')
    })

    it('should have Settings mode', () => {
      expect(ComponentInteractionMode.Settings).toBe('settings')
    })

    it('should have exactly 4 modes', () => {
      const modes = Object.values(ComponentInteractionMode)
      expect(modes).toHaveLength(4)
    })

    it('should be usable in switch statements', () => {
      // Use a function to test switch behavior without literal type narrowing
      const getModeResult = (mode: ComponentInteractionMode): string => {
        switch (mode) {
          case ComponentInteractionMode.None:
            return 'none'
          case ComponentInteractionMode.Translate:
            return 'translate'
          case ComponentInteractionMode.Resize:
            return 'resize'
          case ComponentInteractionMode.Settings:
            return 'settings'
        }
      }

      expect(getModeResult(ComponentInteractionMode.Translate)).toBe('translate')
      expect(getModeResult(ComponentInteractionMode.None)).toBe('none')
      expect(getModeResult(ComponentInteractionMode.Resize)).toBe('resize')
      expect(getModeResult(ComponentInteractionMode.Settings)).toBe('settings')
    })
  })
})

