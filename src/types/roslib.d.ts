// Basic type declaration for roslib to satisfy TypeScript
// We can add more specific types here as needed
declare module 'roslib' {
    export class Ros {
        constructor(options: { url: string });
        options: { url: string }; // Expose options
        on(eventName: string, callback: (event: any) => void): void;
        close(): void;
        isConnected: boolean;
        // Add other methods/properties as needed (e.g., Topic, Service)
        Topic: any; // Placeholder
        Service: any; // Placeholder
        ServiceRequest: any; // Placeholder

        // Add methods for introspection
        getTopics(callback: (response: { topics: string[], types: string[] }) => void, failedCallback?: (error: any) => void): void;
        getTopicType(topic: string, callback: (type: string) => void, failedCallback?: (error: any) => void): void;
    }

    export class Topic {
        constructor(options: { ros: Ros; name: string; messageType: string; [key: string]: any }); // Allow other options
        subscribe(callback: (message: any) => void): void;
        unsubscribe(): void;
        publish(message: any): void;
        advertise(): void;
        unadvertise(): void;
        // Add other properties/methods as needed
        name: string; // Add name property
        [key: string]: any; // Allow other properties like hasLoggedData
    }

    export class Message {
        constructor(values: any);
        // Add specific properties if needed, or leave as any
        [key: string]: any;
    }

    // Add TFClient declaration
    export class TFClient {
        constructor(options: {
            ros: Ros;
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
        subscribe(frameId: string, callback: (tf: any) => void): void;
        unsubscribe(frameId: string, callback?: (tf: any) => void): void;
        processTfArray(tf: any): void;
        // Add other methods as needed
    }

    // Add declarations for Service, Param, etc. as needed

    const ROSLIB: {
        Ros: typeof Ros;
        Topic: typeof Topic;
        Message: typeof Message;
        TFClient: typeof TFClient; // Export TFClient
        // Service: typeof Service;
        // ... other exports
    };

    export default ROSLIB;
}
