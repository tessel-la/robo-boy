// Point cloud shader material creation utilities
import * as THREE from 'three';
import { isIOS, isMobile } from './platformUtils';

/**
 * Options for creating a point cloud shader material.
 */
export interface PointCloudShaderOptions {
    colorMode: 'x' | 'y' | 'z';
    minColor?: THREE.Color;
    maxColor?: THREE.Color;
    minAxisValue?: number;
    maxAxisValue?: number;
    pointSize?: number;
}

/**
 * Returns the fragment shader code based on the current platform.
 * Mobile devices get optimized shaders, desktop gets higher quality.
 */
export function getFragmentShader(): string {
    const isMobileDevice = isMobile();
    const isIOSDevice = isIOS();

    if (isMobileDevice && !isIOSDevice) {
        // Improved mobile shader that eliminates square artifacts
        return `
      varying vec3 vColor;
      
      void main() {
        // Create a smoother circular point
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        
        // Use a quadratic falloff for smoother edges without square artifacts
        float alpha = 1.0 - smoothstep(0.4, 0.5, dist);
        
        // Hard cutoff without alpha blending
        if(dist > 0.48) discard;
        
        // Full opacity to avoid blending issues
        gl_FragColor = vec4(vColor, 1.0);
      }
    `;
    } else if (isIOSDevice) {
        // iOS-specific shader with improved point rendering
        return `
      varying vec3 vColor;
      
      void main() {
        // Higher precision distance calculation
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        
        // Hard edge with slight smoothing to prevent pixelation
        float alpha = 1.0 - step(0.48, dist);
        if(alpha <= 0.01) discard;
        
        // No transparency
        gl_FragColor = vec4(vColor, 1.0);
      }
    `;
    } else {
        // Standard shader for desktop platforms
        return `
      varying vec3 vColor;
      
      void main() {
        // Higher quality rendering for desktop
        vec2 coord = gl_PointCoord - vec2(0.45, 0.5);
        float dist = length(coord);
        
        // Smoother edge
        float alpha = 1.0 - smoothstep(0.45, 0.5, dist);
        if(alpha < 0.1) discard;
        
        gl_FragColor = vec4(vColor, 1.0);
      }
    `;
    }
}

/**
 * Creates a vertex shader for axis-based point cloud coloring.
 */
export function createVertexShader(
    axisIndex: number,
    pointSize: number,
    minColor: THREE.Color,
    maxColor: THREE.Color
): string {
    const isMobileDevice = isMobile();
    const pointSizeMultiplier = isMobileDevice ? 8.0 : 10.0;

    return `
    // Custom shader for point cloud coloring by axis position
    varying vec3 vColor;
    uniform float minAxisValue;
    uniform float maxAxisValue;
    
    void main() {
      // Position calculation using pre-defined attributes/uniforms
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      
      // Adjust point size based on platform
      gl_PointSize = ${pointSize} * ${pointSizeMultiplier};
      
      // Color calculation based on position
      float value = position[${axisIndex}];
      float normalized = clamp((value - minAxisValue) / (maxAxisValue - minAxisValue), 0.0, 1.0);
      
      // Linear interpolation between min and max colors
      vec3 minCol = vec3(${minColor.r.toFixed(4)}, ${minColor.g.toFixed(4)}, ${minColor.b.toFixed(4)});
      vec3 maxCol = vec3(${maxColor.r.toFixed(4)}, ${maxColor.g.toFixed(4)}, ${maxColor.b.toFixed(4)});
      vColor = mix(minCol, maxCol, normalized);
    }
  `;
}

/**
 * Creates a ShaderMaterial for axis-based point cloud coloring.
 * This is the main entry point for creating point cloud materials.
 */
export function createPointCloudShaderMaterial(options: PointCloudShaderOptions): THREE.ShaderMaterial {
    const axisIndex = options.colorMode === 'x' ? 0 : (options.colorMode === 'y' ? 1 : 2);
    const minColor = options.minColor || new THREE.Color(0x0000ff); // Default blue
    const maxColor = options.maxColor || new THREE.Color(0xff0000); // Default red
    const pointSize = options.pointSize || 0.05;

    // Get safe initial values for the shader uniforms
    const safeInitialMin = options.minAxisValue !== undefined ? options.minAxisValue : -10;
    const safeInitialMax = options.maxAxisValue !== undefined ? options.maxAxisValue : 10;

    // Ensure the range is valid (Chrome is especially sensitive to this)
    const safeMin = Math.min(safeInitialMin, safeInitialMax - 0.001);
    const safeMax = Math.max(safeInitialMax, safeInitialMin + 0.001);

    console.log(`[PointCloudShader] Creating shader for ${options.colorMode} axis with range: [${safeMin}, ${safeMax}]`);

    return new THREE.ShaderMaterial({
        vertexShader: createVertexShader(axisIndex, pointSize, minColor, maxColor),
        fragmentShader: getFragmentShader(),
        transparent: false, // Set to false to prevent transparency issues
        blending: THREE.NoBlending, // Use NoBlending for mobile to avoid white edges
        depthTest: true,
        depthWrite: true, // Enable depth write for proper occlusion
        uniforms: {
            minAxisValue: { value: safeMin },
            maxAxisValue: { value: safeMax }
        }
    });
}

/**
 * Creates an inline shader material for color scheme updates (avoids recreation of full client).
 * This version is used when updating just the color scheme without recreating the client.
 */
export function createInlineShaderMaterial(
    colorMode: 'x' | 'y' | 'z',
    pointSize: number,
    minColor: THREE.Color,
    maxColor: THREE.Color,
    minAxisValue: number,
    maxAxisValue: number
): THREE.ShaderMaterial {
    const axisIndex = colorMode === 'x' ? 0 : (colorMode === 'y' ? 1 : 2);
    const isMobileDevice = isMobile();
    const pointSizeMultiplier = isMobileDevice ? 8.0 : 10.0;

    // Ensure the range is valid
    const safeMin = Math.min(minAxisValue, maxAxisValue - 0.001);
    const safeMax = Math.max(maxAxisValue, minAxisValue + 0.001);

    return new THREE.ShaderMaterial({
        vertexShader: `
      varying vec3 vColor;
      uniform float minAxisValue;
      uniform float maxAxisValue;
      
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = ${pointSize} * ${pointSizeMultiplier};
        
        float value = position[${axisIndex}];
        float normalized = clamp((value - minAxisValue) / (maxAxisValue - minAxisValue), 0.0, 1.0);
        
        vec3 minCol = vec3(${minColor.r.toFixed(4)}, ${minColor.g.toFixed(4)}, ${minColor.b.toFixed(4)});
        vec3 maxCol = vec3(${maxColor.r.toFixed(4)}, ${maxColor.g.toFixed(4)}, ${maxColor.b.toFixed(4)});
        vColor = mix(minCol, maxCol, normalized);
      }
    `,
        fragmentShader: getFragmentShader(),
        transparent: false,
        blending: THREE.NoBlending,
        depthTest: true,
        depthWrite: true,
        uniforms: {
            minAxisValue: { value: safeMin },
            maxAxisValue: { value: safeMax }
        }
    });
}
