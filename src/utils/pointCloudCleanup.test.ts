import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
    cleanupPointCloudClient,
    disposeMaterial,
    clearPointCloudIntervals,
    createIntervalsRef,
    PointCloudIntervals
} from './pointCloudCleanup';

describe('pointCloudCleanup', () => {
    describe('disposeMaterial', () => {
        it('should dispose a single material', () => {
            const material = new THREE.MeshBasicMaterial();
            const disposeSpy = vi.spyOn(material, 'dispose');

            disposeMaterial(material);

            expect(disposeSpy).toHaveBeenCalled();
        });

        it('should dispose an array of materials', () => {
            const materials = [
                new THREE.MeshBasicMaterial(),
                new THREE.MeshBasicMaterial(),
                new THREE.MeshBasicMaterial()
            ];

            const disposeSpies = materials.map(mat => vi.spyOn(mat, 'dispose'));

            disposeMaterial(materials);

            disposeSpies.forEach(spy => {
                expect(spy).toHaveBeenCalled();
            });
        });

        it('should handle materials without dispose method gracefully', () => {
            const material = { color: 'red' } as unknown as THREE.Material;

            // Should not throw
            expect(() => disposeMaterial(material)).not.toThrow();
        });
    });

    describe('createIntervalsRef', () => {
        it('should create an intervals object with null values', () => {
            const intervals = createIntervalsRef();

            expect(intervals.checkSceneInterval).toBeNull();
            expect(intervals.checkPointsObjectInterval).toBeNull();
            expect(intervals.updateRangesInterval).toBeNull();
        });
    });

    describe('clearPointCloudIntervals', () => {
        it('should clear all intervals', () => {
            const intervals: PointCloudIntervals = {
                checkSceneInterval: setInterval(() => { }, 1000),
                checkPointsObjectInterval: setInterval(() => { }, 1000),
                updateRangesInterval: setInterval(() => { }, 1000)
            };

            clearPointCloudIntervals(intervals);

            expect(intervals.checkSceneInterval).toBeNull();
            expect(intervals.checkPointsObjectInterval).toBeNull();
            expect(intervals.updateRangesInterval).toBeNull();
        });

        it('should handle already null intervals', () => {
            const intervals: PointCloudIntervals = {
                checkSceneInterval: null,
                checkPointsObjectInterval: null,
                updateRangesInterval: null
            };

            // Should not throw
            expect(() => clearPointCloudIntervals(intervals)).not.toThrow();
        });

        it('should handle partial null intervals', () => {
            const intervals: PointCloudIntervals = {
                checkSceneInterval: setInterval(() => { }, 1000),
                checkPointsObjectInterval: null,
                updateRangesInterval: setInterval(() => { }, 1000)
            };

            clearPointCloudIntervals(intervals);

            expect(intervals.checkSceneInterval).toBeNull();
            expect(intervals.checkPointsObjectInterval).toBeNull();
            expect(intervals.updateRangesInterval).toBeNull();
        });
    });

    describe('cleanupPointCloudClient', () => {
        it('should handle null client gracefully', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            cleanupPointCloudClient(null);

            expect(consoleSpy).toHaveBeenCalledWith('[PC Cleanup] No client to clean');
            consoleSpy.mockRestore();
        });

        it('should unsubscribe from client if method exists', () => {
            const mockClient = {
                unsubscribe: vi.fn(),
                points: null
            };

            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            cleanupPointCloudClient(mockClient as any);

            expect(mockClient.unsubscribe).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('should handle client without unsubscribe method', () => {
            const mockClient = {
                points: null
            };

            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            // Should not throw
            expect(() => cleanupPointCloudClient(mockClient as any)).not.toThrow();
            consoleSpy.mockRestore();
        });

        it('should dispose materials and geometry from points object', () => {
            const mockGeometry = { dispose: vi.fn() };
            const mockMaterial = { dispose: vi.fn() };

            const mockClient = {
                points: {
                    object: {
                        visible: true,
                        material: mockMaterial,
                        geometry: mockGeometry
                    }
                }
            };

            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            cleanupPointCloudClient(mockClient as any);

            // Verify dispose methods were called (points is nulled after cleanup)
            expect(mockMaterial.dispose).toHaveBeenCalled();
            expect(mockGeometry.dispose).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('should remove object from scene if provided', () => {
            const mockScene = new THREE.Scene();
            const mockParent = new THREE.Object3D();
            mockScene.add(mockParent);

            const mockClient = {
                points: {
                    object: {
                        parent: mockParent,
                        visible: true,
                        material: null,
                        geometry: null
                    }
                }
            };

            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

            cleanupPointCloudClient(mockClient as any, mockScene);

            expect(mockScene.children).not.toContain(mockParent);
            consoleSpy.mockRestore();
        });

        it('should handle errors gracefully', () => {
            const mockClient = {
                unsubscribe: () => { throw new Error('Test error'); },
                points: {
                    object: {
                        visible: true,
                        material: { dispose: () => { throw new Error('Dispose error'); } },
                        geometry: null
                    }
                }
            };

            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            // Should not throw
            expect(() => cleanupPointCloudClient(mockClient as any)).not.toThrow();

            consoleSpy.mockRestore();
            warnSpy.mockRestore();
        });
    });
});
