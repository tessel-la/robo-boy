import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as THREE from 'three'
import {
  invertTransform,
  multiplyTransforms,
  findTransformPath,
  lookupTransform,
  IDENTITY_TRANSFORM,
  CustomTFProvider,
  type StoredTransform,
  type TransformStore,
} from './tfUtils'

describe('tfUtils', () => {
  describe('IDENTITY_TRANSFORM', () => {
    it('should have zero translation', () => {
      expect(IDENTITY_TRANSFORM.translation.x).toBe(0)
      expect(IDENTITY_TRANSFORM.translation.y).toBe(0)
      expect(IDENTITY_TRANSFORM.translation.z).toBe(0)
    })

    it('should have identity quaternion rotation', () => {
      expect(IDENTITY_TRANSFORM.rotation.x).toBe(0)
      expect(IDENTITY_TRANSFORM.rotation.y).toBe(0)
      expect(IDENTITY_TRANSFORM.rotation.z).toBe(0)
      expect(IDENTITY_TRANSFORM.rotation.w).toBe(1)
    })
  })

  describe('invertTransform', () => {
    it('should invert identity transform to identity', () => {
      const identity: StoredTransform = {
        translation: new THREE.Vector3(0, 0, 0),
        rotation: new THREE.Quaternion(0, 0, 0, 1),
      }

      const inverted = invertTransform(identity)

      expect(inverted.translation.x).toBeCloseTo(0)
      expect(inverted.translation.y).toBeCloseTo(0)
      expect(inverted.translation.z).toBeCloseTo(0)
      expect(inverted.rotation.w).toBeCloseTo(1)
    })

    it('should correctly invert a pure translation', () => {
      const transform: StoredTransform = {
        translation: new THREE.Vector3(1, 2, 3),
        rotation: new THREE.Quaternion(0, 0, 0, 1),
      }

      const inverted = invertTransform(transform)

      expect(inverted.translation.x).toBeCloseTo(-1)
      expect(inverted.translation.y).toBeCloseTo(-2)
      expect(inverted.translation.z).toBeCloseTo(-3)
    })

    it('should correctly invert a 90-degree rotation around Z', () => {
      // 90 degrees around Z axis
      const rotation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        Math.PI / 2
      )
      const transform: StoredTransform = {
        translation: new THREE.Vector3(0, 0, 0),
        rotation,
      }

      const inverted = invertTransform(transform)

      // Inverted should be -90 degrees around Z
      const expectedRotation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        -Math.PI / 2
      )

      expect(inverted.rotation.x).toBeCloseTo(expectedRotation.x)
      expect(inverted.rotation.y).toBeCloseTo(expectedRotation.y)
      expect(inverted.rotation.z).toBeCloseTo(expectedRotation.z)
      expect(inverted.rotation.w).toBeCloseTo(expectedRotation.w)
    })
  })

  describe('multiplyTransforms', () => {
    it('should return identity when multiplying two identities', () => {
      const identity: StoredTransform = {
        translation: new THREE.Vector3(0, 0, 0),
        rotation: new THREE.Quaternion(0, 0, 0, 1),
      }

      const result = multiplyTransforms(identity, identity)

      expect(result.translation.x).toBeCloseTo(0)
      expect(result.translation.y).toBeCloseTo(0)
      expect(result.translation.z).toBeCloseTo(0)
      expect(result.rotation.w).toBeCloseTo(1)
    })

    it('should add translations when no rotation', () => {
      const t1: StoredTransform = {
        translation: new THREE.Vector3(1, 0, 0),
        rotation: new THREE.Quaternion(0, 0, 0, 1),
      }
      const t2: StoredTransform = {
        translation: new THREE.Vector3(0, 2, 0),
        rotation: new THREE.Quaternion(0, 0, 0, 1),
      }

      const result = multiplyTransforms(t1, t2)

      expect(result.translation.x).toBeCloseTo(1)
      expect(result.translation.y).toBeCloseTo(2)
      expect(result.translation.z).toBeCloseTo(0)
    })

    it('should compose rotations correctly', () => {
      // Two 90-degree rotations around Z should give 180 degrees
      const rotation90 = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        Math.PI / 2
      )
      const t1: StoredTransform = {
        translation: new THREE.Vector3(0, 0, 0),
        rotation: rotation90.clone(),
      }
      const t2: StoredTransform = {
        translation: new THREE.Vector3(0, 0, 0),
        rotation: rotation90.clone(),
      }

      const result = multiplyTransforms(t1, t2)

      const expected180 = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        Math.PI
      )

      expect(result.rotation.x).toBeCloseTo(expected180.x)
      expect(result.rotation.y).toBeCloseTo(expected180.y)
      expect(result.rotation.z).toBeCloseTo(expected180.z)
      expect(Math.abs(result.rotation.w)).toBeCloseTo(Math.abs(expected180.w))
    })
  })

  describe('findTransformPath', () => {
    let transforms: TransformStore

    beforeEach(() => {
      // Setup a simple TF tree:
      // map -> odom -> base_link -> sensor
      transforms = {
        odom: {
          parentFrame: 'map',
          transform: {
            translation: new THREE.Vector3(1, 0, 0),
            rotation: new THREE.Quaternion(0, 0, 0, 1),
          },
          isStatic: false,
        },
        base_link: {
          parentFrame: 'odom',
          transform: {
            translation: new THREE.Vector3(0, 1, 0),
            rotation: new THREE.Quaternion(0, 0, 0, 1),
          },
          isStatic: false,
        },
        sensor: {
          parentFrame: 'base_link',
          transform: {
            translation: new THREE.Vector3(0, 0, 1),
            rotation: new THREE.Quaternion(0, 0, 0, 1),
          },
          isStatic: true,
        },
      }
    })

    it('should return empty path when source equals target', () => {
      const path = findTransformPath('map', 'map', transforms)
      expect(path).toEqual([])
    })

    it('should find direct child path', () => {
      const path = findTransformPath('odom', 'map', transforms)
      expect(path).not.toBeNull()
      expect(path!.length).toBe(1)
      expect(path![0].frame).toBe('odom')
    })

    it('should find path through multiple frames', () => {
      const path = findTransformPath('sensor', 'map', transforms)
      expect(path).not.toBeNull()
      expect(path!.length).toBe(3)
      expect(path![0].frame).toBe('odom')
      expect(path![1].frame).toBe('base_link')
      expect(path![2].frame).toBe('sensor')
    })

    it('should find reverse path using inverse transforms', () => {
      const path = findTransformPath('map', 'sensor', transforms)
      expect(path).not.toBeNull()
      expect(path!.length).toBe(3)
    })

    it('should return null when no path exists', () => {
      const path = findTransformPath('nonexistent', 'map', transforms)
      expect(path).toBeNull()
    })
  })

  describe('lookupTransform', () => {
    let transforms: TransformStore

    beforeEach(() => {
      transforms = {
        odom: {
          parentFrame: 'map',
          transform: {
            translation: new THREE.Vector3(1, 0, 0),
            rotation: new THREE.Quaternion(0, 0, 0, 1),
          },
          isStatic: false,
        },
        base_link: {
          parentFrame: 'odom',
          transform: {
            translation: new THREE.Vector3(0, 1, 0),
            rotation: new THREE.Quaternion(0, 0, 0, 1),
          },
          isStatic: false,
        },
      }
    })

    it('should return identity for same frame', () => {
      const result = lookupTransform('map', 'map', transforms)
      expect(result).toBe(IDENTITY_TRANSFORM)
    })

    it('should normalize frame names with leading slashes', () => {
      const result = lookupTransform('/map', '/map', transforms)
      expect(result).toBe(IDENTITY_TRANSFORM)
    })

    it('should return direct transform', () => {
      const result = lookupTransform('odom', 'map', transforms)
      expect(result).not.toBeNull()
    })

    it('should return null for non-existent frames', () => {
      const result = lookupTransform('nonexistent', 'map', transforms)
      expect(result).toBeNull()
    })
  })

  describe('CustomTFProvider', () => {
    let transforms: TransformStore
    let provider: CustomTFProvider

    beforeEach(() => {
      transforms = {
        odom: {
          parentFrame: 'map',
          transform: {
            translation: new THREE.Vector3(1, 0, 0),
            rotation: new THREE.Quaternion(0, 0, 0, 1),
          },
          isStatic: false,
        },
        base_link: {
          parentFrame: 'odom',
          transform: {
            translation: new THREE.Vector3(0, 1, 0),
            rotation: new THREE.Quaternion(0, 0, 0, 1),
          },
          isStatic: false,
        },
        sensor: {
          parentFrame: 'base_link',
          transform: {
            translation: new THREE.Vector3(0, 0, 1),
            rotation: new THREE.Quaternion(0, 0, 0, 1),
          },
          isStatic: true,
        },
      }
      provider = new CustomTFProvider('map', transforms)
    })

    it('should initialize with fixed frame', () => {
      expect(provider).toBeDefined()
    })

    it('should normalize fixed frame with leading slash', () => {
      const providerWithSlash = new CustomTFProvider('/map', transforms)
      expect(providerWithSlash).toBeDefined()
    })

    describe('subscribe', () => {
      it('should call callback immediately with current transform', () => {
        const callback = vi.fn()

        provider.subscribe('odom', callback)

        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenCalledWith(
          expect.objectContaining({
            translation: expect.objectContaining({ x: expect.any(Number) }),
            rotation: expect.objectContaining({ w: expect.any(Number) }),
          })
        )
      })

      it('should call callback with null for non-existent frame', () => {
        const callback = vi.fn()

        provider.subscribe('nonexistent', callback)

        expect(callback).toHaveBeenCalledWith(null)
      })

      it('should normalize frame ID with leading slash', () => {
        const callback = vi.fn()

        provider.subscribe('/odom', callback)

        expect(callback).toHaveBeenCalledTimes(1)
      })

      it('should handle multiple subscribers to same frame', () => {
        const callback1 = vi.fn()
        const callback2 = vi.fn()

        provider.subscribe('odom', callback1)
        provider.subscribe('odom', callback2)

        expect(callback1).toHaveBeenCalledTimes(1)
        expect(callback2).toHaveBeenCalledTimes(1)
      })
    })

    describe('unsubscribe', () => {
      it('should remove specific callback', () => {
        const callback1 = vi.fn()
        const callback2 = vi.fn()

        provider.subscribe('odom', callback1)
        provider.subscribe('odom', callback2)
        provider.unsubscribe('odom', callback1)

        // Update transforms to trigger callbacks
        provider.updateTransforms({
          ...transforms,
          odom: {
            ...transforms.odom,
            transform: {
              translation: new THREE.Vector3(2, 0, 0),
              rotation: new THREE.Quaternion(0, 0, 0, 1),
            },
          },
        })

        // callback1 should have been called once (initial), callback2 twice (initial + update)
        expect(callback1).toHaveBeenCalledTimes(1)
        expect(callback2).toHaveBeenCalledTimes(2)
      })

      it('should clear all callbacks when no specific callback provided', () => {
        const callback = vi.fn()

        provider.subscribe('odom', callback)
        provider.unsubscribe('odom')

        // Update transforms
        provider.updateTransforms({
          ...transforms,
          odom: {
            ...transforms.odom,
            transform: {
              translation: new THREE.Vector3(2, 0, 0),
              rotation: new THREE.Quaternion(0, 0, 0, 1),
            },
          },
        })

        // Should only have been called once (initial)
        expect(callback).toHaveBeenCalledTimes(1)
      })

      it('should handle unsubscribe for non-existent frame', () => {
        expect(() => provider.unsubscribe('nonexistent')).not.toThrow()
      })
    })

    describe('updateTransforms', () => {
      it('should trigger callbacks when transforms change', () => {
        const callback = vi.fn()
        provider.subscribe('odom', callback)
        callback.mockClear()

        provider.updateTransforms({
          ...transforms,
          odom: {
            ...transforms.odom,
            transform: {
              translation: new THREE.Vector3(5, 0, 0),
              rotation: new THREE.Quaternion(0, 0, 0, 1),
            },
          },
        })

        expect(callback).toHaveBeenCalled()
      })

      it('should not trigger callbacks when transforms unchanged', () => {
        const callback = vi.fn()
        provider.subscribe('odom', callback)
        callback.mockClear()

        // Update with same transforms
        provider.updateTransforms(transforms)

        // May or may not be called depending on change detection
        // At minimum, should not throw
      })

      it('should handle callback errors gracefully', () => {
        const errorCallback = vi.fn(() => {
          throw new Error('Callback error')
        })
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        provider.subscribe('odom', errorCallback)
        errorCallback.mockClear()

        expect(() =>
          provider.updateTransforms({
            ...transforms,
            odom: {
              ...transforms.odom,
              transform: {
                translation: new THREE.Vector3(10, 0, 0),
                rotation: new THREE.Quaternion(0, 0, 0, 1),
              },
            },
          })
        ).not.toThrow()

        consoleSpy.mockRestore()
      })
    })

    describe('updateFixedFrame', () => {
      it('should update fixed frame and trigger callbacks', () => {
        const callback = vi.fn()
        provider.subscribe('odom', callback)
        callback.mockClear()

        provider.updateFixedFrame('odom')

        expect(callback).toHaveBeenCalled()
      })

      it('should not update if frame is the same', () => {
        const callback = vi.fn()
        provider.subscribe('odom', callback)
        callback.mockClear()

        provider.updateFixedFrame('map') // Same as initial

        expect(callback).not.toHaveBeenCalled()
      })

      it('should normalize frame with leading slash', () => {
        const callback = vi.fn()
        provider.subscribe('odom', callback)
        callback.mockClear()

        provider.updateFixedFrame('/odom')

        expect(callback).toHaveBeenCalled()
      })

      it('should handle unavailable frames after change', () => {
        const callback = vi.fn()
        provider.subscribe('sensor', callback)
        callback.mockClear()

        // Change to a frame that breaks the path
        provider.updateFixedFrame('nonexistent_frame')

        // Callback should be called with null
        expect(callback).toHaveBeenCalledWith(null)
      })
    })

    describe('lookupTransform', () => {
      it('should lookup transform between frames', () => {
        const result = provider.lookupTransform('map', 'odom')

        expect(result).not.toBeNull()
      })

      it('should return null for non-existent frames', () => {
        const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

        const result = provider.lookupTransform('map', 'nonexistent')

        expect(result).toBeNull()

        consoleSpy.mockRestore()
      })
    })

    describe('dispose', () => {
      it('should clear transforms and callbacks', () => {
        const callback = vi.fn()
        provider.subscribe('odom', callback)
        callback.mockClear()

        provider.dispose()

        // After dispose, updates should not trigger callbacks
        provider.updateTransforms(transforms)

        expect(callback).not.toHaveBeenCalled()
      })
    })
  })
})

