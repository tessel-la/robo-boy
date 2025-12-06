import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  loadGamepadLibrary,
  saveCustomGamepad,
  deleteCustomGamepad,
  getGamepadLayout,
  generateGamepadId,
  exportGamepadLayouts,
  importGamepadLayouts,
  clearCustomGamepads,
} from './gamepadStorage'
import { defaultGamepadLibrary } from './defaultLayouts'
import type { CustomGamepadLayout } from './types'

describe('gamepadStorage', () => {
  const STORAGE_KEY = 'robo-boy-custom-gamepads'

  let store: Record<string, string> = {}

  const createMockLocalStorage = () => ({
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  })

  let mockLocalStorage: ReturnType<typeof createMockLocalStorage>

  beforeEach(() => {
    store = {}
    mockLocalStorage = createMockLocalStorage()
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createMockLayout = (id: string, name: string): CustomGamepadLayout => ({
    id,
    name,
    description: 'Test layout',
    gridSize: { width: 8, height: 6 },
    cellSize: 80,
    components: [],
    rosConfig: {
      defaultTopic: '/joy',
      defaultMessageType: 'sensor_msgs/Joy',
    },
    metadata: {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      version: '1.0.0',
    },
  })

  describe('loadGamepadLibrary', () => {
    it('should return default library when nothing is stored', () => {
      const library = loadGamepadLibrary()

      expect(library).toHaveLength(defaultGamepadLibrary.length)
      expect(library.every((item) => item.isDefault)).toBe(true)
    })

    it('should combine defaults with custom layouts', () => {
      const customLayout = createMockLayout('custom-test', 'Custom Test')
      const storageData = {
        version: '1.0.0',
        customLayouts: [
          {
            id: 'custom-test',
            name: 'Custom Test',
            description: '',
            layout: customLayout,
            isDefault: false,
          },
        ],
        lastModified: new Date().toISOString(),
      }
      store[STORAGE_KEY] = JSON.stringify(storageData)

      const library = loadGamepadLibrary()

      expect(library).toHaveLength(defaultGamepadLibrary.length + 1)
      expect(library.find((item) => item.id === 'custom-test')).toBeDefined()
    })

    it('should return defaults on version mismatch', () => {
      const storageData = {
        version: '0.0.1', // Old version
        customLayouts: [],
        lastModified: new Date().toISOString(),
      }
      store[STORAGE_KEY] = JSON.stringify(storageData)
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })

      const library = loadGamepadLibrary()

      expect(library).toHaveLength(defaultGamepadLibrary.length)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('version mismatch')
      )
    })

    it('should return defaults on parse error', () => {
      store[STORAGE_KEY] = 'invalid json'
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })

      const library = loadGamepadLibrary()

      expect(library).toHaveLength(defaultGamepadLibrary.length)
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('saveCustomGamepad', () => {
    it('should save a new custom layout', () => {
      const layout = createMockLayout('custom-new', 'New Gamepad')

      const result = saveCustomGamepad(layout)

      expect(result).toBe(true)
      expect(mockLocalStorage.setItem).toHaveBeenCalled()
    })

    it('should update an existing custom layout', () => {
      // First save
      const layout = createMockLayout('custom-update', 'Update Test')
      saveCustomGamepad(layout)

      // Update
      const updatedLayout = { ...layout, name: 'Updated Name' }
      const result = saveCustomGamepad(updatedLayout)

      expect(result).toBe(true)

      // Verify the layout was updated, not duplicated
      const library = loadGamepadLibrary()
      const customLayouts = library.filter((item) => !item.isDefault)
      expect(customLayouts).toHaveLength(1)
    })

    it('should return false on storage error', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error('Storage error')
      })

      const layout = createMockLayout('custom-error', 'Error Test')
      const result = saveCustomGamepad(layout)

      expect(result).toBe(false)
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('deleteCustomGamepad', () => {
    it('should delete a custom layout', () => {
      const layout = createMockLayout('custom-delete', 'Delete Test')
      saveCustomGamepad(layout)

      const result = deleteCustomGamepad('custom-delete')

      expect(result).toBe(true)

      const library = loadGamepadLibrary()
      expect(library.find((item) => item.id === 'custom-delete')).toBeUndefined()
    })

    it('should not affect default layouts', () => {
      const result = deleteCustomGamepad('standard')

      expect(result).toBe(true)

      const library = loadGamepadLibrary()
      expect(library.find((item) => item.id === 'standard')).toBeDefined()
    })

    it('should return false on storage error', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error('Storage error')
      })

      const result = deleteCustomGamepad('any-id')

      expect(result).toBe(false)
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('getGamepadLayout', () => {
    it('should return a default layout by ID', () => {
      const layout = getGamepadLayout('standard')

      expect(layout).not.toBeNull()
      expect(layout?.name).toBe('Standard Dual Joystick')
    })

    it('should return a custom layout by ID', () => {
      const customLayout = createMockLayout('custom-get', 'Get Test')
      saveCustomGamepad(customLayout)

      const layout = getGamepadLayout('custom-get')

      expect(layout).not.toBeNull()
      expect(layout?.name).toBe('Get Test')
    })

    it('should return null for non-existent ID', () => {
      const layout = getGamepadLayout('non-existent')

      expect(layout).toBeNull()
    })
  })

  describe('generateGamepadId', () => {
    it('should generate ID from base name', () => {
      const id = generateGamepadId('My Gamepad')

      expect(id).toBe('custom-my-gamepad')
    })

    it('should handle special characters by replacing with dashes', () => {
      const id = generateGamepadId('Test@#$123')

      // The actual behavior: non-alphanumeric chars become dashes
      expect(id).toMatch(/^custom-test-+123$/)
    })

    it('should increment counter for duplicate IDs', () => {
      const layout1 = createMockLayout('custom-test', 'Test')
      saveCustomGamepad(layout1)

      const id = generateGamepadId('Test')

      expect(id).toBe('custom-test-1')
    })

    it('should find next available counter', () => {
      // Save layouts with incrementing IDs
      saveCustomGamepad(createMockLayout('custom-test', 'Test'))
      saveCustomGamepad(createMockLayout('custom-test-1', 'Test 1'))
      saveCustomGamepad(createMockLayout('custom-test-2', 'Test 2'))

      const id = generateGamepadId('Test')

      expect(id).toBe('custom-test-3')
    })
  })

  describe('exportGamepadLayouts', () => {
    it('should export all custom layouts when no IDs specified', () => {
      const layout = createMockLayout('custom-export', 'Export Test')
      saveCustomGamepad(layout)

      const exported = exportGamepadLayouts()
      const parsed = JSON.parse(exported)

      expect(parsed.version).toBe('1.0.0')
      expect(parsed.exportDate).toBeDefined()
      expect(parsed.layouts).toHaveLength(1)
      expect(parsed.layouts[0].id).toBe('custom-export')
    })

    it('should export specific layouts by ID', () => {
      saveCustomGamepad(createMockLayout('custom-1', 'One'))
      saveCustomGamepad(createMockLayout('custom-2', 'Two'))

      const exported = exportGamepadLayouts(['custom-1'])
      const parsed = JSON.parse(exported)

      expect(parsed.layouts).toHaveLength(1)
      expect(parsed.layouts[0].id).toBe('custom-1')
    })

    it('should return valid JSON for empty export', () => {
      const exported = exportGamepadLayouts()
      const parsed = JSON.parse(exported)

      expect(parsed.layouts).toEqual([])
    })
  })

  describe('importGamepadLayouts', () => {
    it('should import valid layouts', () => {
      const importData = {
        layouts: [createMockLayout('import-test', 'Import Test')],
      }

      const result = importGamepadLayouts(JSON.stringify(importData))

      expect(result.success).toBe(true)
      expect(result.imported).toBe(1)
      expect(result.errors).toHaveLength(0)
    })

    it('should generate new ID for conflicting layouts', () => {
      // Create existing layout
      saveCustomGamepad(createMockLayout('custom-conflict', 'Existing'))

      const importData = {
        layouts: [createMockLayout('custom-conflict', 'Imported')],
      }

      const result = importGamepadLayouts(JSON.stringify(importData))

      expect(result.success).toBe(true)
      expect(result.imported).toBe(1)

      // Original should still exist, imported gets new ID based on name
      const library = loadGamepadLibrary()
      const original = library.find((item) => item.id === 'custom-conflict')
      expect(original).toBeDefined()

      // Imported layout gets ID from its name "Imported" -> "custom-imported"
      const imported = library.find((item) => item.id === 'custom-imported')
      expect(imported).toBeDefined()
    })

    it('should reject invalid JSON', () => {
      const result = importGamepadLayouts('not valid json')

      expect(result.success).toBe(false)
      expect(result.imported).toBe(0)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should reject missing layouts array', () => {
      const result = importGamepadLayouts(JSON.stringify({ version: '1.0.0' }))

      expect(result.success).toBe(false)
      expect(result.errors).toContain('Invalid import format: missing layouts array')
    })

    it('should skip layouts with invalid structure', () => {
      const importData = {
        layouts: [
          { id: 'valid', name: 'Valid', components: [] },
          { id: 'invalid' }, // Missing required fields
        ],
      }

      const result = importGamepadLayouts(JSON.stringify(importData))

      expect(result.imported).toBe(1)
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  describe('clearCustomGamepads', () => {
    it('should remove all custom gamepads', () => {
      saveCustomGamepad(createMockLayout('custom-clear-1', 'Clear 1'))
      saveCustomGamepad(createMockLayout('custom-clear-2', 'Clear 2'))

      const result = clearCustomGamepads()

      expect(result).toBe(true)
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY)

      const library = loadGamepadLibrary()
      const customLayouts = library.filter((item) => !item.isDefault)
      expect(customLayouts).toHaveLength(0)
    })

    it('should return false on error', () => {
      mockLocalStorage.removeItem.mockImplementation(() => {
        throw new Error('Remove error')
      })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })

      const result = clearCustomGamepads()

      expect(result).toBe(false)
      expect(consoleSpy).toHaveBeenCalled()
    })
  })
})
