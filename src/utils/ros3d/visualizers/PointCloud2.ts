// PointCloud2 visualization class implementation
import * as THREE from 'three';
import { Ros } from 'roslib';
import * as ROSLIB from 'roslib';
import { CustomTFProvider, StoredTransform } from '../../tfUtils';

/**
 * PointCloud2 visualization class for ROS point cloud data.
 * Subscribes to ROS PointCloud2 topics and renders them in 3D.
 */
export class PointCloud2 extends THREE.Object3D {
    private ros: Ros;
    private topic: string;
    private tfClient: CustomTFProvider;
    private _rootObject: THREE.Object3D;
    private maxPoints: number;
    private pointSize: number;
    private _compression: string;
    private throttleRate: number;
    public points: any;  // Made public for external access from hooks
    private messageFrameId: string | null = null;
    private fixedFrame: string;
    private rosTopicInstance: ROSLIB.Topic | null = null; // Added for managing subscription

    // Scaling factors for points
    private scaleX: number = 1.0;
    private scaleY: number = 1.0;
    private scaleZ: number = 1.0;

    // Origin offset
    private originX: number = 0.0;
    private originY: number = 0.0;
    private originZ: number = 0.0;

    // For animation loop tracking
    private transformUpdateAnimationId: number | null = null;

    // Cached field offsets for performance
    private cachedFieldOffsets: { x: number; y: number; z: number } | null = null;
    private cachedPointStep: number = 0;

    constructor(options: {
        ros: Ros;
        topic: string;
        tfClient: CustomTFProvider;
        rootObject: THREE.Object3D;
        max_pts?: number;
        size?: number;
        material?: THREE.Material | { [key: string]: any };
        colorsrc?: string;
        compression?: 'cbor' | 'png' | 'none';
        throttle_rate?: number;
        scaleX?: number;
        scaleY?: number;
        scaleZ?: number;
        originX?: number;
        originY?: number;
        originZ?: number;
        fixedFrame?: string; // Add option to pass fixed frame
    }) {
        super();

        this.ros = options.ros;
        this.topic = options.topic;
        this.tfClient = options.tfClient;
        this._rootObject = options.rootObject;
        this.maxPoints = options.max_pts || 100000;
        this.pointSize = options.size || 0.05;
        this._compression = options.compression || 'none';
        this.throttleRate = options.throttle_rate || 33; // ~30Hz default for smoother updates
        this.fixedFrame = options.fixedFrame || 'odom'; // Store the fixed frame

        // Set scaling factors if provided
        if (options.scaleX !== undefined) this.scaleX = options.scaleX;
        if (options.scaleY !== undefined) this.scaleY = options.scaleY;
        if (options.scaleZ !== undefined) this.scaleZ = options.scaleZ;

        // Set origin offset if provided
        if (options.originX !== undefined) this.originX = options.originX;
        if (options.originY !== undefined) this.originY = options.originY;
        if (options.originZ !== undefined) this.originZ = options.originZ;

        // Initialize the points object
        this.initializePoints(options.material);

        // Add to the root object
        options.rootObject.add(this);

        // Setup subscription
        this.subscribe();

        // Setup TF frame handling - subscribe to transformation updates
        this.setupTfHandling();
    }

    // Set up TF frame handling
    private setupTfHandling(): void {
        // Track the current fixed frame to detect changes
        let currentFixedFrame = this.fixedFrame;
        let lastTransformTime = 0;
        let retryCount = 0;
        let lastVisibleState = false;

        // Use requestAnimationFrame to update the transform periodically
        const updateTransform = (_timestamp: number) => {
            // Run at 30fps for TF updates (33ms) - match 3D panel refresh rate
            const now = performance.now();
            if (now - lastTransformTime < 33 && retryCount === 0) {
                this.transformUpdateAnimationId = requestAnimationFrame(updateTransform);
                return;
            }
            lastTransformTime = now;

            if (this.messageFrameId) {
                const fixedFrame = this.getFixedFrame();

                // Check if fixed frame has changed
                const frameChanged = currentFixedFrame !== fixedFrame;
                if (frameChanged) {
                    currentFixedFrame = fixedFrame;
                    this.fixedFrame = fixedFrame; // Update our stored value
                    // Log the change for debugging
                    console.log(`[PointCloud2] Fixed frame changed to: ${fixedFrame}`);
                    // Reset retry counter when frame changes
                    retryCount = 0;
                    // Don't immediately hide - try to get the transform first
                }

                try {
                    let tf: StoredTransform | null = null;
                    if (this.messageFrameId) {
                        tf = this.tfClient.lookupTransform(fixedFrame, this.messageFrameId);
                    }

                    if (tf && tf.translation && tf.rotation) {
                        // Apply transformation to the whole point cloud object
                        this.position.set(
                            tf.translation.x,
                            tf.translation.y,
                            tf.translation.z
                        );
                        this.quaternion.set(
                            tf.rotation.x,
                            tf.rotation.y,
                            tf.rotation.z,
                            tf.rotation.w
                        );

                        if (!lastVisibleState) {
                            console.log(`[PointCloud2] Transform found for ${this.messageFrameId} in ${fixedFrame}, showing point cloud`);
                        }

                        (this as any).visible = true;
                        lastVisibleState = true;

                        // Reset retry counter since we succeeded
                        retryCount = 0;

                        // Force position and quaternion update
                        this.updateMatrix();
                        this.matrixWorldNeedsUpdate = true;

                        // Also update children (the points object)
                        if (this.points.object) {
                            this.points.object.matrixWorldNeedsUpdate = true;
                        }
                    } else {
                        // If transformation not immediately available, increment retry count
                        retryCount++;

                        // Only hide after a few retries to avoid flickering
                        if (retryCount > 30) { // About 1 second of retries
                            if (lastVisibleState) {
                                console.warn(`[PointCloud2] Transform not available from ${this.messageFrameId} to ${fixedFrame} after ${retryCount} retries`);
                            }
                            (this as any).visible = false;
                            lastVisibleState = false;

                            // Limit retry count to avoid overflow
                            if (retryCount > 300) { // About 10 seconds
                                retryCount = 300;
                            }
                        }
                    }
                } catch (e) {
                    retryCount++;

                    // Only log errors after several retries to reduce spam
                    if (retryCount % 30 === 0) {
                        console.warn(`[PointCloud2] Could not transform from ${this.messageFrameId} to ${fixedFrame}: ${e instanceof Error ? e.message : e}`);

                        // Log more detailed info for troubleshooting
                        if (retryCount === 30) {
                            console.debug(`[PointCloud2] Error details:`, e);

                            // Log available methods on tfClient for debugging
                            if (this.tfClient) {
                                console.debug(`[PointCloud2] TF client methods:`,
                                    Object.getOwnPropertyNames(Object.getPrototypeOf(this.tfClient))
                                        .filter(prop => typeof (this.tfClient as any)[prop] === 'function')
                                );
                            }
                        }
                    }

                    // Only hide after a few retries
                    if (retryCount > 30) {
                        (this as any).visible = false;
                        lastVisibleState = false;
                    }
                }
            }

            // Continue the update loop
            this.transformUpdateAnimationId = requestAnimationFrame(updateTransform);
        };

        // Start the update loop
        this.transformUpdateAnimationId = requestAnimationFrame(updateTransform);
    }

    // Initialize point cloud geometry and material
    private initializePoints(material?: THREE.Material | { [key: string]: any }): void {
        try {
            const geometry = new THREE.BufferGeometry(); // Use a local variable for geometry

            // Add attributes: position and color
            geometry.setAttribute(
                'position',
                new THREE.Float32BufferAttribute(new Float32Array(this.maxPoints * 3), 3)
            );
            geometry.setAttribute(
                'color',
                new THREE.Float32BufferAttribute(new Float32Array(this.maxPoints * 3), 3)
            );

            // Create material - either use provided one or default
            let pointMaterial: THREE.Material;

            if (material instanceof THREE.Material) {
                pointMaterial = material;
            } else {
                // Default point material
                pointMaterial = new THREE.PointsMaterial({
                    size: this.pointSize,
                    color: 0x00ff00, // Default green color
                    sizeAttenuation: true
                });
            }

            // Create the points object
            const pointsObject = new THREE.Points(geometry, pointMaterial);
            pointsObject.frustumCulled = false; // Disable frustum culling

            // Store in the points object
            this.points = {
                object: pointsObject,
                material: pointMaterial,
                geometry: geometry, // Assign the local geometry
                setup: true
            };

            // Add points to this object
            super.add(pointsObject);
        } catch (error) {
            console.error('Error initializing points:', error);
        }
    }

    // Subscribe to the point cloud topic
    private subscribe(): void {
        try {
            // Ensure topicSubscription is initialized as a ROSLIB.Topic instance
            this.rosTopicInstance = new ROSLIB.Topic({
                ros: this.ros,
                name: this.topic,
                messageType: 'sensor_msgs/PointCloud2',
                compression: 'cbor', // Use compression for faster transfer
                throttle_rate: this.throttleRate,
                queue_size: 1 // Keep only the latest message
            });

            this.rosTopicInstance.subscribe(this.processMessage.bind(this));
            console.log(`[PointCloud2] Subscribed to ${this.topic}`);
        } catch (error) {
            console.error(`[PointCloud2] Error subscribing to topic ${this.topic}:`, error);
        }
    }

    // Unsubscribe from the topic
    public unsubscribe(): void {
        try {
            if (this.rosTopicInstance) {
                this.rosTopicInstance.unsubscribe();
                this.rosTopicInstance = null; // Clear the instance after unsubscribing
                console.log(`[PointCloud2] Unsubscribed from ${this.topic}`);
            } else {
                console.warn(`[PointCloud2] Attempted to unsubscribe, but no active subscription found for ${this.topic}`);
            }
        } catch (error) {
            console.error(`[PointCloud2] Error unsubscribing from topic ${this.topic}:`, error);
        }

        // Stop transform update loop if it's running
        if (this.transformUpdateAnimationId !== null) {
            cancelAnimationFrame(this.transformUpdateAnimationId);
            this.transformUpdateAnimationId = null;
        }

        // Clear the message frame ID
        this.messageFrameId = null;

        // Optionally, hide the points
        // (this as any).visible = false; // Uncomment if desired behavior
    }

    // Safe method to reset/reinitialize points 
    public safeResetPoints(material?: THREE.Material | { [key: string]: any }): boolean {
        try {
            // Unsubscribe from the current topic before re-initializing
            if (this.rosTopicInstance) {
                this.rosTopicInstance.unsubscribe();
                this.rosTopicInstance = null;
                console.log(`[PointCloud2] Unsubscribed from ${this.topic} before resetting points.`);
            }

            // Re-initialize points
            this.initializePoints(material);

            // Re-subscribe to the topic
            // This ensures that if the topic name or other parameters changed, they are reapplied
            this.subscribe();

            console.log('[PointCloud2] Points reset and re-subscribed successfully.');
            return true;
        } catch (e) {
            console.error('[PointCloud2] Error safely resetting points:', e);
            return false;
        }
    }

    // Process incoming point cloud message - OPTIMIZED for performance
    private processMessage(message: any): void {
        // Fast path checks
        if (!this.points?.setup || !this.points?.object) return;

        const positions = this.points.geometry?.getAttribute('position') as THREE.BufferAttribute;
        if (!positions) return;

        // Quick validation
        const data = message.data;
        if (!data || !message.width || !message.height) return;

        // Store frame_id for TF (TF lookup handled by separate 30Hz loop, not here)
        if (message.header?.frame_id) {
            const frameId = message.header.frame_id.startsWith('/')
                ? message.header.frame_id.substring(1)
                : message.header.frame_id;

            if (this.messageFrameId !== frameId) {
                this.messageFrameId = frameId;
                // Reset cached offsets when frame changes (message format might differ)
                this.cachedFieldOffsets = null;
            }
        }

        const pointStep = message.point_step || 32;
        const pointCount = Math.min(message.width * message.height, this.maxPoints);

        // Cache field offsets on first message (or when point_step changes)
        if (!this.cachedFieldOffsets || this.cachedPointStep !== pointStep) {
            this.cachedPointStep = pointStep;

            if (message.fields && Array.isArray(message.fields)) {
                const offsets: { [key: string]: number } = {};
                for (let i = 0; i < message.fields.length; i++) {
                    const field = message.fields[i];
                    if (field.name && field.offset !== undefined) {
                        offsets[field.name] = field.offset;
                    }
                }

                this.cachedFieldOffsets = {
                    x: offsets.x ?? 0,
                    y: offsets.y ?? 4,
                    z: offsets.z ?? 8
                };
            } else {
                this.cachedFieldOffsets = { x: 0, y: 4, z: 8 };
            }
        }

        // Create DataView - fast path for common types
        let dataView: DataView;
        if (data instanceof Uint8Array) {
            dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
        } else if (data instanceof ArrayBuffer) {
            dataView = new DataView(data);
        } else if (typeof data === 'string') {
            // Base64 decode (rare path)
            try {
                const binaryData = atob(data);
                const bytes = new Uint8Array(binaryData.length);
                for (let i = 0; i < binaryData.length; i++) {
                    bytes[i] = binaryData.charCodeAt(i);
                }
                dataView = new DataView(bytes.buffer);
            } catch (e) {
                return;
            }
        } else {
            return;
        }

        // Cache all values for tight loop
        const xOff = this.cachedFieldOffsets.x;
        const yOff = this.cachedFieldOffsets.y;
        const zOff = this.cachedFieldOffsets.z;
        const sx = this.scaleX, sy = this.scaleY, sz = this.scaleZ;
        const ox = this.originX, oy = this.originY, oz = this.originZ;
        const posArray = positions.array as Float32Array;

        // Tight loop - direct array access is faster than setXYZ
        for (let i = 0, idx = 0; i < pointCount; i++, idx += 3) {
            const off = i * pointStep;
            posArray[idx] = dataView.getFloat32(off + xOff, true) * sx + ox;
            posArray[idx + 1] = dataView.getFloat32(off + yOff, true) * sy + oy;
            posArray[idx + 2] = dataView.getFloat32(off + zOff, true) * sz + oz;
        }

        // Update geometry
        positions.needsUpdate = true;
        this.points.geometry?.setDrawRange(0, pointCount);
    }

    // Method to update visualization settings
    public updateSettings(options: {
        scaleX?: number;
        scaleY?: number;
        scaleZ?: number;
        originX?: number;
        originY?: number;
        originZ?: number;
        pointSize?: number;
        color?: THREE.Color | number | string;
        minColor?: THREE.Color;
        maxColor?: THREE.Color;
        colorMode?: string;
        minAxisValue?: number;
        maxAxisValue?: number;
    }): void {
        // Update scale factors if provided
        if (options.scaleX !== undefined) this.scaleX = options.scaleX;
        if (options.scaleY !== undefined) this.scaleY = options.scaleY;
        if (options.scaleZ !== undefined) this.scaleZ = options.scaleZ;

        // Update origin offset if provided
        if (options.originX !== undefined) this.originX = options.originX;
        if (options.originY !== undefined) this.originY = options.originY;
        if (options.originZ !== undefined) this.originZ = options.originZ;

        // Update material properties if points object exists
        if (this.points?.material) {
            const material = this.points.material;

            // Update point size if provided
            if (options.pointSize !== undefined) {
                this.pointSize = options.pointSize;

                // Update point size in material if it's a PointsMaterial
                if (material instanceof THREE.PointsMaterial) {
                    material.size = this.pointSize;
                }
            }

            // Update color if provided
            if (options.color !== undefined && material instanceof THREE.PointsMaterial) {
                if (options.color instanceof THREE.Color) {
                    material.color = options.color;
                } else {
                    material.color = new THREE.Color(options.color);
                }
            }

            // Force material update
            if (material) {
                material.needsUpdate = true;
            }

            // If we need to rebuild the point cloud with new settings (for complex changes)
            if (options.colorMode !== undefined ||
                options.minColor !== undefined ||
                options.maxColor !== undefined ||
                options.minAxisValue !== undefined ||
                options.maxAxisValue !== undefined) {

                // Create a new material with updated settings
                const newMaterial = new THREE.PointsMaterial({
                    size: this.pointSize,
                    sizeAttenuation: true,
                    color: material instanceof THREE.PointsMaterial ? material.color : new THREE.Color(0x00ff00)
                });

                // Apply color mode settings if needed
                // This would be expanded based on how you want to handle color gradients

                // Recreate points with new material
                this.safeResetPoints(newMaterial);
            }
        }

        // Log updated settings
        console.log('[PointCloud2] Updated visualization settings:', {
            scaleX: this.scaleX,
            scaleY: this.scaleY,
            scaleZ: this.scaleZ,
            originX: this.originX,
            originY: this.originY,
            originZ: this.originZ,
            pointSize: this.pointSize,
            color: options.color ? 'color updated' : undefined
        });
    }

    // Add a method to force a transform update immediately
    public forceTransformUpdate(): void {
        if (!this.messageFrameId) {
            console.warn('[PointCloud2] Cannot force transform update - no message frame ID set yet');
            return;
        }

        const fixedFrame = this.getFixedFrame();
        console.log(`[PointCloud2] Forcing transform update from ${this.messageFrameId} to ${fixedFrame}`);

        try {
            let tf: StoredTransform | null = null;
            if (this.messageFrameId) {
                tf = this.tfClient.lookupTransform(fixedFrame, this.messageFrameId);
            }

            if (tf && tf.translation && tf.rotation) {
                // Apply transformation to the whole point cloud object
                this.position.set(
                    tf.translation.x,
                    tf.translation.y,
                    tf.translation.z
                );
                this.quaternion.set(
                    tf.rotation.x,
                    tf.rotation.y,
                    tf.rotation.z,
                    tf.rotation.w
                );
                (this as any).visible = true;

                // Force position and quaternion update
                this.updateMatrix();
                this.matrixWorldNeedsUpdate = true;

                // Also update children (the points object)
                if (this.points.object) {
                    this.points.object.matrixWorldNeedsUpdate = true;
                }

                console.log(`[PointCloud2] Transform update successful`);
            } else {
                console.warn(`[PointCloud2] No transform available for force update`);
            }
        } catch (e) {
            console.error(`[PointCloud2] Error during forced transform update: ${e instanceof Error ? e.message : e}`);
            console.debug(`[PointCloud2] Error details:`, e);
        }
    }

    // Helper method to get the fixed frame
    private getFixedFrame(): string {
        // CustomTFProvider does not have getFixedFrame(), so PointCloud2 uses its own this.fixedFrame.
        return this.fixedFrame;
    }
}
