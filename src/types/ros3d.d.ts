declare module 'ros3d' {
    // Basic THREE types often used
    import { Object3D, Material, Camera, PerspectiveCamera, WebGLRenderer, Scene, Vector3, Quaternion, BufferGeometry } from 'three';

    // Basic roslib types
    import { Ros } from 'roslib';

    // Import CustomTFProvider type from its definition. 
    // This path might need adjustment based on your project structure and how tfUtils is exported/imported.
    // Assuming tfUtils.ts exports CustomTFProvider and is in the same directory level as ros3d.ts for simplicity here.
    // In a real project, you'd use the correct module path.
    import { CustomTFProvider } from '../utils/tfUtils'; // Adjusted path

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
            tfClient: CustomTFProvider;
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
        // Add private methods to the type definition
        private onMouseDown(event: MouseEvent): void;
        private onMouseMove(event: MouseEvent): void;
        private onMouseUp(event: MouseEvent): void;
        private onMouseWheel(event: WheelEvent): void;
        private onTouchStart(event: TouchEvent): void;
        private onTouchMove(event: TouchEvent): void;
        private onTouchEnd(event: TouchEvent): void;
    }

    // UrdfClient declaration
    export class UrdfClient extends Object3D {
        constructor(options: {
            ros: Ros;
            tfClient: CustomTFProvider;
            rootObject: Object3D; // The THREE.Object3D to attach the URDF model to
            robotDescriptionParam?: string; // ROS parameter name for the URDF (e.g., '/robot_description')
            robotDescriptionTopic?: string; // ROS topic name for the URDF (e.g., '/robot_description')
            loader?: any; // Specify loader type, e.g., COLLADA_LOADER, STLLoader. Define more strictly if possible.
            onComplete?: (model: Object3D) => void; // Callback when URDF is loaded
            // Consider adding options for loading specific meshes like DAE, STL, OBJ, etc.
            // Example: colladaLoaderOptions?: any, stlLoaderOptions?: any
        });
        dispose(): void; // Method to clean up the URDF model and subscriptions
        // Add any other public methods or properties that UrdfClient will have
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
        UrdfClient: typeof UrdfClient;
        // ... other exports
    };

    export default ROS3D;
} 