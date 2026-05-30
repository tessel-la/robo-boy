import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTfVisualizer } from './useTfVisualizer';
import * as THREE from 'three';
import { TransformStore } from '../utils/tfUtils';

const {
    groupInstances,
    spriteInstances,
    canvasTextureInstances,
    lineInstances,
    bufferGeometryInstances,
} = vi.hoisted(() => ({
    groupInstances: [] as any[],
    spriteInstances: [] as any[],
    canvasTextureInstances: [] as any[],
    lineInstances: [] as any[],
    bufferGeometryInstances: [] as any[],
}));

// Mock dependencies
vi.mock('three', async () => {
    const actual = await vi.importActual<typeof import('three')>('three');

    class MockGroup {
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

        constructor() {
            groupInstances.push(this);
        }
    }

    class MockVector3 {
        x: number; y: number; z: number;
        constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
        set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
        copy(vector: { x: number; y: number; z: number }) {
            this.x = vector.x;
            this.y = vector.y;
            this.z = vector.z;
            return this;
        }
        equals() { return false; }
        distanceToSquared() { return 1; }
    }

    class MockQuaternion {
        x: number; y: number; z: number; w: number;
        constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
        set(x: number, y: number, z: number, w: number) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
        copy(quaternion: { x: number; y: number; z: number; w: number }) {
            this.x = quaternion.x;
            this.y = quaternion.y;
            this.z = quaternion.z;
            this.w = quaternion.w;
            return this;
        }
        equals() { return false; }
        dot() { return 0.5; }
    }

    class MockCanvasTexture {
        needsUpdate = false;
        dispose = vi.fn();
        constructor(public canvas: HTMLCanvasElement) {
            canvasTextureInstances.push(this);
        }
    }

    class MockSpriteMaterial {
        dispose = vi.fn();
        constructor(public options: any) { }
    }

    class MockSprite {
        scale = { set: vi.fn() };
        position = { set: vi.fn() };
        renderOrder = 0;
        constructor(public material: any) {
            spriteInstances.push(this);
        }
    }

    class MockBufferAttribute {
        needsUpdate = false;
        constructor(public array: Float32Array, public itemSize: number) { }
    }

    class MockBufferGeometry {
        attributes: Record<string, any> = {};
        dispose = vi.fn();
        computeBoundingSphere = vi.fn();
        setAttribute = vi.fn((name: string, attribute: any) => {
            this.attributes[name] = attribute;
            return this;
        });
        getAttribute = vi.fn((name: string) => this.attributes[name]);

        constructor() {
            bufferGeometryInstances.push(this);
        }
    }

    class MockLineBasicMaterial {
        dispose = vi.fn();
        constructor(public options: any) { }
    }

    class MockLine {
        frustumCulled = true;
        renderOrder = 0;
        visible = true;
        constructor(public geometry: any, public material: any) {
            lineInstances.push(this);
        }
    }

    return {
        ...actual,
        Group: MockGroup,
        Vector3: MockVector3,
        Quaternion: MockQuaternion,
        CanvasTexture: MockCanvasTexture,
        SpriteMaterial: MockSpriteMaterial,
        Sprite: MockSprite,
        BufferAttribute: MockBufferAttribute,
        BufferGeometry: MockBufferGeometry,
        LineBasicMaterial: MockLineBasicMaterial,
        Line: MockLine,
    };
});

vi.mock('../utils/ros3d', () => ({
    Axes: class {
        lineSegments = {
            geometry: { dispose: vi.fn() },
            material: { dispose: vi.fn() }
        }
        constructor(_options: any) { }
    }
}));

describe('useTfVisualizer', () => {
    let mockViewer: any;
    let mockTFProvider: any;
    let mockScene: any;
    let createElementSpy: ReturnType<typeof vi.spyOn>;

    const transforms: TransformStore = {
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
    };

    const defaultProps = () => ({
        isRosConnected: true,
        ros3dViewer: { current: mockViewer },
        customTFProvider: { current: mockTFProvider },
        displayedTfFrames: [] as string[],
        transforms: {} as TransformStore,
        showFrameLabels: true,
    });

    beforeEach(() => {
        vi.clearAllMocks();
        groupInstances.length = 0;
        spriteInstances.length = 0;
        canvasTextureInstances.length = 0;
        lineInstances.length = 0;
        bufferGeometryInstances.length = 0;

        const originalCreateElement = document.createElement.bind(document);
        createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
            if (tagName === 'canvas') {
                return {
                    width: 0,
                    height: 0,
                    style: {},
                    getContext: () => ({
                        font: '',
                        fillStyle: '',
                        strokeStyle: '',
                        lineWidth: 1,
                        textBaseline: '',
                        measureText: (text: string) => ({ width: text.length * 12 }),
                        scale: vi.fn(),
                        beginPath: vi.fn(),
                        moveTo: vi.fn(),
                        lineTo: vi.fn(),
                        quadraticCurveTo: vi.fn(),
                        closePath: vi.fn(),
                        fill: vi.fn(),
                        stroke: vi.fn(),
                        fillText: vi.fn(),
                    }),
                } as unknown as HTMLCanvasElement;
            }

            return originalCreateElement(tagName);
        });

        mockScene = {
            add: vi.fn(),
            remove: vi.fn(),
        };
        mockViewer = {
            scene: mockScene,
            fixedFrame: 'map'
        };
        mockTFProvider = {
            lookupTransform: vi.fn((_: string, frameName: string) => ({
                translation: frameName === 'map'
                    ? { x: 0, y: 0, z: 0 }
                    : { x: 1, y: 2, z: 3 },
                rotation: { x: 0, y: 0, z: 0, w: 1 }
            }))
        };
    });

    afterEach(() => {
        createElementSpy.mockRestore();
        vi.useRealTimers();
    });

    it('should create and add container when connected', () => {
        renderHook(() => useTfVisualizer(defaultProps()));

        expect(mockScene.add).toHaveBeenCalled();
    });

    it('should not create container if not connected', () => {
        renderHook(() => useTfVisualizer({
            ...defaultProps(),
            isRosConnected: false,
        }));

        expect(mockScene.add).not.toHaveBeenCalled();
    });

    it('should add axes and labels for displayed frames when labels are enabled', () => {
        renderHook(() => useTfVisualizer({
            ...defaultProps(),
            displayedTfFrames: ['base_link'],
        }));

        expect(mockScene.add).toHaveBeenCalled();
        expect(spriteInstances).toHaveLength(1);
        expect(canvasTextureInstances).toHaveLength(1);
    });

    it('should skip labels when labels are disabled', () => {
        renderHook(() => useTfVisualizer({
            ...defaultProps(),
            displayedTfFrames: ['base_link'],
            showFrameLabels: false,
        }));

        expect(spriteInstances).toHaveLength(0);
        expect(canvasTextureInstances).toHaveLength(0);
    });

    it('should create connection lines only for selected parent-child pairs', () => {
        renderHook(() => useTfVisualizer({
            ...defaultProps(),
            displayedTfFrames: ['map', 'odom', 'camera'],
            transforms,
        }));

        expect(lineInstances).toHaveLength(1);
    });

    it('should update connection line geometry in the animation loop', () => {
        vi.useFakeTimers();

        renderHook(() => useTfVisualizer({
            ...defaultProps(),
            displayedTfFrames: ['map', 'odom'],
            transforms,
        }));

        act(() => {
            vi.advanceTimersByTime(100);
        });

        const positionAttribute = lineInstances[0].geometry.getAttribute('position');
        expect(Array.from(positionAttribute.array)).toEqual([0, 0, 0, 1, 2, 3]);
        expect(positionAttribute.needsUpdate).toBe(true);
        expect(lineInstances[0].visible).toBe(true);
    });

    it('should update poses in animation loop', () => {
        vi.useFakeTimers();

        renderHook(() => useTfVisualizer({
            ...defaultProps(),
            displayedTfFrames: ['base_link']
        }));

        act(() => {
            vi.advanceTimersByTime(100);
        });

        expect(mockTFProvider.lookupTransform).toHaveBeenCalled();
    });

    it('should dispose labels and connection lines on cleanup', () => {
        const { unmount } = renderHook(() => useTfVisualizer({
            ...defaultProps(),
            displayedTfFrames: ['map', 'odom'],
            transforms,
        }));

        unmount();

        expect(mockScene.remove).toHaveBeenCalled();
        expect(canvasTextureInstances[0].dispose).toHaveBeenCalled();
        expect(lineInstances[0].geometry.dispose).toHaveBeenCalled();
        expect(lineInstances[0].material.dispose).toHaveBeenCalled();
    });
});
