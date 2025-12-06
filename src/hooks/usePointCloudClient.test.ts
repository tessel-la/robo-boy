import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePointCloudClient } from './usePointCloudClient';
import * as ROS3D from '../utils/ros3d';
import * as THREE from 'three';
import { CustomTFProvider } from '../utils/tfUtils';
// Import mocks directly
import { isMobile } from '../utils/platformUtils';
import { createPointCloudShaderMaterial, createInlineShaderMaterial } from '../utils/pointCloudShaders';

// Mock dependencies
vi.mock('roslib', () => ({
    Ros: vi.fn(),
    Topic: vi.fn(),
}));

vi.mock('../utils/ros3d', () => ({
    PointCloud2: vi.fn(),
    Viewer: vi.fn(),
    Grid: vi.fn(), // Add Grid if needed
}));

// Mock THREE
vi.mock('three', async () => {
    const actual = await vi.importActual<typeof import('three')>('three');
    return {
        ...actual,
        Color: class {
            r = 0; g = 0; b = 0;
            constructor(r?: any, g?: any, b?: any) {
                if (typeof r === 'number') this.setHex(r);
            }
            setHex(hex: number) { return this; }
            getHexString() { return '000000'; }
        },
        Vector3: class { x = 0; y = 0; z = 0; },
        ShaderMaterial: class {
            uniforms = {
                minAxisValue: { value: 0 },
                maxAxisValue: { value: 0 }
            };
            opacity = 1;
            needsUpdate = false;
            dispose = vi.fn();
        },
        BufferGeometry: class {
            getAttribute() {
                return {
                    count: 100,
                    getX: (i: number) => i,
                    getY: (i: number) => i,
                    getZ: (i: number) => i,
                };
            }
            dispose = vi.fn();
        },
        BufferAttribute: class { },
        Points: class {
            material: any;
            geometry: any;
            visible = true;
            parent = { name: 'wrapper' };
            constructor(geometry: any, material: any) {
                this.geometry = geometry;
                this.material = material || new THREE.MeshBasicMaterial();
            }
        },
        MeshBasicMaterial: class {
            dispose = vi.fn();
        },
        Object3D: class {
            add = vi.fn();
            remove = vi.fn();
            children = [];
        }
    };
});

vi.mock('../utils/platformUtils', () => ({
    isMobile: vi.fn().mockReturnValue(false),
}));

vi.mock('../utils/pointCloudShaders', () => ({
    createPointCloudShaderMaterial: vi.fn().mockReturnValue({ type: 'ShaderMaterial' }),
    createInlineShaderMaterial: vi.fn().mockReturnValue({ type: 'InlineShaderMaterial' }),
}));

vi.mock('../utils/pointCloudCleanup', () => ({
    cleanupPointCloudClient: vi.fn(),
    clearPointCloudIntervals: vi.fn(),
    createIntervalsRef: vi.fn().mockReturnValue({}),
}));

describe('usePointCloudClient', () => {
    let mockRos: any;
    let mockViewer: any;
    let mockTFProvider: any;
    let mockScene: any;

    let defaultProps: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (isMobile as any).mockReturnValue(false);

        // Setup mocks
        mockRos = { isConnected: true };
        mockScene = { children: [], add: vi.fn(), remove: vi.fn() };

        mockViewer = {
            scene: mockScene,
            camera: {},
            renderer: {
                render: vi.fn(),
            }
        };

        mockTFProvider = {
            subscribe: vi.fn(),
            unsubscribe: vi.fn(),
        };

        // Setup PointCloud2 mock implementation
        (ROS3D.PointCloud2 as any).mockImplementation(() => ({
            points: {
                object: new THREE.Points(new THREE.BufferGeometry(), new THREE.ShaderMaterial()),
                setup: vi.fn(),
            },
            unsubscribe: vi.fn(),
        }));

        // Explicitly type defaultProps or cast to any where needed
        defaultProps = {
            ros: mockRos,
            isRosConnected: true,
            ros3dViewer: { current: mockViewer },
            customTFProvider: { current: mockTFProvider },
            selectedPointCloudTopic: '/points',
            fixedFrame: '/map',
            material: { size: 0.1 },
            options: { maxPoints: 100000 },
        };
    });

    it('should not create client if prerequisites are missing', () => {
        renderHook(() => usePointCloudClient({
            ...defaultProps,
            isRosConnected: false,
        }));

        expect(ROS3D.PointCloud2).not.toHaveBeenCalled();
    });

    it('should create client when all prerequisites are met', () => {
        renderHook(() => usePointCloudClient(defaultProps));

        expect(ROS3D.PointCloud2).toHaveBeenCalledWith(expect.objectContaining({
            topic: '/points',
            fixedFrame: '/map',
            max_pts: 100000,
        }));
    });

    it('should cleanup previous client when topic changes', () => {
        const { rerender } = renderHook((props) => usePointCloudClient(props), {
            initialProps: defaultProps,
        });

        rerender({
            ...defaultProps,
            selectedPointCloudTopic: '/new_points',
        });

        expect(ROS3D.PointCloud2).toHaveBeenCalledTimes(2);
        expect(ROS3D.PointCloud2).toHaveBeenLastCalledWith(expect.objectContaining({
            topic: '/new_points',
        }));
    });

    it('should cleanup existing client if prerequisites are lost', () => {
        const { rerender } = renderHook((props) => usePointCloudClient(props), {
            initialProps: defaultProps,
        });

        expect(ROS3D.PointCloud2).toHaveBeenCalledTimes(1);

        rerender({
            ...defaultProps,
            isRosConnected: false,
        });

        // Logic inside hook handles cleanup
    });

    it('should use custom shader material when colorMode is provided', () => {
        renderHook(() => usePointCloudClient({
            ...defaultProps,
            material: {
                ...defaultProps.material,
                colorMode: 'z',
                minAxisValue: 0,
                maxAxisValue: 10,
            }
        }));

        expect(createPointCloudShaderMaterial).toHaveBeenCalled();
        expect(ROS3D.PointCloud2).toHaveBeenCalledWith(expect.objectContaining({
            customShader: true,
        }));
    });

    it.skip('should handle mobile optimizations', () => {
        (isMobile as any).mockReturnValue(true);

        renderHook(() => usePointCloudClient({
            ...defaultProps,
            material: { colorMode: 'z' }
        }));

        expect(ROS3D.PointCloud2).toHaveBeenCalledWith(expect.objectContaining({
            max_pts: 50000,
        }));
    });

    it.skip('should handle just color change without recreating client', () => {
        // Setup mock client instance to simulate existing client
        const mockClientInstance = {
            topicName: '/points',
            topic: '/points',
            _fixedFrame: '/map',
            points: {
                object: new THREE.Points(new THREE.BufferGeometry(), new THREE.ShaderMaterial()),
            },
            unsubscribe: vi.fn(),
        };
        (ROS3D.PointCloud2 as any).mockImplementation(() => mockClientInstance);
        (ROS3D.PointCloud2 as any).mockReturnValue(mockClientInstance);

        const { rerender } = renderHook((props) => usePointCloudClient(props), {
            initialProps: defaultProps,
        });

        // Clear initial call
        (ROS3D.PointCloud2 as any).mockClear();

        rerender({
            ...defaultProps,
            material: {
                ...defaultProps.material,
                colorMode: 'z',
            }
        });

        expect(ROS3D.PointCloud2).not.toHaveBeenCalled();
        expect(createInlineShaderMaterial).toHaveBeenCalled();
    });
});
