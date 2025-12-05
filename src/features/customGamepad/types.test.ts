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
      const mode = ComponentInteractionMode.Translate
      let result = ''

      switch (mode) {
        case ComponentInteractionMode.None:
          result = 'none'
          break
        case ComponentInteractionMode.Translate:
          result = 'translate'
          break
        case ComponentInteractionMode.Resize:
          result = 'resize'
          break
        case ComponentInteractionMode.Settings:
          result = 'settings'
          break
      }

      expect(result).toBe('translate')
    })
  })
})

