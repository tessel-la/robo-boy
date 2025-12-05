// Internal implementation of ros3d functionality
import * as THREE from 'three';
import { Ros } from 'roslib';
import * as ROSLIB from 'roslib';
import { CustomTFProvider, StoredTransform } from './tfUtils';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

// Basic viewer class implementation
class Viewer {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  fixedFrame: string = '';
  private animationId: number | null = null;

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
      antialias: options.antialias,
    });
    this.renderer.setSize(options.width, options.height);
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

// Grid implementation - Now properly extends Object3D
class Grid extends THREE.Object3D {
  constructor(options: any = {}) {
    super();
    
    const size = options.size || 10;
    const divisions = options.divisions || 10;
    const colorCenterLine = options.colorCenterLine !== undefined ? 
      options.colorCenterLine : 0x444444;
    const colorGrid = options.colorGrid !== undefined ? 
      options.colorGrid : 0x888888;
    
    const gridHelper = new THREE.GridHelper(size, divisions, colorCenterLine, colorGrid);
    
    // Rotate grid to be flat on XY plane with Z up
    gridHelper.rotation.x = Math.PI / 2;
    
    this.add(gridHelper);
  }
}

// Axes implementation - Now properly extends Object3D
class Axes extends THREE.Object3D {
  lineSegments?: { geometry: THREE.BufferGeometry | null; material: THREE.Material | THREE.Material[] | null; };

  constructor(options: {
    lineType?: string;
    lineSize?: number;
    shaftRadius?: number;
    headRadius?: number;
    headLength?: number;
  } = {}) {
    super();
    
    const size = options.lineSize || 1;
    const axesHelper = new THREE.AxesHelper(size);
    this.add(axesHelper);
    
    // Store for disposal if needed
    this.lineSegments = {
      geometry: axesHelper.geometry,
      material: axesHelper.material
    };
  }
}

// PointCloud2 implementation (enhanced)
class PointCloud2 extends THREE.Object3D {
  private ros: Ros;
  private topic: string;
  private tfClient: CustomTFProvider;
  private rootObject: THREE.Object3D;
  private maxPoints: number;
  private pointSize: number;
  private compression: string;
  private throttleRate: number;
  private points: any;
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
    this.rootObject = options.rootObject;
    this.maxPoints = options.max_pts || 100000;
    this.pointSize = options.size || 0.05;
    this.compression = options.compression || 'none';
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
    const updateTransform = (timestamp: number) => {
      // Run at 15fps for TF updates (66ms) - transforms don't need 30fps
      const now = performance.now();
      if (now - lastTransformTime < 66 && retryCount === 0) {
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
  
  // Process incoming point cloud message
  private processMessage(message: any): void {
    // Skip if points not set up
    if (!this.points || !this.points.setup || !this.points.object) {
      console.warn('[PointCloud2] Points not set up, skipping message processing');
      return;
    }
    
    try {
      // Store the message frame_id for TF transformation
      if (message.header && message.header.frame_id) {
        // Remove any leading '/' from the frame_id to be consistent with TF
        const frameId = message.header.frame_id.startsWith('/') ? 
          message.header.frame_id.substring(1) : message.header.frame_id;
        
        // Check if frame changed
        const frameChanged = this.messageFrameId !== frameId;
        if (frameChanged) {
          console.log(`[PointCloud2] Message frame_id changed from ${this.messageFrameId} to ${frameId}`);
          // Hide until we get a transform for the new frame
          (this as any).visible = false;
        }
        
        this.messageFrameId = frameId;
        
        // Immediately trigger a transform lookup to update position
        // Use stored fixedFrame instead of trying to call getFixedFrame
        if (this.messageFrameId) {
          try {
            const tf = this.tfClient.lookupTransform(this.fixedFrame, this.messageFrameId);
            if (tf && tf.translation && tf.rotation) {
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
              this.updateMatrix();
              this.matrixWorldNeedsUpdate = true;
            }
          } catch (e) {
            console.warn(`[PointCloud2] Initial transform lookup failed: ${e}`);
          }
        }
      } else {
        console.warn('[PointCloud2] Message has no frame_id in header');
      }
      
      // Get the position attribute
      const positions = this.points.geometry?.getAttribute('position') as THREE.BufferAttribute;
      if (!positions) {
        console.warn('[PointCloud2] No position attribute found');
        return;
      }
      
      // If we have decoded data, process it
      if (!message.data || !message.width || !message.height) {
        console.warn('[PointCloud2] Message data missing width, height, or data');
        return;
      }
      
      const width = message.width;
      const height = message.height;
      const pointCount = Math.min(width * height, this.maxPoints);
      
      // Parse the binary data from the point cloud message
      // PointCloud2 data is typically stored as an ArrayBuffer
      let data = message.data;
      let pointStep = message.point_step || 32; // Default step size if not provided
      let fieldOffsets: { [key: string]: number } = {};
      
      // Get field offsets to locate x, y, z in each point
      if (message.fields && Array.isArray(message.fields)) {
        message.fields.forEach((field: any) => {
          if (field.name && field.offset !== undefined) {
            fieldOffsets[field.name] = field.offset;
          }
        });
      }
      
      // Check if we have x, y, z offsets
      if (!fieldOffsets.x || !fieldOffsets.y || !fieldOffsets.z) {
        console.warn('[PointCloud2] Cannot find x, y, z field offsets in message');
        // Use default offsets if not found
        fieldOffsets = { x: 0, y: 4, z: 8 };
      }
      
      // Create a DataView for accessing binary data
      let dataView;
      
      // Handle different data types
      if (data instanceof Uint8Array) {
        dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
      } else if (data instanceof ArrayBuffer) {
        dataView = new DataView(data);
      } else if (typeof data === 'string') {
        // If data is base64 or other string format, convert to array buffer
        console.warn('[PointCloud2] String data format detected, attempting to parse');
        try {
          // Convert to binary array first
          const binaryData = atob(data);
          const bytes = new Uint8Array(binaryData.length);
          for (let i = 0; i < binaryData.length; i++) {
            bytes[i] = binaryData.charCodeAt(i);
          }
          dataView = new DataView(bytes.buffer);
        } catch (e) {
          console.error('[PointCloud2] Failed to parse string data:', e);
          return;
        }
      } else {
        console.warn('[PointCloud2] Unsupported data type, cannot visualize');
        return;
      }
      
      // Cache field offsets for performance
      const xOffset = fieldOffsets.x;
      const yOffset = fieldOffsets.y;
      const zOffset = fieldOffsets.z;
      const scaleX = this.scaleX;
      const scaleY = this.scaleY;
      const scaleZ = this.scaleZ;
      const originX = this.originX;
      const originY = this.originY;
      const originZ = this.originZ;
      
      // Extract point cloud data (optimized loop - no try-catch per point)
      for (let i = 0; i < pointCount; i++) {
        const offset = i * pointStep;
        
        // Extract x, y, z as 32-bit floats (standard for ROS point clouds)
        const x = dataView.getFloat32(offset + xOffset, true) * scaleX + originX;
        const y = dataView.getFloat32(offset + yOffset, true) * scaleY + originY;
        const z = dataView.getFloat32(offset + zOffset, true) * scaleZ + originZ;
        
        positions.setXYZ(i, x, y, z);
      }
      
      // Update the geometry
      positions.needsUpdate = true;
      
      // Set the draw range to only render valid points
      this.points.geometry?.setDrawRange(0, pointCount);
    } catch (e) {
      console.error('[PointCloud2] Error processing point cloud message:', e);
    }
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

// LaserScan visualization class
class LaserScan extends THREE.Object3D {
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

// OrbitControls implementation
class OrbitControls {
  private camera: THREE.PerspectiveCamera;
  private element: HTMLElement;
  private target = new THREE.Vector3(0, 0, 0);
  private enabled = true;
  public zoomSpeed = 0.1;
  public panSpeed = 0.1;
  public rotateSpeed = 1.0;
  
  private mouseButtons = { LEFT: 0, MIDDLE: 1, RIGHT: 2 };
  private STATE = { NONE: -1, ROTATE: 0, DOLLY: 1, PAN: 2 };
  private state = this.STATE.NONE;
  
  private spherical = new THREE.Spherical();
  private sphericalDelta = new THREE.Spherical();
  private scale = 1;
  private panOffset = new THREE.Vector3();
  
  private rotateStart = new THREE.Vector2();
  private rotateEnd = new THREE.Vector2();
  private rotateDelta = new THREE.Vector2();
  
  private panStart = new THREE.Vector2();
  private panEnd = new THREE.Vector2();
  private panDelta = new THREE.Vector2();
  
  // Track touch points for multi-touch gestures
  private prevTouchDistance = -1;
  private prevTouchMidpoint = new THREE.Vector2();
  
  constructor(options: {
    scene: THREE.Object3D;
    camera: THREE.PerspectiveCamera;
    userZoomSpeed?: number;
    userPanSpeed?: number;
    userRotateSpeed?: number;
    element?: HTMLElement;
  }) {
    this.camera = options.camera;
    this.element = options.element || document.body;
    
    if (options.userZoomSpeed) {
      this.zoomSpeed = options.userZoomSpeed;
    }
    
    if (options.userPanSpeed) {
      this.panSpeed = options.userPanSpeed;
    }
    
    if (options.userRotateSpeed) {
      this.rotateSpeed = options.userRotateSpeed;
    }
    
    // Set up initial spherical coordinates
    this.updateSpherical();
    
    // Bind methods
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onMouseWheel = this.onMouseWheel.bind(this);
    
    // Bind touch methods
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    
    // Add event listeners
    this.element.addEventListener('mousedown', this.onMouseDown, false);
    this.element.addEventListener('wheel', this.onMouseWheel, false);
    
    // Add touch event listeners
    this.element.addEventListener('touchstart', this.onTouchStart, false);
    this.element.addEventListener('touchmove', this.onTouchMove, false);
    this.element.addEventListener('touchend', this.onTouchEnd, false);
    
    // Initial update
    this.update();
    
    console.log('[OrbitControls] Initialized: Left=Rotate, Middle=Pan, Wheel=Zoom, Touch: 1-finger=Rotate, 2-finger=Pan/Zoom');
  }
  
  private updateSpherical(): void {
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.target);
    
    // Convert from cartesian to spherical coordinates
    this.spherical.setFromVector3(offset);
  }
  
  private onMouseDown(event: MouseEvent): void {
    if (!this.enabled) return;
    
    event.preventDefault();
    
    switch (event.button) {
      case this.mouseButtons.LEFT:
        this.state = this.STATE.ROTATE;
        this.rotateStart.set(event.clientX, event.clientY);
        break;
      case this.mouseButtons.MIDDLE:
        // Middle click (wheel button) for pan/translate
        this.state = this.STATE.PAN;
        this.panStart.set(event.clientX, event.clientY);
        break;
      case this.mouseButtons.RIGHT:
        // Right click - no action (allow context menu)
        this.state = this.STATE.NONE;
        return; // Don't prevent default to allow context menu
      default:
        this.state = this.STATE.NONE;
    }
    
    if (this.state !== this.STATE.NONE) {
      document.addEventListener('mousemove', this.onMouseMove, false);
      document.addEventListener('mouseup', this.onMouseUp, false);
    }
  }
  
  private onMouseMove(event: MouseEvent): void {
    if (!this.enabled) return;
    
    event.preventDefault();
    
    switch (this.state) {
      case this.STATE.ROTATE:
        this.rotateEnd.set(event.clientX, event.clientY);
        this.rotateDelta.subVectors(this.rotateEnd, this.rotateStart);
        
        // Get element dimensions for rotation calculations
        const element = this.element === document.body ? document.body : this.element;
        const elementWidth = element.clientWidth;
        const elementHeight = element.clientHeight;
        
        // Scale factor for rotation (adjust as needed for sensitivity)
        const rotateSpeed = this.rotateSpeed;
        
        // Completely separate axis handling for Z-up system
        // Horizontal movement (X) - rotate around Z axis (azimuthal angle)
        const horizontalRotationAngle = 2 * Math.PI * this.rotateDelta.x / elementWidth * rotateSpeed;
        
        // Apply rotation around world Z axis (phi in spherical coordinates)
        const rotationZ = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1), 
          -horizontalRotationAngle
        );
        
        // Apply Z-axis rotation to current camera position
        const cameraPosition = new THREE.Vector3().subVectors(
          this.camera.position,
          this.target
        );
        cameraPosition.applyQuaternion(rotationZ);
        
        // Vertical movement (Y) - rotate around local X axis (polar angle)
        // First get the right vector (perpendicular to camera direction and Z-up)
        const forward = cameraPosition.clone().normalize();
        const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), forward).normalize();
        
        // Calculate vertical rotation angle
        const verticalRotationAngle = 2 * Math.PI * this.rotateDelta.y / elementHeight * rotateSpeed;
        
        // Apply rotation around right vector
        const rotationX = new THREE.Quaternion().setFromAxisAngle(right, verticalRotationAngle);
        cameraPosition.applyQuaternion(rotationX);
        
        // Update camera position based on rotated vector
        this.camera.position.copy(this.target).add(cameraPosition);
        
        // Ensure camera up vector stays aligned with world Z
        this.camera.up.set(0, 0, 1);
        
        // Look at target
        this.camera.lookAt(this.target);
        
        this.rotateStart.copy(this.rotateEnd);
        break;
        
      case this.STATE.PAN:
        this.panEnd.set(event.clientX, event.clientY);
        this.panDelta.subVectors(this.panEnd, this.panStart);
        
        // Invert X only, keep Y natural for up/down
        this.pan(-this.panDelta.x, this.panDelta.y);
        
        this.panStart.copy(this.panEnd);
        
        // Update camera view after panning
        this.update();
        break;
    }
  }
  
  private onMouseUp(event: MouseEvent): void {
    document.removeEventListener('mousemove', this.onMouseMove, false);
    document.removeEventListener('mouseup', this.onMouseUp, false);
    
    this.state = this.STATE.NONE;
  }
  
  private onMouseWheel(event: WheelEvent): void {
    if (!this.enabled) return;
    
    event.preventDefault();
    
    // Detect trackpad pinch-zoom (Ctrl + wheel) or regular mouse wheel
    if (event.ctrlKey) {
      // Trackpad pinch-to-zoom (Ctrl is automatically added by browser)
      // Inverted: pinch out = zoom out, pinch in = zoom in
      if (event.deltaY < 0) {
        this.dollyOut();
      } else {
        this.dollyIn();
      }
    } else if (Math.abs(event.deltaX) > 0 || Math.abs(event.deltaY) > 0) {
      // Trackpad two-finger pan OR mouse wheel
      // If deltaX is significant, treat as trackpad pan
      if (Math.abs(event.deltaX) > 1 || (Math.abs(event.deltaY) > 1 && event.deltaMode === 0)) {
        // Trackpad pan - invert X only, keep Y natural for up/down
        this.pan(event.deltaX * 0.5, -event.deltaY * 0.5);
        this.update();
      } else {
        // Regular mouse wheel - zoom
        if (event.deltaY < 0) {
          this.dollyIn();
        } else {
          this.dollyOut();
        }
      }
    }
    
    this.update();
  }
  
  private onTouchStart(event: TouchEvent): void {
    if (!this.enabled) return;
    
    event.preventDefault();
    
    switch (event.touches.length) {
      case 1: // Single touch - handle as rotation
        this.state = this.STATE.ROTATE;
        this.rotateStart.set(
          event.touches[0].clientX,
          event.touches[0].clientY
        );
        break;
        
      case 2: // Two touches - pinch zoom or two-finger pan
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        this.prevTouchDistance = Math.sqrt(dx * dx + dy * dy);
        
        // Store the midpoint for tracking pan movement
        const x = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        const y = (event.touches[0].clientY + event.touches[1].clientY) / 2;
        this.prevTouchMidpoint.set(x, y);
        this.panStart.set(x, y);
        this.state = this.STATE.DOLLY; // Two-finger state
        break;
        
      default:
        this.state = this.STATE.NONE;
    }
  }
  
  private onTouchMove(event: TouchEvent): void {
    if (!this.enabled) return;
    
    event.preventDefault();
    
    switch (event.touches.length) {
      case 1: // Single touch - handle as rotation
        if (this.state === this.STATE.ROTATE) {
          this.rotateEnd.set(
            event.touches[0].clientX,
            event.touches[0].clientY
          );
          this.rotateDelta.subVectors(this.rotateEnd, this.rotateStart);
          
          // Get element dimensions for rotation calculations
          const element = this.element === document.body ? document.body : this.element;
          const elementWidth = element.clientWidth;
          const elementHeight = element.clientHeight;
          
          // Scale factor for rotation - reduced for touch (0.4x) for smoother control
          const rotateSpeed = this.rotateSpeed * 0.4;
          
          // Completely separate axis handling for Z-up system
          // Horizontal movement (X) - rotate around Z axis (azimuthal angle)
          const horizontalRotationAngle = 2 * Math.PI * this.rotateDelta.x / elementWidth * rotateSpeed;
          
          // Apply rotation around world Z axis (phi in spherical coordinates)
          const rotationZ = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1), 
            -horizontalRotationAngle
          );
          
          // Apply Z-axis rotation to current camera position
          const cameraPosition = new THREE.Vector3().subVectors(
            this.camera.position,
            this.target
          );
          cameraPosition.applyQuaternion(rotationZ);
          
          // Vertical movement (Y) - rotate around local X axis (polar angle)
          // First get the right vector (perpendicular to camera direction and Z-up)
          const forward = cameraPosition.clone().normalize();
          const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), forward).normalize();
          
          // Calculate vertical rotation angle
          const verticalRotationAngle = 2 * Math.PI * this.rotateDelta.y / elementHeight * rotateSpeed;
          
          // Apply rotation around right vector
          const rotationX = new THREE.Quaternion().setFromAxisAngle(right, verticalRotationAngle);
          cameraPosition.applyQuaternion(rotationX);
          
          // Update camera position based on rotated vector
          this.camera.position.copy(this.target).add(cameraPosition);
          
          // Ensure camera up vector stays aligned with world Z
          this.camera.up.set(0, 0, 1);
          
          // Look at target
          this.camera.lookAt(this.target);
          
          this.rotateStart.copy(this.rotateEnd);
        }
        break;
        
      case 2: // Two touches - handle zoom and pan separately each frame
        // Calculate current distance between touch points
        const dx2 = event.touches[0].clientX - event.touches[1].clientX;
        const dy2 = event.touches[0].clientY - event.touches[1].clientY;
        const touchDistance = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        
        // Calculate current midpoint
        const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
        
        if (this.prevTouchDistance > 0) {
          // Calculate distance change ratio (for pinch detection)
          const distanceChange = touchDistance - this.prevTouchDistance;
          const pinchRatio = Math.abs(distanceChange) / this.prevTouchDistance;
          
          // Calculate midpoint movement
          const midpointDeltaX = midX - this.prevTouchMidpoint.x;
          const midpointDeltaY = midY - this.prevTouchMidpoint.y;
          const midpointMovement = Math.sqrt(midpointDeltaX * midpointDeltaX + midpointDeltaY * midpointDeltaY);
          
          // Pinch zoom: significant change in finger distance (>4% of current spread)
          // This triggers when fingers move toward/away from each other
          // Inverted: pinch out (spread fingers) = zoom out, pinch in = zoom in
          if (pinchRatio > 0.04) {
            if (distanceChange > 0) {
              this.dollyOut();
            } else {
              this.dollyIn();
            }
          }
          // Pan: significant midpoint movement with relatively stable finger distance
          // Threshold of 8px to avoid accidental triggering, pinchRatio < 3% for stability
          else if (midpointMovement > 8 && pinchRatio < 0.03) {
            this.panEnd.set(midX, midY);
            this.panDelta.subVectors(this.panEnd, this.panStart);
            // Multiply pan delta for faster movement, invert X only (Y inverted for up/down)
            this.pan(-this.panDelta.x * 2.5, this.panDelta.y * 2.5);
            this.panStart.copy(this.panEnd);
          }
        }
        
        // Update tracking values
        this.prevTouchDistance = touchDistance;
        this.prevTouchMidpoint.set(midX, midY);
        this.panStart.set(midX, midY); // Keep pan start updated
        break;
    }
    
    this.update();
  }
  
  private onTouchEnd(event: TouchEvent): void {
    this.state = this.STATE.NONE;
    this.prevTouchDistance = -1;
  }
  
  private pan(deltaX: number, deltaY: number): void {
    const element = this.element === document.body ? 
      document.body : this.element;
    
    // Adjust pan speed based on camera position
    const position = this.camera.position;
    const targetDistance = position.distanceTo(this.target);
    
    // Scale panning based on distance
    deltaX *= targetDistance * this.panSpeed / element.clientWidth;
    deltaY *= targetDistance * this.panSpeed / element.clientHeight;
    
    // For Z-up system:
    // Create precise panning vectors that align with the screen
    const worldUp = new THREE.Vector3(0, 0, 1);
    
    // Get the vector from target to camera (camera direction reversed)
    const offset = new THREE.Vector3().subVectors(position, this.target);
    
    // Get right vector (screen X direction)
    // Cross product of camera direction and world up
    const panX = new THREE.Vector3().crossVectors(offset, worldUp).normalize();
    
    // Get the screen's Y axis vector (perpendicular to both)
    // This ensures correct panning in the screen plane
    const forward = offset.clone().normalize();
    const panY = new THREE.Vector3().crossVectors(panX, forward).normalize();
    
    // Move along right vector for X movement 
    const moveX = panX.clone().multiplyScalar(-deltaX);
    
    // Move along screen Y vector for Y movement
    const moveY = panY.clone().multiplyScalar(deltaY);
    
    // Apply the combined movement
    position.add(moveX).add(moveY);
    this.target.add(moveX).add(moveY);
  }
  
  private dollyIn(): void {
    this.scale /= 0.95;
  }
  
  private dollyOut(): void {
    this.scale *= 0.95;
  }
  
  public update(): void {
    // This method is now simplified since most rotation handling 
    // is done directly in onMouseMove and onTouchMove
    
    // Apply scale (zooming) if needed
    if (this.scale !== 1) {
      const position = this.camera.position;
      const offset = position.clone().sub(this.target);
      
      // Scale distance from target
      offset.multiplyScalar(this.scale);
      
      // Update position based on scaled offset
      position.copy(this.target).add(offset);
      
      // Reset scale
      this.scale = 1;
    }
    
    // Apply pan offset if needed
    if (!this.panOffset.equals(new THREE.Vector3(0, 0, 0))) {
      this.target.add(this.panOffset);
      this.camera.position.add(this.panOffset);
      this.panOffset.set(0, 0, 0);
    }
    
    // Ensure camera is looking at target
    this.camera.lookAt(this.target);
    
    // Always maintain Z-up orientation
    this.camera.up.set(0, 0, 1);
  }
  
  public dispose(): void {
    this.element.removeEventListener('mousedown', this.onMouseDown, false);
    this.element.removeEventListener('wheel', this.onMouseWheel, false);
    document.removeEventListener('mousemove', this.onMouseMove, false);
    document.removeEventListener('mouseup', this.onMouseUp, false);
    
    // Remove touch event listeners
    this.element.removeEventListener('touchstart', this.onTouchStart, false);
    this.element.removeEventListener('touchmove', this.onTouchMove, false);
    this.element.removeEventListener('touchend', this.onTouchEnd, false);
  }
}

// UrdfClient implementation
// Adapted from ROS1 ros3djs example, needs further refinement for ROS2 and mesh loading.
class UrdfClient extends THREE.Object3D {
  private ros: Ros;
  private tfClient: CustomTFProvider;
  private path: string; // Base path for mesh resources
  private rootObject: THREE.Object3D;
  private urdfModel: THREE.Object3D | null = null;
  private robotDescriptionTopic: ROSLIB.Topic | null = null;
  private onComplete?: (model: THREE.Object3D) => void;
  private linkNameMap: Map<string, THREE.Object3D> = new Map();
  private colladaLoader: ColladaLoader;
  private stlLoader: STLLoader;

  constructor(options: {
    ros: Ros;
    tfClient: CustomTFProvider;
    rootObject: THREE.Object3D;
    robotDescriptionTopic?: string;
    onComplete?: (model: THREE.Object3D) => void;
    // Removed loader option, will use internal Collada and STL loaders
  }) {
    super();
    this.ros = options.ros;
    this.tfClient = options.tfClient;
    this.path = '/mesh_resources/'; // Hardcoded path
    this.rootObject = options.rootObject;
    this.onComplete = options.onComplete;

    this.colladaLoader = new ColladaLoader();
    this.stlLoader = new STLLoader();

    this.rootObject.add(this);

    const descriptionTopicName = options.robotDescriptionTopic || '/robot_description';
    this.robotDescriptionTopic = new ROSLIB.Topic({
      ros: this.ros,
      name: descriptionTopicName,
      messageType: 'std_msgs/String',
      compression: 'none',
      throttle_rate: 0,
      queue_size: 1,
      latch: true,
    });

    console.log(`[UrdfClient] Subscribing to ${descriptionTopicName} for URDF.`);
    this.robotDescriptionTopic.subscribe(this.handleUrdfString.bind(this));
  }

  private handleUrdfString(message: any): void {
    if (this.urdfModel) {
      console.log('[UrdfClient] URDF already loaded, ignoring new message.');
      return;
    }
    console.log('[UrdfClient] Received URDF string.');
    this.robotDescriptionTopic?.unsubscribe();
    this.loadUrdf(message.data);
  }

  private parseUrdf(urdfString: string): XMLDocument | null {
    try {
      const parser = new DOMParser();
      return parser.parseFromString(urdfString, 'application/xml');
    } catch (e) {
      console.error('[UrdfClient] Error parsing URDF XML:', e);
      return null;
    }
  }

  private loadUrdf(urdfString: string): void {
    const xmlDoc = this.parseUrdf(urdfString);
    if (!xmlDoc) return;

    const robotNode = xmlDoc.getElementsByTagName('robot')[0];
    if (!robotNode) {
      console.error('[UrdfClient] <robot> tag not found in URDF.');
      return;
    }

    this.urdfModel = new THREE.Group();
    this.urdfModel.name = robotNode.getAttribute('name') || 'urdf_robot';
    this.add(this.urdfModel); // Add the main robot model to this UrdfClient object

    const links = Array.from(robotNode.getElementsByTagName('link'));
    const joints = Array.from(robotNode.getElementsByTagName('joint'));

    // Create Object3D for each link
    links.forEach(linkElement => {
      const linkName = linkElement.getAttribute('name');
      if (linkName) {
        const linkObject = new THREE.Group();
        linkObject.name = linkName;
        this.linkNameMap.set(linkName, linkObject);
        // Visuals are added later, joints will parent them
      }
    });

    // Keep track of root links (links that are not children of any joint)
    const childLinks = new Set<string>();
    const rootLinks: string[] = [];

    // Process joints to establish hierarchy and add visuals/collisions to parent links
    joints.forEach(jointElement => {
      const jointName = jointElement.getAttribute('name');
      const jointType = jointElement.getAttribute('type');
      const parentLinkName = jointElement.getElementsByTagName('parent')[0]?.getAttribute('link');
      const childLinkName = jointElement.getElementsByTagName('child')[0]?.getAttribute('link');

      if (jointName && parentLinkName && childLinkName) {
        const parentObject = this.linkNameMap.get(parentLinkName);
        const childObject = this.linkNameMap.get(childLinkName);

        if (parentObject && childObject) {
          parentObject.add(childObject); // Add child link to parent link
          childLinks.add(childLinkName); // Mark this link as a child
          
          console.log(`[UrdfClient] Joint ${jointName}: ${parentLinkName} -> ${childLinkName}`);

          const originElement = jointElement.getElementsByTagName('origin')[0];
          if (originElement) {
            const xyz = originElement.getAttribute('xyz')?.split(' ').map(Number) || [0,0,0];
            const rpy = originElement.getAttribute('rpy')?.split(' ').map(Number) || [0,0,0];
            childObject.position.set(xyz[0], xyz[1], xyz[2]);
            // Convert URDF RPY (roll-pitch-yaw) to THREE.js Euler angles
            // URDF RPY is intrinsic rotations: first roll around X, then pitch around Y, then yaw around Z
            // THREE.js Euler with 'XYZ' order applies extrinsic rotations in X, Y, Z order
            // For Z-up coordinate system, we need to be careful about axis mapping
            const euler = new THREE.Euler(rpy[0], rpy[1], rpy[2], 'XYZ');
            childObject.rotation.copy(euler);
            
            console.log(`[UrdfClient] Joint ${jointName} origin: pos(${xyz.join(',')}) rot(${rpy.join(',')})`);
          }
        } else {
          console.warn(`[UrdfClient] Parent or child link not found for joint ${jointName}`);
        }
      }      
    });

    // Identify root links (not children of any joint)
    this.linkNameMap.forEach((linkObject, linkName) => {
      if (!childLinks.has(linkName)) {
        rootLinks.push(linkName);
      }
    });

    console.log(`[UrdfClient] Found ${rootLinks.length} root links:`, rootLinks);

    // Add visuals to their respective link objects AFTER hierarchy is set
    links.forEach(linkElement => {
      const linkName = linkElement.getAttribute('name');
      const linkObject = linkName ? this.linkNameMap.get(linkName) : null;
      if (!linkObject) return;

      const visualElements = Array.from(linkElement.getElementsByTagName('visual'));
      visualElements.forEach(visualElement => {
        this.loadVisual(visualElement, linkObject);
      });
    });

    // Add only root links to the main urdfModel
    rootLinks.forEach(rootLinkName => {
      const rootLinkObject = this.linkNameMap.get(rootLinkName);
      if (rootLinkObject && this.urdfModel) {
        this.urdfModel.add(rootLinkObject);
      }
    });

    console.log('[UrdfClient] URDF structure processed.', this.urdfModel);
    if (this.onComplete && this.urdfModel) {
      this.onComplete(this.urdfModel);
    }
    this.setupTfUpdates(rootLinks);
  }

  private loadVisual(visualElement: Element, linkObject: THREE.Object3D): void {
    const geometryElement = visualElement.getElementsByTagName('geometry')[0];
    if (!geometryElement) return;

    let mesh: THREE.Object3D | null = null;
    const meshElement = geometryElement.getElementsByTagName('mesh')[0];
    const boxElement = geometryElement.getElementsByTagName('box')[0];
    const cylinderElement = geometryElement.getElementsByTagName('cylinder')[0];
    const sphereElement = geometryElement.getElementsByTagName('sphere')[0];

    // Load URDF material if specified
    const materialElement = visualElement.getElementsByTagName('material')[0];
    const urdfMaterial = materialElement ? this.loadMaterial(materialElement) : null;

    if (meshElement) {
      const filename = meshElement.getAttribute('filename');
      if (filename) {
        const fullPath = this.resolvePackagePath(filename);
        const scaleAttr = meshElement.getAttribute('scale')?.split(' ').map(Number) || [1,1,1];
        const scaleVec = new THREE.Vector3(scaleAttr[0], scaleAttr[1], scaleAttr[2]);

        if (filename.toLowerCase().endsWith('.dae') || filename.toLowerCase().endsWith('.collada')) {
          this.colladaLoader.load(fullPath, (collada) => {
            const daeMesh = collada.scene;
            daeMesh.scale.copy(scaleVec);
            
            // Counter-rotate to undo ColladaLoader's automatic Y-up conversion
            // ColladaLoader rotates Z-up assets to Y-up, but we want Z-up
            // The automatic rotation is usually -90 degrees around X-axis
            daeMesh.rotateX(Math.PI / 2); // Rotate +90 degrees around X to restore Z-up
            
            this.applyOrigin(visualElement, daeMesh);
            
            // Only override materials if URDF explicitly specifies a material
            if (urdfMaterial) {
              daeMesh.traverse(child => { 
                if (child instanceof THREE.Mesh) {
                  child.material = urdfMaterial; 
                }
              });
            } else {
              // Improve the existing materials for better visibility
              daeMesh.traverse(child => { 
                if (child instanceof THREE.Mesh) {
                  if (child.material) {
                    // If material exists, ensure it works with lighting
                    if (child.material instanceof THREE.MeshLambertMaterial || 
                        child.material instanceof THREE.MeshPhongMaterial) {
                      // Keep existing material but ensure it's visible
                    } else {
                      // Convert basic materials to lit materials
                      const existingColor = (child.material as any).color || new THREE.Color(0xcccccc);
                      child.material = new THREE.MeshLambertMaterial({ 
                        color: existingColor,
                        transparent: false 
                      });
                    }
                  } else {
                    // No material, use default
                    child.material = new THREE.MeshLambertMaterial({ 
                      color: 0xcccccc,
                      transparent: false 
                    });
                  }
                }
              });
            }
            
            linkObject.add(daeMesh);
            console.log(`[UrdfClient] Loaded DAE: ${fullPath}`);
          }, undefined, (error) => console.error(`[UrdfClient] Error loading DAE ${fullPath}:`, error));
        } else if (filename.toLowerCase().endsWith('.stl')) {
          this.stlLoader.load(fullPath, (geometry) => {
            const material = urdfMaterial || new THREE.MeshLambertMaterial({ color: 0xcccccc });
            const stlMesh = new THREE.Mesh(geometry, material);
            stlMesh.scale.copy(scaleVec);
            this.applyOrigin(visualElement, stlMesh);
            linkObject.add(stlMesh);
            console.log(`[UrdfClient] Loaded STL: ${fullPath}`);
          }, undefined, (error) => console.error(`[UrdfClient] Error loading STL ${fullPath}:`, error));
        } else {
          console.warn(`[UrdfClient] Unsupported mesh type: ${filename}`);
        }
      }
    } else if (boxElement) {
      const size = boxElement.getAttribute('size')?.split(' ').map(Number) || [0.1, 0.1, 0.1];
      const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
      const material = urdfMaterial || new THREE.MeshLambertMaterial({ color: 0xcccccc });
      mesh = new THREE.Mesh(geometry, material);
    } else if (cylinderElement) {
      const radius = parseFloat(cylinderElement.getAttribute('radius') || '0.05');
      const length = parseFloat(cylinderElement.getAttribute('length') || '0.1');
      const geometry = new THREE.CylinderGeometry(radius, radius, length, 16);
      const material = urdfMaterial || new THREE.MeshLambertMaterial({ color: 0xcccccc });
      mesh = new THREE.Mesh(geometry, material);
      mesh.rotateX(Math.PI / 2); // Align with URDF cylinder convention (Z-axis along length)
    } else if (sphereElement) {
      const radius = parseFloat(sphereElement.getAttribute('radius') || '0.05');
      const geometry = new THREE.SphereGeometry(radius, 16, 16);
      const material = urdfMaterial || new THREE.MeshLambertMaterial({ color: 0xcccccc });
      mesh = new THREE.Mesh(geometry, material);
    }

    if (mesh) { // For primitive shapes
      this.applyOrigin(visualElement, mesh);
      linkObject.add(mesh);
    }
  }
  
  private applyOrigin(visualOrCollisionElement: Element, object: THREE.Object3D): void {
    const originElement = visualOrCollisionElement.getElementsByTagName('origin')[0];
    if (originElement) {
        const xyz = originElement.getAttribute('xyz')?.split(' ').map(Number) || [0,0,0];
        const rpy = originElement.getAttribute('rpy')?.split(' ').map(Number) || [0,0,0];
        object.position.set(xyz[0], xyz[1], xyz[2]);
        
        // Convert URDF RPY (roll-pitch-yaw) to THREE.js Euler angles
        // URDF RPY is intrinsic rotations: first roll around X, then pitch around Y, then yaw around Z
        // THREE.js Euler with 'XYZ' order applies extrinsic rotations in X, Y, Z order
        // For Z-up coordinate system, we need to be careful about axis mapping
        const euler = new THREE.Euler(rpy[0], rpy[1], rpy[2], 'XYZ');
        object.rotation.copy(euler);
    }
  }

  private resolvePackagePath(filePath: string): string {
    // First handle package:// URLs
    if (filePath.startsWith('package://')) {
      // Replace package://<package_name>/ with the base path + <package_name>/
      const resolved = filePath.replace(/package:\/\/([^\/]*)\//, (match, packageName) => {
        const basePath = this.path.endsWith('/') ? this.path : this.path + '/';
        return `${basePath}${packageName}/`;
      });
      console.log(`[UrdfClient] Resolved package path: ${filePath} -> ${resolved}`);
      return resolved;
    }

    // Handle localhost:8000 URLs by replacing them with /mesh_resources
    if (filePath.startsWith('http://localhost:8000/')) {
      const resolved = filePath.replace('http://localhost:8000/', '/mesh_resources/');
      console.log(`[UrdfClient] Resolved localhost path: ${filePath} -> ${resolved}`);
      return resolved;
    }

    // If not a package path or localhost URL, assume it's relative to the main URDF or an absolute URL
    if (!filePath.startsWith('http://') && !filePath.startsWith('https://') && this.path) {
      const resolved = (this.path.endsWith('/') ? this.path : this.path + '/') + filePath;
      console.log(`[UrdfClient] Resolved relative path: ${filePath} -> ${resolved}`);
      return resolved;
    }

    return filePath;
  }
  
  private loadMaterial(materialElement?: Element): THREE.Material {
    let color = new THREE.Color(0xcccccc); // Default light grey instead of darker grey
    let texture = null;

    if (materialElement) {
        const colorElement = materialElement.getElementsByTagName('color')[0];
        if (colorElement) {
            const rgba = colorElement.getAttribute('rgba')?.split(' ').map(Number);
            if (rgba && rgba.length === 4) {
                color.setRGB(rgba[0], rgba[1], rgba[2]); // Ignores alpha for now
            }
        }
        const textureElement = materialElement.getElementsByTagName('texture')[0];
        if (textureElement) {
            const filename = textureElement.getAttribute('filename');
            if (filename) {
                // Basic texture loading, assuming PNG or JPG
                // Proper path resolution for textures is also needed here
                const texturePath = this.resolvePackagePath(filename);
                try {
                    texture = new THREE.TextureLoader().load(texturePath);
                    console.log(`[UrdfClient] Loading texture: ${texturePath}`);
                } catch (e) {
                    console.error(`[UrdfClient] Error loading texture ${texturePath}:`, e);
                }
            }
        }
    }
    // Use MeshLambertMaterial for better performance and compatibility with our lighting setup
    return new THREE.MeshLambertMaterial({ 
      color: color, 
      map: texture,
      transparent: false,
      side: THREE.FrontSide
    });
  }

  private setupTfUpdates(rootLinks: string[]): void {
    if (this.urdfModel) {
        console.log(`[UrdfClient] Setting up TF updates for ${this.linkNameMap.size} links.`);
        
        const robotModelName = this.urdfModel.name || ''; // e.g., "drone0" or "my_robot"
        let topicNamespace = '';
        if (this.robotDescriptionTopic?.name) {
            const parts = this.robotDescriptionTopic.name.split('/').filter(p => p.length > 0);
            // A common pattern for robot_description is /namespace/robot_description or /robot_description
            // If namespaced, parts[0] would be the namespace.
            if (parts.length > 1 && parts[0] !== 'robot_description') { 
                topicNamespace = parts[0]; 
            }
        }

        this.linkNameMap.forEach((linkObject, urdfLinkName) => {
            const framesToTry: string[] = [];
            // 1. Direct URDF link name
            framesToTry.push(urdfLinkName);

            // 2. Namespace from topic + URDF link name
            if (topicNamespace) {
                framesToTry.push(`${topicNamespace}/${urdfLinkName}`);
            }

            // 3. Robot model name from URDF + URDF link name (if different from topic namespace)
            if (robotModelName && robotModelName !== topicNamespace) {
                framesToTry.push(`${robotModelName}/${urdfLinkName}`);
            }
            
            const uniqueFramesToTry = [...new Set(framesToTry)];
            let activeSubscriptionFrame: string | null = null;

            console.log(`[UrdfClient] For URDF link "${urdfLinkName}", trying TF frames: ${uniqueFramesToTry.join(', ')}`);

            const subscriptionCallback = (tfFrameName: string, transform: StoredTransform | null) => {
                if (transform) {
                    if (!activeSubscriptionFrame) {
                        activeSubscriptionFrame = tfFrameName;
                        console.log(`[UrdfClient] Successful TF data for URDF link "${urdfLinkName}" from TF frame "${tfFrameName}"`);
                        // If other subscriptions were made for this link, they should be cancelled here if possible
                        // For now, this logic means the first to provide data 'wins'.
                    } else if (activeSubscriptionFrame !== tfFrameName) {
                        // Already have an active subscription for this link from a different TF frame name.
                        // This callback is from an alternative name that also got data; we ignore it.
                        return; 
                    }

                    const currentParent = linkObject.parent;
                    if (currentParent && currentParent !== this.urdfModel && this.urdfModel) {
                        currentParent.remove(linkObject);
                        if (linkObject.parent !== this.urdfModel) { 
                           this.urdfModel.add(linkObject);
                        }
                    } else if (!currentParent && this.urdfModel) {
                        this.urdfModel.add(linkObject);
                    }

                    linkObject.position.set(transform.translation.x, transform.translation.y, transform.translation.z);
                    linkObject.quaternion.set(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w);
                    linkObject.updateMatrix();
                    linkObject.matrixWorldNeedsUpdate = true;
                }
            };

            uniqueFramesToTry.forEach(frameName => {
                this.tfClient.subscribe(frameName, (transform: StoredTransform | null) => {
                    subscriptionCallback(frameName, transform);
                });
            });

            // Optional: Initial check for immediate availability (for faster first render)
            let initialFrameFound = false;
            for (const frameName of uniqueFramesToTry) {
                try {
                    // Use a common fixed frame like 'odom' for the lookup check
                    const initialTransform = this.tfClient.lookupTransform('odom', frameName); // Default to 'odom'
                    if (initialTransform) {
                        console.log(`[UrdfClient] URDF link "${urdfLinkName}" initially found active TF frame "${frameName}"`);
                        // Trigger the callback manually with this initial transform to potentially render faster
                        // subscriptionCallback(frameName, initialTransform);
                        initialFrameFound = true;
                        break; 
                    }
                } catch (e) { /* lookup failed, try next */ }
            }
            if (!initialFrameFound) {
                 console.warn(`[UrdfClient] URDF link "${urdfLinkName}": No TF frame immediately found among [${uniqueFramesToTry.join(', ')}]. Waiting for subscription data.`);
            }
        });
        
        if (this.linkNameMap.size === 0 && this.urdfModel && rootLinks.length > 0) {
            const baseFrameToTry = rootLinks[0]; 
            console.warn(`[UrdfClient] Fallback: No links in URDF. Subscribing to ${baseFrameToTry} for the whole model.`);
            this.tfClient.subscribe(baseFrameToTry, (transform: StoredTransform | null) => {
                if (transform && this.urdfModel) {
                    this.urdfModel.position.set(transform.translation.x, transform.translation.y, transform.translation.z);
                    this.urdfModel.quaternion.set(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w);
                    this.urdfModel.updateMatrix();
                    this.urdfModel.matrixWorldNeedsUpdate = true;
                }
            });
        }
    }
    console.log(`[UrdfClient] TF update subscriptions configured.`);
  }

  public dispose(): void {
    if (this.robotDescriptionTopic) {
      this.robotDescriptionTopic.unsubscribe();
      this.robotDescriptionTopic = null;
    }
    if (this.urdfModel) {
      // Traverse and dispose geometries/materials
      this.urdfModel.traverse(child => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
      this.remove(this.urdfModel);
      this.urdfModel = null;
    }
    this.linkNameMap.clear();
    // TODO: Unsubscribe from all TF frames if tfClient.unsubscribe supports targeted removal based on callback or ID
    console.log('[UrdfClient] Disposed.');
  }
}

// Export as default and named exports to match the original module
const ROS3D = {
  Viewer,
  Grid,
  Axes,
  PointCloud2,
  LaserScan,
  OrbitControls,
  UrdfClient,
};

export { Viewer, Grid, Axes, PointCloud2, LaserScan, OrbitControls, UrdfClient };
export default ROS3D; 