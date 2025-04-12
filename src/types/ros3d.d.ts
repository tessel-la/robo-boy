declare module 'ros3d' {
    // Basic THREE types often used
    import { Object3D, Material, Camera } from 'three';

    // Basic roslib types
    import { Ros } from 'roslib';

    // Basic viewer class declaration
    export class Viewer {
        constructor(options: {
            divID: string;
            width: number;
            height: number;
            antialias: boolean;
            background?: number;
            cameraPose?: { x: number, y: number, z: number };
        });
        addObject(object: Object3D): void;
        resize(width: number, height: number): void;
        scene: Object3D; // Typically THREE.Scene
        camera: Camera; // Typically THREE.PerspectiveCamera
    }

    // Basic grid declaration
    export class Grid extends Object3D {
        constructor(options?: any);
    }

    // PointCloud2 declaration
    export class PointCloud2 extends Object3D { // Extends Object3D as it's added to the scene
        constructor(options: {
            ros: Ros;
            topic: string;
            tfClient: TfClient;
            rootObject: Object3D;
            max_pts?: number;     // Correct option name
            size?: number;
            material?: Material | { [key: string]: any }; // Allow custom material or options
            colorsrc?: string;    // Field name for color
            compression?: 'cbor' | 'png' | 'none'; // Specify allowed compression types
            throttle_rate?: number;
        });
        // Add methods if needed, e.g., unsubscribe is likely internal
    }

    // OrbitControls declaration
    export class OrbitControls {
        constructor(options: {
            scene: Object3D;
            camera: Camera;
            userZoomSpeed?: number;
            userPanSpeed?: number;
            element?: HTMLElement;
        });
        // Add methods if needed, e.g., dispose()
    }

    // Add other ros3d classes/types here as needed (e.g., UrdfClient, MarkerClient)

    // You might need to export the THREE namespace if ros3d relies on it implicitly
    // export * as THREE from 'three'; // Example - check if needed

    // Export the ROS3D namespace object
    const ROS3D: {
        Viewer: typeof Viewer;
        Grid: typeof Grid;
        PointCloud2: typeof PointCloud2; // Add PointCloud2
        OrbitControls: typeof OrbitControls; // Add OrbitControls if not present
        // ... other exports
    };

    export default ROS3D;
} 