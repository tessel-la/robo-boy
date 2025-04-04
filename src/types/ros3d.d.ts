declare module 'ros3d' {
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
        addObject(object: any): void;
        resize(width: number, height: number): void;
        scene: any; // Use any for complex THREE.js objects initially
        camera: any;
    }

    // Basic grid declaration
    export class Grid {
        constructor(options?: any);
    }

    // Basic TFClient declaration
    export class TfClient {
        constructor(options: {
            ros: any; // Use any for Ros type from roslib
            fixedFrame: string;
            angularThres?: number;
            transThres?: number;
            rate?: number;
            serverName?: string;
            repubServiceName?: string;
            topicTimeout?: number;
            updateDelay?: number;
            groovyCompat?: boolean;
            tfPrefix?: string;
        });
        unsubscribe(): void;
        processTfArray(tf: any): void;
    }

    // Add other ros3d classes/types here as needed (e.g., UrdfClient, MarkerClient)

    // You might need to export the THREE namespace if ros3d relies on it implicitly
    // export { THREE } from 'three'; // Example - check if needed

    const ROS3D: {
        Viewer: typeof Viewer;
        Grid: typeof Grid;
        TfClient: typeof TfClient;
        // ... other exports
    };

    export default ROS3D;
} 