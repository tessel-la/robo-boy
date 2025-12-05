import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  saveVisualizationState,
  getVisualizationState,
  clearVisualizationState,
} from './visualizationState'

describe('visualizationState', () => {
  const mockLocalStorage = (() => {
    let store: Record<string, string> = {}
    return {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key]
      }),
      clear: () => {
        store = {}
      },
    }
  })()

  beforeEach(() => {
    // Reset localStorage mock
    mockLocalStorage.clear()
    mockLocalStorage.getItem.mockClear()
    mockLocalStorage.setItem.mockClear()
    mockLocalStorage.removeItem.mockClear()

    // Replace global localStorage
    Object.defineProperty(global, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    })

    // Clear module state by clearing saved state
    clearVisualizationState()
  })

  describe('saveVisualizationState', () => {
    it('should save state to localStorage', () => {
      const state = {
        visualizations: [{ id: '1', type: 'pointcloud', topic: '/scan' }],
        fixedFrame: 'map',
        displayedTfFrames: ['base_link'],
      }

      saveVisualizationState(state)

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'roboboy_3d_visualization_state',
        JSON.stringify(state)
      )
    })

    it('should handle localStorage errors gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error('Storage full')
      })

      const state = {
        visualizations: [],
        fixedFrame: 'odom',
        displayedTfFrames: [],
      }

      // Should not throw
      expect(() => saveVisualizationState(state)).not.toThrow()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('getVisualizationState', () => {
    it('should return default state when nothing is saved', () => {
      const state = getVisualizationState()

      expect(state).toEqual({
        visualizations: [],
        fixedFrame: 'odom',
        displayedTfFrames: [],
      })
    })

    it('should return in-memory state if visualizations exist', () => {
      const savedState = {
        visualizations: [{ id: '1', type: 'laser', topic: '/scan' }],
        fixedFrame: 'world',
        displayedTfFrames: ['odom'],
      }

      saveVisualizationState(savedState)
      mockLocalStorage.getItem.mockClear() // Clear to verify in-memory is used

      const state = getVisualizationState()

      expect(state.visualizations).toHaveLength(1)
      expect(state.fixedFrame).toBe('world')
    })

    it('should load from localStorage if in-memory state is empty', () => {
      const storedState = {
        visualizations: [{ id: '2', type: 'urdf', topic: '/robot' }],
        fixedFrame: 'base_link',
        displayedTfFrames: ['arm_link'],
      }

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(storedState))

      const state = getVisualizationState()

      expect(state).toEqual(storedState)
    })

    it('should handle localStorage parse errors gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockLocalStorage.getItem.mockReturnValue('invalid json')

      const state = getVisualizationState()

      expect(state).toEqual({
        visualizations: [],
        fixedFrame: 'odom',
        displayedTfFrames: [],
      })
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('clearVisualizationState', () => {
    it('should reset to default state', () => {
      const state = {
        visualizations: [{ id: '1', type: 'test', topic: '/test' }],
        fixedFrame: 'custom',
        displayedTfFrames: ['frame1'],
      }
      saveVisualizationState(state)

      clearVisualizationState()

      const clearedState = getVisualizationState()
      expect(clearedState).toEqual({
        visualizations: [],
        fixedFrame: 'odom',
        displayedTfFrames: [],
      })
    })

    it('should remove from localStorage', () => {
      clearVisualizationState()

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
        'roboboy_3d_visualization_state'
      )
    })

    it('should handle localStorage errors gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockLocalStorage.removeItem.mockImplementation(() => {
        throw new Error('Remove failed')
      })

      expect(() => clearVisualizationState()).not.toThrow()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })
})

