import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PointCloud2 } from './PointCloud2';
import * as THREE from 'three';
import * as ROSLIB from 'roslib';

// Mock dependencies
vi.mock('three', async () => {
    const actual = await vi.importActual<typeof import('three')>('three');
    return {
        ...actual,
        Object3D: class {
            visible = true;
            add = vi.fn();
            remove = vi.fn();
            children = [];
            position = { set: vi.fn() };
            quaternion = { set: vi.fn() };
            updateMatrix = vi.fn();
            parent = { remove: vi.fn() };
        },
        BufferGeometry: class {
            setAttribute = vi.fn();
            setDrawRange = vi.fn();
            getAttribute = vi.fn(() => ({
                needsUpdate: false,
                array: new Float32Array(300) // Small mock buffer
            }));
            dispose = vi.fn();
        },
        PointsMaterial: class {
            dispose = vi.fn();
            color = { r: 0, g: 1, b: 0 };
        },
        Points: class {
            geometry = {
                getAttribute: vi.fn(() => ({
                    needsUpdate: false,
                    array: new Float32Array(300)
                })),
                setDrawRange: vi.fn()
            };
            material = new THREE.PointsMaterial();
        },
        Color: class { constructor(c: any) { } },
        Float32BufferAttribute: class { }
    };
});

vi.mock('roslib', () => {
    return {
        Ros: vi.fn(),
        Topic: vi.fn(function () {
            return {
                subscribe: vi.fn(),
                unsubscribe: vi.fn()
            }
        })
    };
});

describe('PointCloud2', () => {
    let mockRos: any;
    let mockTFProvider: any;
    let mockRoot: any;
    let pointCloud2: PointCloud2;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRos = {};
        mockTFProvider = {
            lookupTransform: vi.fn()
        };
        mockRoot = {
            add: vi.fn(),
            remove: vi.fn()
        };
    });

    it('should subscribe and initialize geometry', () => {
        pointCloud2 = new PointCloud2({
            ros: mockRos,
            topic: '/points',
            tfClient: mockTFProvider,
            rootObject: mockRoot
        });

        expect(ROSLIB.Topic).toHaveBeenCalledWith(expect.objectContaining({
            name: '/points',
            messageType: 'sensor_msgs/PointCloud2'
        }));

        // Check root add indirectly
        expect(mockRoot.add).toHaveBeenCalled();
    });

    it('should process PointCloud2 message with ArrayBuffer', () => {
        const subscribeMock = vi.fn();
        (ROSLIB.Topic as any).mockImplementation(function () {
            return {
                subscribe: subscribeMock,
                unsubscribe: vi.fn()
            }
        });

        pointCloud2 = new PointCloud2({
            ros: mockRos,
            topic: '/points',
            tfClient: mockTFProvider,
            rootObject: mockRoot
        });

        const callback = subscribeMock.mock.calls[0][0];

        // Create a simple binary payload: 1 point, x=1, y=2, z=3
        // fields: x (offset 0), y (offset 4), z (offset 8)
        const buffer = new ArrayBuffer(16); // 16 bytes for padding/safety
        const view = new DataView(buffer);
        view.setFloat32(0, 1.0, true);
        view.setFloat32(4, 2.0, true);
        view.setFloat32(8, 3.0, true);

        const message = {
            header: { frame_id: 'camera_link' },
            width: 1,
            height: 1,
            point_step: 16,
            fields: [
                { name: 'x', offset: 0 },
                { name: 'y', offset: 4 },
                { name: 'z', offset: 8 }
            ],
            data: buffer
        };

        callback(message);

        // No crash means parsing logic ran
        // Verification of internal buffer is tricky with mocks, but this exercises processMessage
    });

    it('should update settings', () => {
        pointCloud2 = new PointCloud2({
            ros: mockRos,
            topic: '/points',
            tfClient: mockTFProvider,
            rootObject: mockRoot
        });

        pointCloud2.updateSettings({
            pointSize: 0.2,
            scaleX: 2.0
        });

        expect((pointCloud2 as any).pointSize).toBe(0.2);
        expect((pointCloud2 as any).scaleX).toBe(2.0);
    });

    it('should update transform via animation loop', () => {
        vi.useFakeTimers();
        const subscribeMock = vi.fn();
        (ROSLIB.Topic as any).mockImplementation(function () {
            return {
                subscribe: subscribeMock,
                unsubscribe: vi.fn()
            }
        });

        pointCloud2 = new PointCloud2({
            ros: mockRos,
            topic: '/points',
            tfClient: mockTFProvider,
            rootObject: mockRoot
        });

        // Trigger message to set frame id
        const callback = subscribeMock.mock.calls[0][0];

        // Use valid data to bypass early returns in processMessage
        const buffer = new ArrayBuffer(16); // 1 point
        const view = new DataView(buffer);
        view.setFloat32(0, 1.0, true);

        callback({
            header: { frame_id: 'camera_link' },
            width: 1,
            height: 1,
            point_step: 16,
            fields: [{ name: 'x', offset: 0 }, { name: 'y', offset: 4 }, { name: 'z', offset: 8 }],
            data: buffer
        });

        mockTFProvider.lookupTransform.mockReturnValue({
            translation: { x: 1, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 }
        });

        // Run loop
        vi.advanceTimersByTime(100);

        expect(mockTFProvider.lookupTransform).toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('should cleanup unsubscribe', () => {
        const unsubscribeMock = vi.fn();
        (ROSLIB.Topic as any).mockImplementation(function () {
            return {
                subscribe: vi.fn(),
                unsubscribe: unsubscribeMock
            }
        });

        pointCloud2 = new PointCloud2({
            ros: mockRos,
            topic: '/points',
            tfClient: mockTFProvider,
            rootObject: mockRoot
        });

        pointCloud2.unsubscribe();
        expect(unsubscribeMock).toHaveBeenCalled();
    });
});
