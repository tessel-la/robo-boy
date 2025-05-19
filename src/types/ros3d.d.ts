declare module 'ros3d' {
    // Basic THREE types often used
    import { Object3D, Material, Camera, PerspectiveCamera, WebGLRenderer, Scene, Vector3, Quaternion, BufferGeometry } from 'three';

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
        scene: Scene;
        camera: PerspectiveCamera;
        renderer: WebGLRenderer;
        stop(): void;
        fixedFrame: string;
    }

    // Basic grid declaration
    export class Grid extends Object3D {
        constructor(options?: any);
    }

    // Axes declaration
    export class Axes extends Object3D {
        constructor(options?: {
            lineType?: string;
            lineSize?: number;
            shaftRadius?: number;
            headRadius?: number;
            headLength?: number;
        });
        // Expose lineSegments if needed for disposal
        lineSegments?: { geometry: BufferGeometry | null; material: Material | Material[] | null; };
    }

    // TfClient declaration (basic stub)
    export class TfClient {
        constructor(options: {
            ros: Ros;
            fixedFrame: string;
            angularThres?: number;
            transThres?: number;
            rate?: number;
            topicTimeout?: number;
            serverName?: string;
            repubServiceName?: string;
        });
        subscribe(frameId: string, callback: (transform: any | null) => void): void;
        unsubscribe(frameId: string, callback?: (transform: any | null) => void): void;
        getFixedFrame(): string;
    }

    // PointCloud2 declaration
    export class PointCloud2 extends Object3D { 
        constructor(options: {
            ros: Ros;
            topic: string;
            tfClient: TfClient;
            rootObject: Object3D;
            max_pts?: number;
            size?: number;
            material?: Material | { [key: string]: any };
            colorsrc?: string;
            compression?: 'cbor' | 'png' | 'none';
            throttle_rate?: number;
            scaleX?: number;
            scaleY?: number;
            scaleZ?: number;
            originX?: number;
            originY?: number;
            originZ?: number;
            fixedFrame?: string;
        });
        subscribe(): void;
        unsubscribe(): void;
        safeResetPoints(material?: Material | { [key: string]: any }): boolean;
        processMessage(message: any): void;
        updateSettings(options: {
            scaleX?: number;
            scaleY?: number;
            scaleZ?: number;
            originX?: number;
            originY?: number;
            originZ?: number;
            pointSize?: number;
        }): void;
        points: {
            object: THREE.Points | null;
            material: Material | null;
            geometry: BufferGeometry | null;
            setup: boolean;
        };
    }

    // OrbitControls declaration
    export class OrbitControls {
        constructor(options: {
            scene: Object3D;
            camera: PerspectiveCamera;
            userZoomSpeed?: number;
            userPanSpeed?: number;
            userRotateSpeed?: number;
            element?: HTMLElement;
        });
        update(): void;
        dispose(): void;
    }

    // Add other ros3d classes/types here as needed (e.g., UrdfClient, MarkerClient)

    // You might need to export the THREE namespace if ros3d relies on it implicitly
    // export * as THREE from 'three'; // Example - check if needed

    // Export the ROS3D namespace object
    const ROS3D: {
        Viewer: typeof Viewer;
        Grid: typeof Grid;
        Axes: typeof Axes;
        TfClient: typeof TfClient;
        PointCloud2: typeof PointCloud2;
        OrbitControls: typeof OrbitControls;
        // ... other exports
    };

    export default ROS3D;
} 