import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCameraInfoVisualizer } from './useCameraInfoVisualizer';
import * as THREE from 'three';
import { CustomTFProvider } from '../utils/tfUtils';
import { Topic } from 'roslib';

// Mock dependencies
vi.mock('roslib', () => ({
    Ros: vi.fn(),
    Topic: vi.fn(),
}));

// Mock THREE
vi.mock('three', async () => {
    const actual = await vi.importActual<typeof import('three')>('three');
    return {
        ...actual,
        Group: class {
            visible = true;
            add = vi.fn();
            remove = vi.fn();
            position = { set: vi.fn(), copy: vi.fn(), distanceToSquared: vi.fn().mockReturnValue(1) };
            quaternion = {
                set: vi.fn(),
                copy: vi.fn(),
                multiply: vi.fn(),
                dot: vi.fn().mockReturnValue(0),
                equals: vi.fn().mockReturnValue(false),
            };
            clear = vi.fn();
            children = [];
        },
        LineSegments: class {
            visible = true;
            geometry = {
                dispose: vi.fn(),
                setAttribute: vi.fn(),
                setIndex: vi.fn(),
                getAttribute: vi.fn().mockReturnValue({
                    array: new Float32Array(100),
                    needsUpdate: false,
                }),
                getIndex: vi.fn().mockReturnValue({
                    array: [],
                }),
            };
            material = {
                dispose: vi.fn(),
                color: { getHex: vi.fn(), set: vi.fn() },
            };
            constructor(geom: any, mat: any) {
                // keep refs
            }
        },
        BufferGeometry: class {
            setAttribute = vi.fn();
            setIndex = vi.fn();
            dispose = vi.fn();
        },
        BufferAttribute: class {
            constructor(array: any, itemSize: any) { }
        },
        LineBasicMaterial: class {
            color = { getHex: vi.fn(), set: vi.fn() };
            dispose = vi.fn();
            constructor(opts: any) { }
        },
        Quaternion: class {
            constructor(x?: any, y?: any, z?: any, w?: any) { }
            set = vi.fn();
            copy = vi.fn();
            multiply = vi.fn();
        },
        Color: class {
            getHex = vi.fn();
            set = vi.fn();
        }
    };
});

describe('useCameraInfoVisualizer', () => {
    let mockRos: any;
    let mockViewer: any;
    let mockTFProvider: any;
    let mockScene: any;
    let defaultProps: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockRos = { isConnected: true };
        mockScene = {
            add: vi.fn(),
            remove: vi.fn(),
        };
        mockViewer = {
            scene: mockScene,
            fixedFrame: 'map',
            requestRender: vi.fn(),
        };
        mockTFProvider = {
            lookupTransform: vi.fn(),
        };

        defaultProps = {
            ros: mockRos,
            isRosConnected: true,
            ros3dViewer: { current: mockViewer },
            customTFProvider: { current: mockTFProvider },
            selectedCameraInfoTopic: '/camera_info',
            lineColor: 0x00ff00,
            lineScale: 1.0,
        };

        // Default Topic mock implementation
        (Topic as any).mockImplementation(function () {
            return {
                subscribe: vi.fn(),
                unsubscribe: vi.fn(),
            }
        });
    });

    it('should initialize and create container when connected', () => {
        renderHook(() => useCameraInfoVisualizer(defaultProps));
        expect(mockScene.add).toHaveBeenCalled(); // Should add Group
    });

    it('should cleanup on unmount', () => {
        const { unmount } = renderHook(() => useCameraInfoVisualizer(defaultProps));
        unmount();
        expect(mockScene.remove).toHaveBeenCalled();
    });

    it('should subscribe to camera info topic', () => {
        const mockSubscribe = vi.fn();
        (Topic as any).mockImplementation(function () {
            return {
                subscribe: mockSubscribe,
                unsubscribe: vi.fn(),
            }
        });

        renderHook(() => useCameraInfoVisualizer(defaultProps));
        expect(Topic).toHaveBeenCalledWith(expect.objectContaining({
            name: '/camera_info',
        }));
        expect(mockSubscribe).toHaveBeenCalled();
    });

    it('should not initialize if disconnected', () => {
        renderHook(() => useCameraInfoVisualizer({
            ...defaultProps,
            isRosConnected: false,
        }));
        expect(mockScene.add).not.toHaveBeenCalled();
    });

    it('should update geometry when message received', async () => {
        let messageCallback: any;
        (Topic as any).mockImplementation(function () {
            return {
                subscribe: (cb: any) => { messageCallback = cb; },
                unsubscribe: vi.fn(),
            }
        });

        renderHook(() => useCameraInfoVisualizer(defaultProps));

        // Simulate message
        const msg = {
            header: { frame_id: 'camera_frame' },
            k: [100, 0, 50, 0, 100, 50, 0, 0, 1],
            width: 100,
            height: 100,
        };

        act(() => messageCallback?.(msg));
    });

    it('requests renders when the camera pose changes or becomes unavailable', () => {
        const scheduledFrames = new Map<number, FrameRequestCallback>();
        let nextFrameId = 1;
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            const frameId = nextFrameId++;
            scheduledFrames.set(frameId, callback);
            return frameId;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(frameId => {
            scheduledFrames.delete(frameId);
        });

        let messageCallback: ((message: unknown) => void) | undefined;
        (Topic as any).mockImplementation(function () {
            return {
                subscribe: (callback: (message: unknown) => void) => { messageCallback = callback; },
                unsubscribe: vi.fn(),
            };
        });
        mockTFProvider.lookupTransform.mockReturnValue({
            translation: { x: 1, y: 2, z: 3 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
        });

        const { unmount } = renderHook(() => useCameraInfoVisualizer(defaultProps));
        act(() => {
            messageCallback?.({
                header: { frame_id: '/camera_frame' },
                k: [100, 0, 50, 0, 100, 50, 0, 0, 1],
                width: 100,
                height: 100,
            });
        });
        mockViewer.requestRender.mockClear();

        const runNextFrame = () => {
            const nextFrame = scheduledFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
            expect(nextFrame).toBeDefined();
            scheduledFrames.delete(nextFrame![0]);
            act(() => nextFrame![1](performance.now()));
        };

        runNextFrame();
        expect(mockTFProvider.lookupTransform).toHaveBeenCalledWith('map', 'camera_frame');
        expect(mockViewer.requestRender).toHaveBeenCalledTimes(1);

        const container = mockScene.add.mock.calls[0][0];
        mockViewer.requestRender.mockClear();
        mockTFProvider.lookupTransform.mockReturnValue(null);
        runNextFrame();
        expect(container.visible).toBe(false);
        expect(mockViewer.requestRender).toHaveBeenCalledTimes(1);

        unmount();
        expect(scheduledFrames).toHaveLength(0);
    });

    it.skip('should update pose in animation loop', async () => {
        vi.useFakeTimers();
        mockTFProvider.lookupTransform.mockReturnValue({
            translation: { x: 1, y: 2, z: 3 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
        });

        // Simulate message to set cameraFrameId
        let messageCallback: any;
        (Topic as any).mockImplementation(function () {
            return {
                subscribe: (cb: any) => { messageCallback = cb; },
                unsubscribe: vi.fn(),
            }
        });

        renderHook(() => useCameraInfoVisualizer(defaultProps));

        if (messageCallback) {
            messageCallback({ header: { frame_id: 'camera_frame' } });
        }

        // Fast forward to trigger animation frame
        vi.advanceTimersByTime(100);

        expect(mockTFProvider.lookupTransform).toHaveBeenCalled();
        vi.useRealTimers();
    });
});
