import { describe, it, expect } from 'vitest'
import {
  defaultStandardLayout,
  defaultGameBoyLayout,
  defaultDroneLayout,
  defaultManipulatorLayout,
  defaultMobileLayout,
  defaultGamepadLibrary,
  componentLibrary,
} from './defaultLayouts'
import type { CustomGamepadLayout, GamepadLibraryItem } from './types'

describe('defaultLayouts', () => {
  const validateLayout = (layout: CustomGamepadLayout) => {
    expect(layout.id).toBeTruthy()
    expect(layout.name).toBeTruthy()
    expect(layout.gridSize).toBeDefined()
    expect(layout.gridSize.width).toBeGreaterThan(0)
    expect(layout.gridSize.height).toBeGreaterThan(0)
    expect(layout.cellSize).toBeGreaterThan(0)
    expect(Array.isArray(layout.components)).toBe(true)
    expect(layout.rosConfig).toBeDefined()
    expect(layout.metadata).toBeDefined()
    expect(layout.metadata.version).toBeTruthy()
  }

  const validateComponent = (component: CustomGamepadLayout['components'][0]) => {
    expect(component.id).toBeTruthy()
    expect(['joystick', 'button', 'dpad', 'toggle', 'slider']).toContain(component.type)
    expect(component.position).toBeDefined()
    expect(component.position.x).toBeGreaterThanOrEqual(0)
    expect(component.position.y).toBeGreaterThanOrEqual(0)
    expect(component.position.width).toBeGreaterThan(0)
    expect(component.position.height).toBeGreaterThan(0)
  }

  describe('defaultStandardLayout', () => {
    it('should be a valid layout', () => {
      validateLayout(defaultStandardLayout)
    })

    it('should have correct ID and name', () => {
      expect(defaultStandardLayout.id).toBe('default-standard')
      expect(defaultStandardLayout.name).toBe('Standard Dual Joystick')
    })

    it('should have two joystick components', () => {
      const joysticks = defaultStandardLayout.components.filter(
        (c) => c.type === 'joystick'
      )
      expect(joysticks).toHaveLength(2)
    })

    it('should have valid components', () => {
      defaultStandardLayout.components.forEach(validateComponent)
    })
  })

  describe('defaultGameBoyLayout', () => {
    it('should be a valid layout', () => {
      validateLayout(defaultGameBoyLayout)
    })

    it('should have correct ID and name', () => {
      expect(defaultGameBoyLayout.id).toBe('default-gameboy')
      expect(defaultGameBoyLayout.name).toBe('GameBoy Style')
    })

    it('should have a D-pad component', () => {
      const dpad = defaultGameBoyLayout.components.find((c) => c.type === 'dpad')
      expect(dpad).toBeDefined()
    })

    it('should have A and B buttons', () => {
      const buttons = defaultGameBoyLayout.components.filter((c) => c.type === 'button')
      expect(buttons.length).toBeGreaterThanOrEqual(2)
      expect(buttons.find((b) => b.label === 'A')).toBeDefined()
      expect(buttons.find((b) => b.label === 'B')).toBeDefined()
    })

    it('should have valid components', () => {
      defaultGameBoyLayout.components.forEach(validateComponent)
    })
  })

  describe('defaultDroneLayout', () => {
    it('should be a valid layout', () => {
      validateLayout(defaultDroneLayout)
    })

    it('should have correct ID and name', () => {
      expect(defaultDroneLayout.id).toBe('default-drone')
      expect(defaultDroneLayout.name).toBe('Drone Control')
    })

    it('should have arm toggle', () => {
      const armToggle = defaultDroneLayout.components.find(
        (c) => c.type === 'toggle' && c.label?.includes('ARM')
      )
      expect(armToggle).toBeDefined()
    })

    it('should have takeoff and land buttons', () => {
      const takeoff = defaultDroneLayout.components.find((c) =>
        c.label?.includes('TAKEOFF')
      )
      const land = defaultDroneLayout.components.find((c) => c.label?.includes('LAND'))
      expect(takeoff).toBeDefined()
      expect(land).toBeDefined()
    })

    it('should have valid components', () => {
      defaultDroneLayout.components.forEach(validateComponent)
    })
  })

  describe('defaultManipulatorLayout', () => {
    it('should be a valid layout', () => {
      validateLayout(defaultManipulatorLayout)
    })

    it('should have correct ID and name', () => {
      expect(defaultManipulatorLayout.id).toBe('default-manipulator')
      expect(defaultManipulatorLayout.name).toBe('Manipulator Control')
    })

    it('should have slider components', () => {
      const sliders = defaultManipulatorLayout.components.filter(
        (c) => c.type === 'slider'
      )
      expect(sliders.length).toBeGreaterThan(0)
    })

    it('should have gripper toggle', () => {
      const gripper = defaultManipulatorLayout.components.find(
        (c) => c.type === 'toggle' && c.label?.includes('Gripper')
      )
      expect(gripper).toBeDefined()
    })

    it('should have valid components', () => {
      defaultManipulatorLayout.components.forEach(validateComponent)
    })
  })

  describe('defaultMobileLayout', () => {
    it('should be a valid layout', () => {
      validateLayout(defaultMobileLayout)
    })

    it('should have correct ID and name', () => {
      expect(defaultMobileLayout.id).toBe('default-mobile')
      expect(defaultMobileLayout.name).toBe('Mobile Optimized')
    })

    it('should have smaller grid for mobile', () => {
      expect(defaultMobileLayout.gridSize.width).toBeLessThanOrEqual(6)
    })

    it('should have larger cell size for touch', () => {
      expect(defaultMobileLayout.cellSize).toBeGreaterThanOrEqual(100)
    })

    it('should have valid components', () => {
      defaultMobileLayout.components.forEach(validateComponent)
    })
  })

  describe('defaultGamepadLibrary', () => {
    it('should contain all default layouts', () => {
      expect(defaultGamepadLibrary).toHaveLength(5)
    })

    it('should have all items marked as default', () => {
      expect(defaultGamepadLibrary.every((item) => item.isDefault)).toBe(true)
    })

    it('should have unique IDs', () => {
      const ids = defaultGamepadLibrary.map((item) => item.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('should include mobile layout', () => {
      const mobile = defaultGamepadLibrary.find((item) => item.id === 'mobile')
      expect(mobile).toBeDefined()
      expect(mobile?.layout.id).toBe('default-mobile')
    })

    it('should include standard layout', () => {
      const standard = defaultGamepadLibrary.find((item) => item.id === 'standard')
      expect(standard).toBeDefined()
    })

    it('should include gameboy layout', () => {
      const gameboy = defaultGamepadLibrary.find((item) => item.id === 'gameboy')
      expect(gameboy).toBeDefined()
    })

    it('should include drone layout', () => {
      const drone = defaultGamepadLibrary.find((item) => item.id === 'drone')
      expect(drone).toBeDefined()
    })

    it('should include manipulator layout', () => {
      const manipulator = defaultGamepadLibrary.find((item) => item.id === 'manipulator')
      expect(manipulator).toBeDefined()
    })

    it('should have valid library items', () => {
      defaultGamepadLibrary.forEach((item: GamepadLibraryItem) => {
        expect(item.id).toBeTruthy()
        expect(item.name).toBeTruthy()
        expect(typeof item.description).toBe('string')
        expect(item.layout).toBeDefined()
        validateLayout(item.layout)
      })
    })
  })

  describe('componentLibrary', () => {
    it('should have all component types', () => {
      const types = componentLibrary.map((c) => c.type)
      expect(types).toContain('joystick')
      expect(types).toContain('button')
      expect(types).toContain('dpad')
      expect(types).toContain('toggle')
      expect(types).toContain('slider')
    })

    it('should have 5 component types', () => {
      expect(componentLibrary).toHaveLength(5)
    })

    it('should have valid default sizes', () => {
      componentLibrary.forEach((comp) => {
        expect(comp.defaultSize).toBeDefined()
        expect(comp.defaultSize.width).toBeGreaterThan(0)
        expect(comp.defaultSize.height).toBeGreaterThan(0)
      })
    })

    it('should have names and descriptions', () => {
      componentLibrary.forEach((comp) => {
        expect(comp.name).toBeTruthy()
        expect(comp.description).toBeTruthy()
      })
    })

    it('should have icons', () => {
      componentLibrary.forEach((comp) => {
        expect(comp.icon).toBeTruthy()
      })
    })

    it('should have joystick with 2x2 default size', () => {
      const joystick = componentLibrary.find((c) => c.type === 'joystick')
      expect(joystick?.defaultSize).toEqual({ width: 2, height: 2 })
    })

    it('should have button with 1x1 default size', () => {
      const button = componentLibrary.find((c) => c.type === 'button')
      expect(button?.defaultSize).toEqual({ width: 1, height: 1 })
    })
  })
})

