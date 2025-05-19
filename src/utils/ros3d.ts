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
    
    // Set camera up vector to Z-up (using type assertion as any to bypass TypeScript limitation)
    (this.camera as any).up = new THREE.Vector3(0, 0, 1);

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
    const colorCenterLine = options.colorCenterLine || 0x444444;
    const colorGrid = options.colorGrid || 0x888888;
    
    const gridHelper = new THREE.GridHelper(size, divisions, colorCenterLine, colorGrid);
    
    // Rotate grid to be flat on XY plane with Z up
    gridHelper.rotation.x = Math.PI / 2;
    
    super.add(gridHelper);
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
    super.add(axesHelper);
    
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
  private tfClient: TfClient;
  private rootObject: THREE.Object3D;
  private maxPoints: number;
  private pointSize: number;
  private compression: string;
  private throttleRate: number;
  private topicSubscription: any;
  private scaleX: number = 1.0;
  private scaleY: number = 1.0;
  private scaleZ: number = 1.0;
  private originX: number = 0.0;
  private originY: number = 0.0;
  private originZ: number = 0.0;
  private messageFrameId: string = '';
  private fixedFrame: string = 'odom'; // Store fixed frame here
  
  // Add points object to store the actual visualization
  public points: {
    object: THREE.Points | null;
    material: THREE.Material | null;
    geometry: THREE.BufferGeometry | null;
    setup: boolean;
  };
  
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
    this.points = {
      object: null,
      material: null,
      geometry: null,
      setup: false
    };
    
    // Initialize and set up point cloud
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
    
    // Function to safely get the fixed frame
    const getFixedFrame = () => {
      // First try to get it from the tfClient
      if (this.tfClient && typeof this.tfClient.getFixedFrame === 'function') {
        return this.tfClient.getFixedFrame();
      }
      // Otherwise use our stored value
      return this.fixedFrame;
    };
    
    // Use requestAnimationFrame to update the transform periodically
    const updateTransform = () => {
      if (this.messageFrameId) {
        const fixedFrame = getFixedFrame();
        
        // Check if fixed frame has changed
        const frameChanged = currentFixedFrame !== fixedFrame;
        if (frameChanged) {
          currentFixedFrame = fixedFrame;
          this.fixedFrame = fixedFrame; // Update our stored value
          // Log the change for debugging
          console.log(`[PointCloud2] Fixed frame changed to: ${fixedFrame}`);
          (this as any).visible = false; // Hide until we get a new transform
        }
        
        try {
          // Look up transformation from the message frame to the fixed frame
          const tf = (this.tfClient as any).lookupTransform(fixedFrame, this.messageFrameId);
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
          } else {
            // If transformation not available, hide the point cloud
            (this as any).visible = false;
          }
        } catch (e) {
          console.warn(`[PointCloud2] Could not transform from ${this.messageFrameId} to ${fixedFrame}: ${e}`);
          (this as any).visible = false;
        }
      }
      
      // Continue the update loop
      requestAnimationFrame(updateTransform);
    };
    
    // Start the update loop
    requestAnimationFrame(updateTransform);
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
  }): void {
    // Update scale factors if provided
    if (options.scaleX !== undefined) this.scaleX = options.scaleX;
    if (options.scaleY !== undefined) this.scaleY = options.scaleY;
    if (options.scaleZ !== undefined) this.scaleZ = options.scaleZ;
    
    // Update origin offset if provided
    if (options.originX !== undefined) this.originX = options.originX;
    if (options.originY !== undefined) this.originY = options.originY;
    if (options.originZ !== undefined) this.originZ = options.originZ;
    
    // Update point size if provided and points object exists
    if (options.pointSize !== undefined && this.points?.material) {
      this.pointSize = options.pointSize;
      
      // Update point size in material if it's a PointsMaterial
      if (this.points.material instanceof THREE.PointsMaterial) {
        this.points.material.size = this.pointSize;
        this.points.material.needsUpdate = true;
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
      pointSize: this.pointSize
    });
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
    
    // Add event listeners
    this.element.addEventListener('mousedown', this.onMouseDown, false);
    this.element.addEventListener('wheel', this.onMouseWheel, false);
    
    // Initial update
    this.update();
    
    console.log('[OrbitControls] Initialized');
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
        
        // Rotating across the whole screen goes 360 degrees around
        const element = this.element === document.body ? 
          document.body : this.element;
        
        // Calculate rotation angle
        this.sphericalDelta.theta -= 2 * Math.PI * this.rotateDelta.x / element.clientWidth * this.rotateSpeed;
        this.sphericalDelta.phi -= 2 * Math.PI * this.rotateDelta.y / element.clientHeight * this.rotateSpeed;
        
        this.rotateStart.copy(this.rotateEnd);
        break;
        
      case this.STATE.PAN:
        this.panEnd.set(event.clientX, event.clientY);
        this.panDelta.subVectors(this.panEnd, this.panStart);
        
        this.pan(this.panDelta.x, this.panDelta.y);
        
        this.panStart.copy(this.panEnd);
        break;
    }
    
    this.update();
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
  
  private pan(deltaX: number, deltaY: number): void {
    const element = this.element === document.body ? 
      document.body : this.element;
    
    // Adjust pan speed based on camera position
    const position = this.camera.position;
    const targetDistance = position.distanceTo(this.target);
    
    // Scale panning based on distance
    deltaX *= targetDistance * this.panSpeed / element.clientWidth;
    deltaY *= targetDistance * this.panSpeed / element.clientHeight;
    
    // Calculate pan offset
    const offset = new THREE.Vector3();
    
    // Pan in screen-space
    offset.copy(position).sub(this.target);
    
    // Get Z-up vector (changed from Y-up)
    const up = new THREE.Vector3(0, 0, 1);
    
    const pan = new THREE.Vector3();
    
    // Calculate right vector (cross product of camera direction and Z-up)
    const right = new THREE.Vector3().crossVectors(up, offset).normalize();
    
    // Pan right/left
    pan.copy(right).multiplyScalar(deltaX);
    
    // Pan up/down (use Z-up vector)
    pan.add(up.multiplyScalar(deltaY));
    
    // Apply pan to camera and target
    position.add(pan);
    this.target.add(pan);
  }
  
  private dollyIn(): void {
    this.scale /= 0.95;
  }
  
  private dollyOut(): void {
    this.scale *= 0.95;
  }
  
  public update(): void {
    const offset = new THREE.Vector3();
    
    // Get current camera position in spherical coordinates
    offset.copy(this.camera.position).sub(this.target);
    this.spherical.setFromVector3(offset);
    
    // Apply delta rotations
    this.spherical.theta += this.sphericalDelta.theta;
    this.spherical.phi += this.sphericalDelta.phi;
    
    // Restrict phi to be between EPS and PI - EPS
    this.spherical.phi = Math.max(this.EPS, Math.min(Math.PI - this.EPS, this.spherical.phi));
    
    // Apply scale (zooming)
    this.spherical.radius *= this.scale;
    
    // Restrict radius to be between desired limits
    this.spherical.radius = Math.max(0.1, Math.min(100, this.spherical.radius));
    
    // Move target by pan offset
    this.target.add(this.panOffset);
    
    // Convert back to cartesian coordinates
    offset.setFromSpherical(this.spherical);
    
    // Set camera position
    this.camera.position.copy(this.target).add(offset);
    
    // Look at target
    this.camera.lookAt(this.target);
    
    // Reset deltas
    this.sphericalDelta.set(0, 0, 0);
    this.panOffset.set(0, 0, 0);
    this.scale = 1;
  }
  
  public dispose(): void {
    this.element.removeEventListener('mousedown', this.onMouseDown, false);
    this.element.removeEventListener('wheel', this.onMouseWheel, false);
    document.removeEventListener('mousemove', this.onMouseMove, false);
    document.removeEventListener('mouseup', this.onMouseUp, false);
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