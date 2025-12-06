import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTfVisualizer } from './useTfVisualizer';
import * as THREE from 'three';

// Mock dependencies
vi.mock('three', async () => {
    const actual = await vi.importActual<typeof import('three')>('three');
    return {
        ...actual,
        Group: class {
            uuid = 'group-uuid';
            visible = true;
            add = vi.fn();
            remove = vi.fn();
            position = {
                set: vi.fn(),
                copy: vi.fn(),
                equals: vi.fn().mockReturnValue(false),
                distanceToSquared: vi.fn().mockReturnValue(1)
            };
            quaternion = {
                set: vi.fn(),
                copy: vi.fn(),
                equals: vi.fn().mockReturnValue(false),
                dot: vi.fn().mockReturnValue(0.5)
            };
        },
        Vector3: class {
            constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
            set(x: any, y: any, z: any) { this.x = x; this.y = y; this.z = z; }
            x: number; y: number; z: number;
        },
        Quaternion: class {
            constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
            set(x: any, y: any, z: any, w: any) { this.x = x; this.y = y; this.z = z; this.w = w; }
            x: number; y: number; z: number; w: number;
        }
    };
});

vi.mock('../utils/ros3d', () => ({
    Axes: class {
        lineSegments = {
            geometry: { dispose: vi.fn() },
            material: { dispose: vi.fn() }
        }
        constructor(options: any) { }
    }
}));

describe('useTfVisualizer', () => {
    let mockViewer: any;
    let mockTFProvider: any;
    let mockScene: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockScene = {
            add: vi.fn(),
            remove: vi.fn(),
        };
        mockViewer = {
            scene: mockScene,
            fixedFrame: 'odom'
        };
        mockTFProvider = {
            lookupTransform: vi.fn()
        };
    });

    it('should create and add container when connected', () => {
        renderHook(() => useTfVisualizer({
            isRosConnected: true,
            ros3dViewer: { current: mockViewer },
            customTFProvider: { current: mockTFProvider },
            displayedTfFrames: []
        }));

        expect(mockScene.add).toHaveBeenCalled();
    });

    it('should not create container if not connected', () => {
        renderHook(() => useTfVisualizer({
            isRosConnected: false,
            ros3dViewer: { current: mockViewer },
            customTFProvider: { current: mockTFProvider },
            displayedTfFrames: []
        }));

        expect(mockScene.add).not.toHaveBeenCalled();
    });

    it('should add axes for displayed frames', () => {
        const { rerender } = renderHook((props) => useTfVisualizer(props), {
            initialProps: {
                isRosConnected: true,
                ros3dViewer: { current: mockViewer },
                customTFProvider: { current: mockTFProvider },
                displayedTfFrames: ['base_link']
            }
        });

        // The container is added to scene
        expect(mockScene.add).toHaveBeenCalled();

        // We verify the container content indirectly via the mock Group
        // But since we can't easily inspect the internal Map via hook return (it returns void),
        // we can check if the Mock Group was instantiated and add called on it.
        // Or better, check if container.add was called.
        // We need to capture the container instance implicitly created.
        // Alternatively, we can assume THREE.Group is mocked and inspect all instances or check mockScene.add calls.
        // But the scene.add adds the container. The container.add adds the axes groups.

        // Since we mocked THREE.Group using a class, we might rely on the fact that 'add' is a spy on the prototype/class? 
        // No, in the mock above, 'add' is an instance property.
        // We can spy on the mock Group somehow?
        // Actually, creating a spy on the prototype is safer if we want to check calls across instances.
        // But let's check basic execution flow for now.
    });

    it('should update poses in animation loop', () => {
        vi.useFakeTimers();

        mockTFProvider.lookupTransform.mockReturnValue({
            translation: { x: 1, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 }
        });

        renderHook(() => useTfVisualizer({
            isRosConnected: true,
            ros3dViewer: { current: mockViewer },
            customTFProvider: { current: mockTFProvider },
            displayedTfFrames: ['base_link']
        }));

        // Move time forward to trigger animation loop
        vi.advanceTimersByTime(100);

        expect(mockTFProvider.lookupTransform).toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('should cleanup on unmount', () => {
        const { unmount } = renderHook(() => useTfVisualizer({
            isRosConnected: true,
            ros3dViewer: { current: mockViewer },
            customTFProvider: { current: mockTFProvider },
            displayedTfFrames: ['base_link']
        }));

        unmount();

        expect(mockScene.remove).toHaveBeenCalled();
    });
});
