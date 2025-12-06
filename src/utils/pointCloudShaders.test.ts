import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
    createPointCloudShaderMaterial,
    createInlineShaderMaterial,
    getFragmentShader,
    createVertexShader
} from './pointCloudShaders';

// Mock platformUtils
vi.mock('./platformUtils', () => ({
    isIOS: vi.fn(() => false),
    isMobile: vi.fn(() => false)
}));

import { isIOS, isMobile } from './platformUtils';

describe('pointCloudShaders', () => {
    beforeEach(() => {
        vi.mocked(isIOS).mockReturnValue(false);
        vi.mocked(isMobile).mockReturnValue(false);
    });

    describe('getFragmentShader', () => {
        it('should return desktop shader by default', () => {
            const shader = getFragmentShader();
            expect(shader).toContain('varying vec3 vColor');
            expect(shader).toContain('gl_FragColor');
            expect(shader).toContain('smoothstep(0.45, 0.5, dist)');
        });

        it('should return mobile shader when isMobile is true', () => {
            vi.mocked(isMobile).mockReturnValue(true);
            const shader = getFragmentShader();
            expect(shader).toContain('smoothstep(0.4, 0.5, dist)');
            expect(shader).toContain('if(dist > 0.48) discard');
        });

        it('should return iOS shader when isIOS is true', () => {
            vi.mocked(isMobile).mockReturnValue(true);
            vi.mocked(isIOS).mockReturnValue(true);
            const shader = getFragmentShader();
            expect(shader).toContain('step(0.48, dist)');
        });
    });

    describe('createVertexShader', () => {
        it('should create vertex shader for x-axis coloring', () => {
            const minColor = new THREE.Color(0x0000ff);
            const maxColor = new THREE.Color(0xff0000);
            const shader = createVertexShader(0, 0.05, minColor, maxColor);

            expect(shader).toContain('varying vec3 vColor');
            expect(shader).toContain('uniform float minAxisValue');
            expect(shader).toContain('uniform float maxAxisValue');
            expect(shader).toContain('position[0]');
        });

        it('should create vertex shader for y-axis coloring', () => {
            const minColor = new THREE.Color(0x0000ff);
            const maxColor = new THREE.Color(0xff0000);
            const shader = createVertexShader(1, 0.05, minColor, maxColor);

            expect(shader).toContain('position[1]');
        });

        it('should create vertex shader for z-axis coloring', () => {
            const minColor = new THREE.Color(0x0000ff);
            const maxColor = new THREE.Color(0xff0000);
            const shader = createVertexShader(2, 0.05, minColor, maxColor);

            expect(shader).toContain('position[2]');
        });

        it('should use larger point size multiplier on mobile', () => {
            vi.mocked(isMobile).mockReturnValue(true);
            const minColor = new THREE.Color(0x0000ff);
            const maxColor = new THREE.Color(0xff0000);
            const shader = createVertexShader(0, 0.05, minColor, maxColor);

            // Mobile uses 8.0 multiplier, desktop uses 10.0
            expect(shader).toContain('8');
        });
    });

    describe('createPointCloudShaderMaterial', () => {
        it('should create a ShaderMaterial', () => {
            const material = createPointCloudShaderMaterial({
                colorMode: 'z',
                minColor: new THREE.Color(0x0000ff),
                maxColor: new THREE.Color(0xff0000)
            });

            expect(material).toBeInstanceOf(THREE.ShaderMaterial);
        });

        it('should set correct uniforms', () => {
            const material = createPointCloudShaderMaterial({
                colorMode: 'x',
                minAxisValue: -5,
                maxAxisValue: 5
            });

            expect(material.uniforms.minAxisValue.value).toBe(-5);
            expect(material.uniforms.maxAxisValue.value).toBe(5);
        });

        it('should use default values when not provided', () => {
            const material = createPointCloudShaderMaterial({
                colorMode: 'z'
            });

            // Default range should be -10 to 10
            expect(material.uniforms.minAxisValue.value).toBe(-10);
            expect(material.uniforms.maxAxisValue.value).toBe(10);
        });

        it('should handle inverted axis values by swapping them', () => {
            const material = createPointCloudShaderMaterial({
                colorMode: 'y',
                minAxisValue: 10,
                maxAxisValue: 5
            });

            // Should swap to ensure min < max
            expect(material.uniforms.minAxisValue.value).toBeLessThan(material.uniforms.maxAxisValue.value);
        });

        it('should disable transparency and blending', () => {
            const material = createPointCloudShaderMaterial({
                colorMode: 'z'
            });

            expect(material.transparent).toBe(false);
            expect(material.blending).toBe(THREE.NoBlending);
        });
    });

    describe('createInlineShaderMaterial', () => {
        it('should create a ShaderMaterial for inline updates', () => {
            const material = createInlineShaderMaterial(
                'z',
                0.05,
                new THREE.Color(0x0000ff),
                new THREE.Color(0xff0000),
                -10,
                10
            );

            expect(material).toBeInstanceOf(THREE.ShaderMaterial);
        });

        it('should handle all color modes', () => {
            const modes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];

            modes.forEach(mode => {
                const material = createInlineShaderMaterial(
                    mode,
                    0.05,
                    new THREE.Color(0x0000ff),
                    new THREE.Color(0xff0000),
                    -5,
                    5
                );

                expect(material).toBeInstanceOf(THREE.ShaderMaterial);
            });
        });
    });
});
