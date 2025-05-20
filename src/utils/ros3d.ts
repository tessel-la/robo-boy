// Internal implementation of ros3d functionality
import * as THREE from 'three';
import { Ros } from 'roslib';
import * as ROSLIB from 'roslib';

// Basic viewer class implementation
export class Viewer {
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
export class Grid extends THREE.Object3D {
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
export class Axes extends THREE.Object3D {
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

// TfClient implementation (simplified)
export class TfClient {
  private ros: Ros;
  private frameCallbacks: Map<string, ((transform: any | null) => void)[]> = new Map();
  private fixedFrame: string;
  
  constructor(options: {
    ros: Ros;
    fixedFrame: string;
    angularThres?: number;
    transThres?: number;
    rate?: number;
    topicTimeout?: number;
    serverName?: string;
    repubServiceName?: string;
  }) {
    this.ros = options.ros;
    this.fixedFrame = options.fixedFrame || 'base_link';
    
    // Subscribe to TF topic
    this.subscribeTopic();
  }

  private subscribeTopic(): void {
    try {
      const tfTopic = new ROSLIB.Topic({
        ros: this.ros,
        name: '/tf',
        messageType: 'tf2_msgs/TFMessage'
      });
      
      tfTopic.subscribe((message: any) => {
        this.processTfMessage(message);
      });
      
      console.log(`[TfClient] Subscribed to TF messages with fixed frame: ${this.fixedFrame}`);
    } catch (error) {
      console.error('[TfClient] Error subscribing to TF topic:', error);
    }
  }
  
  private processTfMessage(message: any): void {
    if (!message || !message.transforms || !Array.isArray(message.transforms)) {
      return;
    }
    
    // Process each transform
    message.transforms.forEach((transform: any) => {
      const frameId = transform.child_frame_id;
      const parentId = transform.header.frame_id;
      
      // Skip if no callbacks for this frame
      if (!this.frameCallbacks.has(frameId)) {
        return;
      }
      
      // Create transform object with coordinate system conversion
      const translation = transform.transform.translation;
      const rotation = transform.transform.rotation;
      
      // Create a transform with ROS-to-THREE coordinate conversion for Z-up
      const convertedTransform = {
        translation: new THREE.Vector3(
          translation.x,
          translation.y,  // ROS Y stays as THREE.js Y 
          translation.z   // ROS Z stays as THREE.js Z (up)
        ),
        rotation: new THREE.Quaternion(
          rotation.x,
          rotation.y,    // ROS Y rotation axis stays as THREE.js Y
          rotation.z,    // ROS Z rotation axis stays as THREE.js Z
          rotation.w
        )
      };
      
      // Call the callbacks with the processed transform
      const callbacks = this.frameCallbacks.get(frameId);
      if (callbacks) {
        callbacks.forEach(callback => {
          callback({
            sourceFrameId: parentId,
            targetFrameId: frameId,
            transform: convertedTransform
          });
        });
      }
    });
  }

  subscribe(frameId: string, callback: (transform: any | null) => void): void {
    const callbacks = this.frameCallbacks.get(frameId) || [];
    callbacks.push(callback);
    this.frameCallbacks.set(frameId, callbacks);
    console.log(`[TfClient] Subscribed to frame: ${frameId}`);
  }

  unsubscribe(frameId: string, callback?: (transform: any | null) => void): void {
    if (!callback) {
      this.frameCallbacks.delete(frameId);
      console.log(`[TfClient] Unsubscribed from all callbacks for frame: ${frameId}`);
    } else {
      const callbacks = this.frameCallbacks.get(frameId) || [];
      const filteredCallbacks = callbacks.filter(cb => cb !== callback);
      this.frameCallbacks.set(frameId, filteredCallbacks);
      console.log(`[TfClient] Unsubscribed specific callback for frame: ${frameId}`);
    }
  }
  
  // Getter for fixedFrame
  getFixedFrame(): string {
    return this.fixedFrame;
  }
}

// PointCloud2 implementation (enhanced)
export class PointCloud2 extends THREE.Object3D {
  private ros: Ros;
  private topic: string;
  private tfClient: any; // TfClient or any compatible TF provider
  private rootObject: THREE.Object3D;
  private maxPoints: number;
  private pointSize: number;
  private compression: string;
  private throttleRate: number;
  private points: any;
  private messageFrameId: string | null = null;
  private fixedFrame: string;
  
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
    tfClient: TfClient;
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
    this.throttleRate = options.throttle_rate || 100;
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
      // Run at most 30fps to avoid excessive CPU usage
      const now = performance.now();
      if (now - lastTransformTime < 33 && retryCount === 0) { // ~30fps, unless we're retrying
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
          // Look up transformation from the message frame to the fixed frame
          let tf;
          try {
            tf = (this.tfClient as any).lookupTransform(fixedFrame, this.messageFrameId);
          } catch (error) {
            // If we get a "not a function" error, try a more direct approach
            if (error instanceof TypeError && error.message.includes('is not a function')) {
              console.warn(`[PointCloud2] Transform lookup method failed, trying fallback with direct access to transforms`);
              
              // Try to access the transforms directly if possible
              const provider = this.tfClient;
              if (provider && (provider as any).transforms) {
                try {
                  // Use the lookupTransform function from tfUtils if available
                  if (typeof (provider as any).lookupTransform === 'function') {
                    tf = (provider as any).lookupTransform(fixedFrame, this.messageFrameId);
                  }
                } catch (fallbackError) {
                  throw error; // Rethrow the original error if fallback fails
                }
              } else {
                throw error; // Rethrow if we can't access the transforms
              }
            } else {
              throw error; // Rethrow other errors
            }
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
      // Create buffer geometry
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(this.maxPoints * 3); // 3 values per point (x, y, z)
      
      // Fill with zeros initially
      for (let i = 0; i < positions.length; i++) {
        positions[i] = 0;
      }
      
      // Create attribute for positions - use addAttribute for THREE.js r89 compatibility
      // THREE.js r89 uses addAttribute instead of setAttribute
      if (geometry.addAttribute) {
        geometry.addAttribute('position', new THREE.BufferAttribute(positions, 3));
      } else {
        // Fallback to setAttribute for newer THREE.js versions
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      }
      
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
      const points = new THREE.Points(geometry, pointMaterial);
      points.frustumCulled = false; // Disable frustum culling
      
      // Store in the points object
      this.points = {
        object: points,
        material: pointMaterial,
        geometry: geometry,
        setup: true
      };
      
      // Add points to this object
      super.add(points);
    } catch (error) {
      console.error('Error initializing points:', error);
    }
  }
  
  // Subscribe to the point cloud topic
  private subscribe(): void {
    if (!this.ros) return;
    
    try {
      console.log(`[PointCloud2] Subscribing to topic: ${this.topic}`);
      
      this.topicSubscription = new ROSLIB.Topic({
        ros: this.ros,
        name: this.topic,
        messageType: 'sensor_msgs/PointCloud2',
        compression: this.compression,
        throttle_rate: this.throttleRate,
        queue_size: 1
      });
      
      this.topicSubscription.subscribe((message: any) => {
        console.log(`[PointCloud2] Received message on topic ${this.topic}`);
        this.processMessage(message);
      });
    } catch (error) {
      console.error('Error subscribing to topic:', error);
    }
  }
  
  // Unsubscribe from the topic
  public unsubscribe(): void {
    if (this.topicSubscription) {
      this.topicSubscription.unsubscribe();
      this.topicSubscription = null;
    }
  }
  
  // Safe method to reset/reinitialize points 
  public safeResetPoints(material?: THREE.Material | { [key: string]: any }): boolean {
    try {
      console.log('[PointCloud2] Attempting to safely reset points');
      
      // Remove existing points from scene if they exist
      if (this.points && this.points.object) {
        super.remove(this.points.object);
      }
      
      // Clean up geometry and material
      if (this.points && this.points.geometry) {
        this.points.geometry.dispose();
      }
      
      if (this.points && this.points.material) {
        this.points.material.dispose();
      }
      
      // Reset points object
      this.points = {
        object: null,
        material: null,
        geometry: null,
        setup: false
      };
      
      // Re-initialize points
      this.initializePoints(material);
      
      return this.points.setup;
    } catch (e) {
      console.error('[PointCloud2] Error in safeResetPoints:', e);
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
        try {
          const tf = (this.tfClient as any).lookupTransform(this.fixedFrame, this.messageFrameId);
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
      } else {
        console.warn('[PointCloud2] Message has no frame_id in header');
      }
      
      // Log message structure for debugging
      console.log('[PointCloud2] Message structure:', {
        height: message.height,
        width: message.width,
        point_step: message.point_step,
        row_step: message.row_step,
        dataType: message.data ? typeof message.data : 'undefined',
        dataLength: message.data ? message.data.length || message.data.byteLength : 0,
        fields: message.fields,
        is_bigendian: message.is_bigendian
      });
      
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
      
      console.log(`[PointCloud2] Visualizing ${pointCount} points from ${width}x${height} point cloud`);
      
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
      
      // Extract actual point cloud data
      for (let i = 0; i < pointCount; i++) {
        try {
          const offset = i * pointStep;
          
          // Extract x, y, z as 32-bit floats (standard for ROS point clouds)
          let x = dataView.getFloat32(offset + fieldOffsets.x, true); // little-endian
          let y = dataView.getFloat32(offset + fieldOffsets.y, true);
          let z = dataView.getFloat32(offset + fieldOffsets.z, true);
          
          // Apply scaling and origin offset
          x = x * this.scaleX + this.originX;
          y = y * this.scaleY + this.originY;
          z = z * this.scaleZ + this.originZ;
          
          // For Z-up coordinate system, we keep the coordinates as is
          // No need to swap Y and Z - in Z-up system, we keep ROS coordinates directly
          positions.setXYZ(i, x, y, z);
        } catch (e) {
          console.error(`[PointCloud2] Error processing point ${i}:`, e);
          // Skip this point and continue with the rest
        }
      }
      
      // Update the geometry
      positions.needsUpdate = true;
      
      // Set the draw range to only render valid points
      this.points.geometry?.setDrawRange(0, pointCount);
      
      console.log('[PointCloud2] Point cloud visualization updated');
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
      // Look up transformation from the message frame to the fixed frame
      let tf;
      try {
        tf = (this.tfClient as any).lookupTransform(fixedFrame, this.messageFrameId);
      } catch (error) {
        // If we get a "not a function" error, try a more direct approach
        if (error instanceof TypeError && error.message.includes('is not a function')) {
          console.warn(`[PointCloud2] Force transform lookup method failed, trying fallback with direct access`);
          
          // Try to access the transforms directly if possible
          const provider = this.tfClient;
          if (provider && (provider as any).transforms) {
            try {
              // Use the lookupTransform function from tfUtils if available
              if (typeof (provider as any).lookupTransform === 'function') {
                tf = (provider as any).lookupTransform(fixedFrame, this.messageFrameId);
              }
            } catch (fallbackError) {
              throw error; // Rethrow the original error if fallback fails
            }
          } else {
            throw error; // Rethrow if we can't access the transforms
          }
        } else {
          throw error; // Rethrow other errors
        }
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
    // First try to get it from the tfClient
    if (this.tfClient && typeof this.tfClient.getFixedFrame === 'function') {
      return this.tfClient.getFixedFrame();
    }
    // Otherwise use our stored value
    return this.fixedFrame;
  }
}

// Improved OrbitControls implementation
export class OrbitControls {
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
  private touches = { ONE: 0, TWO: 1 };
  private prevTouchDistance = -1;
  
  private EPS = 0.000001;
  
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
    
    console.log('[OrbitControls] Initialized with touch support');
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
        this.state = this.STATE.DOLLY;
        break;
      case this.mouseButtons.RIGHT:
        this.state = this.STATE.PAN;
        this.panStart.set(event.clientX, event.clientY);
        break;
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
        
        this.pan(this.panDelta.x, this.panDelta.y);
        
        this.panStart.copy(this.panEnd);
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
    
    if (event.deltaY < 0) {
      this.dollyIn();
    } else {
      this.dollyOut();
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
        
      case 2: // Two touches - handle as pinch zoom or pan
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        this.prevTouchDistance = Math.sqrt(dx * dx + dy * dy);
        
        // Use the midpoint as the pan starting point
        const x = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        const y = (event.touches[0].clientY + event.touches[1].clientY) / 2;
        this.panStart.set(x, y);
        this.state = this.STATE.PAN;
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
        }
        break;
        
      case 2: // Two touches - handle as pinch zoom and pan
        // Calculate current distance between touch points
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        const touchDistance = Math.sqrt(dx * dx + dy * dy);
        
        // If we have a previous distance, use it for pinch zoom
        if (this.prevTouchDistance > 0 && touchDistance > 0) {
          // If new distance is greater, zoom in, otherwise zoom out
          if (touchDistance > this.prevTouchDistance) {
            this.dollyIn();
          } else {
            this.dollyOut();
          }
          this.prevTouchDistance = touchDistance;
        }
        
        // Use the midpoint for panning
        const x = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        const y = (event.touches[0].clientY + event.touches[1].clientY) / 2;
        this.panEnd.set(x, y);
        this.panDelta.subVectors(this.panEnd, this.panStart);
        
        this.pan(this.panDelta.x, this.panDelta.y);
        
        this.panStart.copy(this.panEnd);
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

// Export as default and named exports to match the original module
const ROS3D = {
  Viewer,
  Grid,
  Axes,
  TfClient,
  PointCloud2,
  OrbitControls,
};

export default ROS3D; 