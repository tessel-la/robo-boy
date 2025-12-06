// LaserScan visualization class implementation
import * as THREE from 'three';
import { Ros } from 'roslib';
import * as ROSLIB from 'roslib';
import { CustomTFProvider, StoredTransform } from '../../tfUtils';

/**
 * LaserScan visualization class for ROS laser scan data.
 * Subscribes to ROS LaserScan topics and renders them as points in 3D.
 */
export class LaserScan extends THREE.Object3D {
    private ros: Ros;
    private topicName: string;
    private tfClient: CustomTFProvider;
    private rootObject: THREE.Object3D;
    public fixedFrame: string;
    private pointSize: number;
    private pointColor: THREE.Color;
    private maxRange: number;
    private minRange: number;

    private rosTopicInstance: ROSLIB.Topic | null = null;
    private pointsNode: THREE.Points | null = null;
    private messageFrameId: string | null = null;
    private transformUpdateAnimationId: number | null = null;

    // Pre-allocated buffer for performance (avoids GC on each message)
    private maxLaserPoints: number = 2000;
    private positionBuffer: Float32Array;
    private geometry: THREE.BufferGeometry | null = null;
    private material: THREE.PointsMaterial | null = null;

    constructor(options: {
        ros: Ros;
        topic: string;
        tfClient: CustomTFProvider;
        rootObject: THREE.Object3D;
        fixedFrame?: string;
        material?: {
            size?: number;
            color?: THREE.Color | number | string;
        };
        maxRange?: number;
        minRange?: number;
    }) {
        super();

        this.ros = options.ros;
        this.topicName = options.topic;
        this.tfClient = options.tfClient;
        this.rootObject = options.rootObject;
        this.fixedFrame = options.fixedFrame || 'base_link';
        this.pointSize = options.material?.size || 0.05;
        this.pointColor = options.material?.color instanceof THREE.Color
            ? options.material.color
            : new THREE.Color(options.material?.color || 0xff0000); // Default red
        this.maxRange = options.maxRange || Infinity;
        this.minRange = options.minRange || 0;

        // Pre-allocate position buffer
        this.positionBuffer = new Float32Array(this.maxLaserPoints * 3);
        this.initializeGeometry();

        this.rootObject.add(this);
        this.subscribe();
        this.setupTfHandling();
    }

    private initializeGeometry(): void {
        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positionBuffer, 3));
        this.geometry.setDrawRange(0, 0);

        this.material = new THREE.PointsMaterial({
            color: this.pointColor,
            size: this.pointSize,
            sizeAttenuation: false
        });

        this.pointsNode = new THREE.Points(this.geometry, this.material);
        this.add(this.pointsNode);
    }

    private subscribe(): void {
        if (!this.ros) return;

        this.rosTopicInstance = new ROSLIB.Topic({
            ros: this.ros,
            name: this.topicName,
            messageType: 'sensor_msgs/msg/LaserScan',
            throttle_rate: 33, // ~30Hz for smooth updates
            queue_size: 1,
            compression: 'cbor'
        });

        console.log(`[LaserScan] Subscribing to ${this.topicName}`);
        this.rosTopicInstance.subscribe(this.processMessage.bind(this));
    }

    public unsubscribe(): void {
        if (this.rosTopicInstance) {
            console.log(`[LaserScan] Unsubscribing from ${this.topicName}`);
            this.rosTopicInstance.unsubscribe();
            this.rosTopicInstance = null;
        }
        if (this.transformUpdateAnimationId !== null) {
            cancelAnimationFrame(this.transformUpdateAnimationId);
            this.transformUpdateAnimationId = null;
        }
        // Dispose geometry and material
        if (this.geometry) {
            this.geometry.dispose();
            this.geometry = null;
        }
        if (this.material) {
            this.material.dispose();
            this.material = null;
        }
        if (this.pointsNode) {
            this.remove(this.pointsNode);
            this.pointsNode = null;
        }
        // Remove this object from its parent (rootObject)
        if (this.parent) {
            this.parent.remove(this);
        }
    }

    private processMessage(message: any): void {
        this.messageFrameId = (message.header.frame_id || '').startsWith('/')
            ? message.header.frame_id.substring(1)
            : message.header.frame_id;

        if (!this.messageFrameId) {
            console.warn('[LaserScan] Message received with no frame_id');
            return;
        }

        if (!this.geometry) return;

        const numPoints = message.ranges.length;
        const angleMin = message.angle_min;
        const angleIncrement = message.angle_increment;
        const minRange = this.minRange;
        const maxRange = this.maxRange;

        // Ensure buffer is large enough
        if (numPoints > this.maxLaserPoints) {
            this.maxLaserPoints = numPoints;
            this.positionBuffer = new Float32Array(this.maxLaserPoints * 3);
            this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positionBuffer, 3));
        }

        // Fill buffer directly (no object allocations)
        let validPoints = 0;
        for (let i = 0; i < numPoints; i++) {
            const range = message.ranges[i];

            if (range >= minRange && range <= maxRange && Number.isFinite(range)) {
                const angle = angleMin + i * angleIncrement;
                const idx = validPoints * 3;
                this.positionBuffer[idx] = range * Math.cos(angle);
                this.positionBuffer[idx + 1] = range * Math.sin(angle);
                this.positionBuffer[idx + 2] = 0;
                validPoints++;
            }
        }

        // Update geometry
        const positionAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
        positionAttr.needsUpdate = true;
        this.geometry.setDrawRange(0, validPoints);
    }

    private setupTfHandling(): void {
        let currentFixedFrame = this.fixedFrame;
        let lastTransformTime = 0;
        let retryCount = 0;
        let lastVisibleState = this.visible;

        const updateTransform = () => {
            this.transformUpdateAnimationId = requestAnimationFrame(updateTransform);

            const now = performance.now();
            // Run at 15fps for TF updates (66ms) - transforms don't need 30fps
            if (now - lastTransformTime < 66 && retryCount === 0) {
                return;
            }
            lastTransformTime = now;

            if (this.messageFrameId) {
                const targetFixedFrame = this.getFixedFrame(); // Use getter for dynamic updates

                if (currentFixedFrame !== targetFixedFrame) {
                    currentFixedFrame = targetFixedFrame;
                    // console.log(`[LaserScan] Fixed frame changed to: ${targetFixedFrame}`);
                    retryCount = 0; // Reset retry on frame change
                }

                try {
                    const tf = this.tfClient.lookupTransform(targetFixedFrame, this.messageFrameId);

                    if (tf && tf.translation && tf.rotation) {
                        // Log successful transform
                        // console.log(`[LaserScan] TF Success: ${this.messageFrameId} to ${targetFixedFrame}`, JSON.parse(JSON.stringify(tf)));
                        this.position.set(tf.translation.x, tf.translation.y, tf.translation.z);
                        this.quaternion.set(tf.rotation.x, tf.rotation.y, tf.rotation.z, tf.rotation.w);

                        if (!lastVisibleState) {
                            //   console.log(`[LaserScan] Transform found for ${this.messageFrameId} in ${targetFixedFrame}, showing scan.`);
                        }
                        this.visible = true;
                        lastVisibleState = true;
                        retryCount = 0;

                        this.updateMatrix();
                        this.matrixWorldNeedsUpdate = true;
                    } else {
                        retryCount++;
                        if (retryCount > 30) { // Hide after ~1s of failing to get transform
                            if (lastVisibleState) {
                                console.warn(`[LaserScan] Transform not available from ${this.messageFrameId} to ${targetFixedFrame} after ${retryCount} retries. Hiding scan.`);
                            }
                            this.visible = false;
                            lastVisibleState = false;
                            // Limit further retries to avoid console spam, but still check occasionally
                            if (retryCount > 300) retryCount = 300;
                        }
                    }
                } catch (e) {
                    retryCount++;
                    if (retryCount % 30 === 0 || retryCount === 1) { // Log first error and then periodically
                        console.warn(`[LaserScan] TF error transforming ${this.messageFrameId} to ${targetFixedFrame}: ${e instanceof Error ? e.message : String(e)}`);
                    }
                    if (retryCount > 30) {
                        this.visible = false;
                        lastVisibleState = false;
                    }
                }
            } else {
                // No messageFrameId yet, or no messages received, keep hidden or current state
                // this.visible = false; 
            }
        };
        this.transformUpdateAnimationId = requestAnimationFrame(updateTransform);
    }

    public updateSettings(options: {
        pointSize?: number;
        pointColor?: THREE.Color | number | string;
        maxRange?: number;
        minRange?: number;
    }): void {
        if (options.pointSize !== undefined) {
            this.pointSize = options.pointSize;
            if (this.material) {
                this.material.size = this.pointSize;
            }
        }
        if (options.pointColor !== undefined) {
            this.pointColor = options.pointColor instanceof THREE.Color
                ? options.pointColor
                : new THREE.Color(options.pointColor);
            if (this.material) {
                this.material.color = this.pointColor;
            }
        }
        if (options.maxRange !== undefined) {
            this.maxRange = options.maxRange;
        }
        if (options.minRange !== undefined) {
            this.minRange = options.minRange;
        }
    }

    public setFixedFrame(fixedFrame: string): void {
        // console.log(`[LaserScan] setFixedFrame called: ${fixedFrame}`);
        this.fixedFrame = fixedFrame;
        // TF handling loop will pick this up.
    }

    public forceTransformUpdate(): void {
        // console.log("[LaserScan] forceTransformUpdate called");
        // This method is a bit of a no-op here as the animation loop handles updates.
        // If immediate update was critical, one could call parts of updateTransform() directly,
        // but that might conflict with the animation loop.
    }

    // Getter for fixedFrame, primarily for consistency with TF handling
    private getFixedFrame(): string {
        return this.fixedFrame;
    }
}
