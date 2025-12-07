// UrdfClient implementation - URDF robot model visualization
import * as THREE from 'three';
import { Ros } from 'roslib';
import * as ROSLIB from 'roslib';
import { CustomTFProvider, StoredTransform } from '../tfUtils';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

/**
 * UrdfClient for loading and visualizing URDF robot models.
 * Subscribes to robot_description topic and renders the robot with TF updates.
 */
export class UrdfClient extends THREE.Object3D {
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
            const _jointType = jointElement.getAttribute('type');
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
                        const xyz = originElement.getAttribute('xyz')?.split(' ').map(Number) || [0, 0, 0];
                        const rpy = originElement.getAttribute('rpy')?.split(' ').map(Number) || [0, 0, 0];
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
        this.linkNameMap.forEach((_linkObject, linkName) => {
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
                const scaleAttr = meshElement.getAttribute('scale')?.split(' ').map(Number) || [1, 1, 1];
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
            const xyz = originElement.getAttribute('xyz')?.split(' ').map(Number) || [0, 0, 0];
            const rpy = originElement.getAttribute('rpy')?.split(' ').map(Number) || [0, 0, 0];
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
            const resolved = filePath.replace(/package:\/\/([^\/]*)\//, (_match, packageName) => {
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
