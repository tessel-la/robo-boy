import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePoseStampedClient } from './usePoseStampedClient';
import * as THREE from 'three';
import { Topic } from 'roslib';
import { CustomTFProvider } from '../utils/tfUtils';

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
            clear = vi.fn();
            position = { set: vi.fn(), copy: vi.fn() };
            quaternion = { set: vi.fn(), copy: vi.fn() };
            children = [];
        },
        Mesh: class {
            rotateZ = vi.fn();
            position = { set: vi.fn() };
        },
        CylinderGeometry: class { },
        ConeGeometry: class { },
        MeshLambertMaterial: class { },
        AxesHelper: class { },
        Vector3: class {
            x: number; y: number; z: number;
            constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
            clone() { return new (this.constructor as any)(this.x, this.y, this.z); }
        },
        Quaternion: class {
            x: number; y: number; z: number; w: number;
            constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
        },
        Color: class {
            constructor(hex: any) { }
        },
        Line: class {
            geometry = { dispose: vi.fn() };
            material = { dispose: vi.fn() };
        },
        BufferGeometry: class {
            setFromPoints = vi.fn().mockReturnThis();
            dispose = vi.fn();
        },
        LineBasicMaterial: class {
            dispose = vi.fn();
        }
    };
});

// Mock ROS3D
vi.mock('../utils/ros3d', () => ({
    Viewer: vi.fn(),
    Axes: class {
        position = { copy: vi.fn() };
        quaternion = { copy: vi.fn() };
    }
}));

describe('usePoseStampedClient', () => {
    let mockRos: any;
    let mockViewer: any;
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
            addObject: vi.fn(),
        };

        defaultProps = {
            ros: mockRos,
            isRosConnected: true,
            ros3dViewer: { current: mockViewer },
            customTFProvider: { current: {} }, // Mock TF Provider ref
            topic: '/pose',
            fixedFrame: 'map',
            options: {
                visualizationType: 'arrow',
                scale: 1.0,
                color: '#ff0000',
            }
        };
    });

    it('should initialize and subscribe when connected', () => {
        const mockSubscribe = vi.fn();
        (Topic as any).mockImplementation(function () {
            return {
                subscribe: mockSubscribe,
                unsubscribe: vi.fn(),
            };
        });

        renderHook(() => usePoseStampedClient(defaultProps));

        expect(mockViewer.addObject).toHaveBeenCalled();
        expect(Topic).toHaveBeenCalledWith(expect.objectContaining({
            name: '/pose',
        }));
        expect(mockSubscribe).toHaveBeenCalled();
    });

    it('should process message and update visualization (arrow)', () => {
        let messageCallback: any;
        (Topic as any).mockImplementation(function () {
            return {
                subscribe: (cb: any) => { messageCallback = cb; },
                unsubscribe: vi.fn(),
            };
        });

        const { result } = renderHook(() => usePoseStampedClient(defaultProps));

        const msg = {
            header: { frame_id: 'map' },
            pose: {
                position: { x: 1, y: 2, z: 3 },
                orientation: { x: 0, y: 0, z: 0, w: 1 },
            }
        };

        if (messageCallback) {
            messageCallback(msg);
        }

        // Check internal logic via side effects if possible
        // or inspect the returned refs/objects if they are exposed
        // The hook returns visualizationGroup, let's check that
        const group = result.current.visualizationGroup;
        expect(group).toBeDefined();
        if (group) {
            expect(group.add).toHaveBeenCalled(); // Should have added arrow parts
        }
    });

    it('should handle axes visualization type', () => {
        let messageCallback: any;
        (Topic as any).mockImplementation(function () {
            return {
                subscribe: (cb: any) => { messageCallback = cb; },
                unsubscribe: vi.fn(),
            };
        });

        const propsWithAxes = {
            ...defaultProps,
            options: { ...defaultProps.options, visualizationType: 'axes' }
        };

        const { result } = renderHook(() => usePoseStampedClient(propsWithAxes));

        if (messageCallback) {
            messageCallback({
                header: { frame_id: 'map' },
                pose: {
                    position: { x: 1, y: 2, z: 3 },
                    orientation: { x: 0, y: 0, z: 0, w: 1 },
                }
            });
        }

        const group = result.current.visualizationGroup;
        expect(group).toBeDefined();
        if (group) {
            expect(group.add).toHaveBeenCalled(); // Should have added axes
        }
    });

    it('should cleanup on unmount', () => {
        const mockUnsubscribe = vi.fn();
        (Topic as any).mockImplementation(function () {
            return {
                subscribe: vi.fn(),
                unsubscribe: mockUnsubscribe,
            };
        });

        const { unmount } = renderHook(() => usePoseStampedClient(defaultProps));

        unmount();

        expect(mockUnsubscribe).toHaveBeenCalled();
        expect(mockScene.remove).toHaveBeenCalled();
    });
});
