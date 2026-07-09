// Viewer class implementation - Core 3D scene management
import * as THREE from 'three';

const isDesktopRuntime = (): boolean =>
    typeof document !== 'undefined' && document.documentElement.dataset.runtime === 'tauri';

const getRendererPixelRatio = (): number => {
    if (typeof window === 'undefined') return 1;

    const devicePixelRatio = window.devicePixelRatio || 1;
    return isDesktopRuntime() ? Math.min(devicePixelRatio, 1) : devicePixelRatio;
};

/**
 * Basic viewer class for managing the 3D scene, camera, and renderer.
 */
export class Viewer {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    fixedFrame: string = '';
    private animationId: number | null = null;
    private renderWidth = 0;
    private renderHeight = 0;

    constructor(options: {
        divID: string;
        width: number;
        height: number;
        antialias: boolean;
        background?: number;
        cameraPose?: { x: number, y: number, z: number };
    }) {
        // Get the div element
        const container = document.getElementById(options.divID);
        if (!container) {
            throw new Error(`Element with ID ${options.divID} not found`);
        }

        // Create scene
        this.scene = new THREE.Scene();
        if (options.background !== undefined) {
            this.scene.background = new THREE.Color(options.background);
        } else {
            this.scene.background = new THREE.Color(0x111111);
        }

        // Add lighting for 3D meshes
        // Add ambient light for overall illumination
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6); // soft white light
        this.scene.add(ambientLight);

        // Add directional light for shading
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 5, 5);
        directionalLight.castShadow = false; // Disable shadows for performance
        this.scene.add(directionalLight);

        // Add another directional light from opposite direction for better illumination
        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
        directionalLight2.position.set(-5, -5, 5);
        this.scene.add(directionalLight2);

        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            50,
            options.width / options.height,
            0.1,
            1000
        );

        // Set camera position
        if (options.cameraPose) {
            this.camera.position.set(
                options.cameraPose.x,
                options.cameraPose.y,
                options.cameraPose.z
            );
        } else {
            this.camera.position.set(3, 3, 3);
        }
        this.camera.lookAt(0, 0, 0);

        // Set camera up vector to Z-up
        this.camera.up = new THREE.Vector3(0, 0, 1);

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: isDesktopRuntime() ? false : options.antialias,
            powerPreference: 'high-performance',
            stencil: false,
        });
        this.renderer.setPixelRatio(getRendererPixelRatio());
        this.renderer.setSize(options.width, options.height);
        this.renderWidth = options.width;
        this.renderHeight = options.height;
        // Enable shadows if needed
        this.renderer.shadowMap.enabled = false; // Keep disabled for performance

        // Append renderer to container
        container.appendChild(this.renderer.domElement);

        // Start animation loop
        this.animate();
    }

    // Add objects to the scene
    addObject(object: THREE.Object3D): void {
        this.scene.add(object);
    }

    // Resize viewer
    resize(width: number, height: number): void {
        if (width === this.renderWidth && height === this.renderHeight) return;

        this.renderWidth = width;
        this.renderHeight = height;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    // Animation loop
    private animate = (): void => {
        this.animationId = requestAnimationFrame(this.animate);
        this.renderer.render(this.scene, this.camera);
    };

    // Stop rendering
    stop(): void {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
}
