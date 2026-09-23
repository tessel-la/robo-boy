import ROSLIB, { Ros, Topic } from 'roslib';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { CustomTFProvider } from './tfUtils';

type Marker = {
  ns: string; id: number; action: number; type: number;
  header: { frame_id: string }; frame_locked?: boolean;
  mesh_resource: string; mesh_use_embedded_materials?: boolean;
  pose: { position: { x: number; y: number; z: number }; orientation: { x: number; y: number; z: number; w: number } };
  scale: { x: number; y: number; z: number };
  color: { r: number; g: number; b: number; a: number };
  lifetime?: { sec?: number; nanosec?: number; secs?: number; nsecs?: number };
};
type Entry = { group: THREE.Group; frame: string; callback: (tf: any) => void; signature: string; timer?: ReturnType<typeof setTimeout> };

async function loadMesh(url: string): Promise<THREE.Object3D> {
  if (/\.obj(?:$|[?#])/i.test(url)) {
    const loader = new OBJLoader();
    if (/\/visual\//.test(url)) {
      const mtl = await new MTLLoader().loadAsync(url.replace(/\.obj(?=$|[?#])/i, '.mtl'));
      mtl.preload();
      loader.setMaterials(mtl);
    }
    return loader.loadAsync(url);
  }
  if (/\.dae(?:$|[?#])/i.test(url)) {
    const model = (await new ColladaLoader().loadAsync(url)).scene;
    model.rotateX(Math.PI / 2);
    return model;
  }
  if (/\.stl(?:$|[?#])/i.test(url))
    return new THREE.Mesh(await new STLLoader().loadAsync(url), new THREE.MeshLambertMaterial());
  throw new Error(`Unsupported marker mesh: ${url}`);
}

function materials(object: THREE.Object3D, visit: (material: THREE.Material) => void) {
  object.traverse(child => {
    if (child instanceof THREE.Mesh)
      (Array.isArray(child.material) ? child.material : [child.material]).forEach(visit);
  });
}

/** Inventory changes load geometry; existing TF callbacks move it without ROS polling. */
export class MarkerArrayClient {
  readonly entries = new Map<string, Entry>();
  private topic: Topic;
  private models = new Map<string, Promise<THREE.Object3D>>();
  private disposed = false;

  constructor(private options: {
    ros: Ros; topic: string; tfClient: CustomTFProvider; rootObject: THREE.Object3D;
    path: string; requestRender: () => void; loadMesh?: typeof loadMesh;
  }) {
    this.topic = new ROSLIB.Topic({ ros: options.ros, name: options.topic,
      messageType: 'visualization_msgs/MarkerArray', compression: 'cbor', throttle_rate: 0, queue_length: 0 });
    this.topic.subscribe(this.receive);
  }

  receive = (message: { markers?: Marker[] }) => {
    if (this.disposed) return;
    // Reconcile the whole message before touching the scene. DELETEALL + ADD
    // snapshots must not reload unchanged models or blink on inventory changes.
    const desired = new Map<string, Marker | null>([...this.entries.keys()].map(key => [key, null]));
    for (const marker of message.markers ?? []) {
      const key = `${marker.ns}/${marker.id}`;
      if (marker.action === 3) desired.clear();
      else if (marker.action === 2) desired.delete(key);
      else if (marker.action === 0) {
        if (marker.type === 10) desired.set(key, marker);
        else desired.delete(key);
      }
    }
    for (const key of this.entries.keys()) if (!desired.has(key)) this.remove(key);
    for (const [key, marker] of desired) {
      if (!marker) continue;
      // Header timestamps and lifetime refreshes do not change geometry or pose.
      const signature = JSON.stringify([marker.header.frame_id, marker.frame_locked, marker.mesh_resource,
        marker.mesh_use_embedded_materials, marker.pose, marker.scale, marker.color]);
      let entry = this.entries.get(key);
      if (entry?.signature !== signature) {
        this.remove(key);
        entry = this.add(key, marker, signature);
      }
      if (entry) {
        clearTimeout(entry.timer);
        const lifetime = marker.lifetime;
        const ms = ((lifetime?.sec ?? lifetime?.secs ?? 0) * 1000) + (lifetime?.nanosec ?? lifetime?.nsecs ?? 0) / 1e6;
        if (ms > 0) entry.timer = setTimeout(() => { this.remove(key); this.options.requestRender(); }, ms);
      }
    }
    this.options.requestRender();
  };

  private add(key: string, marker: Marker, signature: string): Entry {
    const group = new THREE.Group();
    group.name = key;
    group.visible = false; // Never draw at origin while waiting for object TF.
    const local = new THREE.Group();
    const p = marker.pose.position, q = marker.pose.orientation, scale = marker.scale;
    local.position.set(p.x, p.y, p.z);
    local.quaternion.set(q.x, q.y, q.z, q.w);
    local.scale.set(scale.x, scale.y, scale.z);
    group.add(local);
    this.options.rootObject.add(group);
    const entry: Entry = { group, frame: marker.header.frame_id, signature, callback: () => {} };
    entry.callback = tf => {
      group.visible = !!tf;
      if (tf) {
        group.position.copy(tf.translation);
        group.quaternion.copy(tf.rotation);
        if (!marker.frame_locked) this.options.tfClient.unsubscribe(entry.frame, entry.callback);
      }
      this.options.requestRender();
    };
    this.entries.set(key, entry);
    this.options.tfClient.subscribe(entry.frame, entry.callback);
    const url = marker.mesh_resource.startsWith('package://')
      ? `${this.options.path.replace(/\/$/, '')}/${marker.mesh_resource.slice('package://'.length)}`
      : marker.mesh_resource;
    if (!this.models.has(url)) this.models.set(url, (this.options.loadMesh ?? loadMesh)(url));
    this.models.get(url)!.then(template => {
      if (this.disposed || this.entries.get(key) !== entry) return;
      const model = template.clone(true);
      model.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const original = child.material;
        const converted = (Array.isArray(original) ? original : [original]).map(material => {
          if (marker.mesh_use_embedded_materials) return material.clone();
          return new THREE.MeshLambertMaterial({ color: new THREE.Color(marker.color.r, marker.color.g, marker.color.b),
            opacity: marker.color.a, transparent: marker.color.a < 1 });
        });
        child.material = Array.isArray(original) ? converted : converted[0];
      });
      local.add(model);
      this.options.requestRender();
    }).catch(error => {
      this.models.delete(url); // Allow a subsequent ADD to retry a failed load.
      if (this.entries.get(key) === entry) this.remove(key);
      console.error('[MarkerArrayClient] Mesh loading failed:', error);
    });
    return entry;
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.options.tfClient.unsubscribe(entry.frame, entry.callback);
    entry.group.removeFromParent();
    materials(entry.group, material => material.dispose());
    this.entries.delete(key);
  }

  dispose() {
    this.disposed = true;
    this.topic.unsubscribe();
    for (const key of this.entries.keys()) this.remove(key);
    for (const pending of this.models.values()) pending.then(model => {
      model.traverse(child => { if (child instanceof THREE.Mesh) child.geometry.dispose(); });
      const textures = new Set<THREE.Texture>();
      materials(model, material => {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        material.dispose();
      });
      textures.forEach(texture => texture.dispose());
    }).catch(() => {});
    this.models.clear();
    this.options.requestRender();
  }
}
