import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { Axes } from './Axes';

describe('Axes', () => {
    describe('constructor', () => {
        it('should create an Axes extending Object3D', () => {
            const axes = new Axes();
            expect(axes).toBeInstanceOf(THREE.Object3D);
        });

        it('should use default lineSize when no options provided', () => {
            const axes = new Axes();
            // Axes should have one child (the AxesHelper)
            expect(axes.children.length).toBe(1);
            expect(axes.children[0]).toBeInstanceOf(THREE.AxesHelper);
        });

        it('should apply custom lineSize option', () => {
            const axes = new Axes({ lineSize: 5 });
            expect(axes.children.length).toBe(1);
            expect(axes.children[0]).toBeInstanceOf(THREE.AxesHelper);
        });

        it('should store lineSegments for disposal', () => {
            const axes = new Axes();
            expect(axes.lineSegments).toBeDefined();
            expect(axes.lineSegments?.geometry).toBeDefined();
            expect(axes.lineSegments?.material).toBeDefined();
        });

        it('should accept empty options object', () => {
            const axes = new Axes({});
            expect(axes.children.length).toBe(1);
        });

        it('should handle all option properties', () => {
            const axes = new Axes({
                lineType: 'full',
                lineSize: 2,
                shaftRadius: 0.1,
                headRadius: 0.2,
                headLength: 0.3,
            });
            // These options may not all be used, but should not cause errors
            expect(axes.children.length).toBe(1);
        });
    });

    describe('geometry and material', () => {
        it('should have valid geometry in lineSegments', () => {
            const axes = new Axes();
            expect(axes.lineSegments?.geometry).toBeInstanceOf(THREE.BufferGeometry);
        });

        it('should have valid material in lineSegments', () => {
            const axes = new Axes();
            // AxesHelper material can be Material or Material[]
            const material = axes.lineSegments?.material;
            expect(material).toBeDefined();
        });
    });
});
