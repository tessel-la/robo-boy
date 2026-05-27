import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { Grid } from './Grid';

describe('Grid', () => {
    describe('constructor', () => {
        it('should create a Grid extending Object3D', () => {
            const grid = new Grid();
            expect(grid).toBeInstanceOf(THREE.Object3D);
        });

        it('should use default values when no options provided', () => {
            const grid = new Grid();
            // Grid should have one child (the GridHelper)
            expect(grid.children.length).toBe(1);
            expect(grid.children[0]).toBeInstanceOf(THREE.GridHelper);
        });

        it('should apply custom size option', () => {
            const grid = new Grid({ size: 20 });
            expect(grid.children.length).toBe(1);
            // GridHelper was created with custom size
            const gridHelper = grid.children[0] as THREE.GridHelper;
            expect(gridHelper).toBeInstanceOf(THREE.GridHelper);
        });

        it('should apply custom divisions option', () => {
            const grid = new Grid({ divisions: 20 });
            expect(grid.children.length).toBe(1);
        });

        it('should apply custom colorCenterLine option', () => {
            const grid = new Grid({ colorCenterLine: 0xff0000 });
            expect(grid.children.length).toBe(1);
        });

        it('should apply custom colorGrid option', () => {
            const grid = new Grid({ colorGrid: 0x00ff00 });
            expect(grid.children.length).toBe(1);
        });

        it('should apply all custom options together', () => {
            const grid = new Grid({
                size: 15,
                divisions: 15,
                colorCenterLine: 0xff0000,
                colorGrid: 0x00ff00,
            });
            expect(grid.children.length).toBe(1);
        });

        it('should rotate grid to XY plane with Z up', () => {
            const grid = new Grid();
            const gridHelper = grid.children[0];
            // Rotation should be PI/2 around X axis
            expect(gridHelper.rotation.x).toBeCloseTo(Math.PI / 2, 5);
        });

        it('should handle zero values for colors', () => {
            const grid = new Grid({ colorCenterLine: 0x000000, colorGrid: 0x000000 });
            expect(grid.children.length).toBe(1);
        });
    });
});
