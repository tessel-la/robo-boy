import * as THREE from 'three';
import * as ROS3D from '../../../utils/ros3d';
import {
  getSelectedTfFrameEdges,
  type StoredTransform,
  type TfFrameEdge,
  type TransformStore,
} from '../../../utils/tfUtils';
import type { TfDisplaySettings } from '../../../utils/visualizationState';
import { disposeObject, type XrDisplay, type XrDisplayEnv } from './types';

const EDGE_COLOR = 0x9aa7b3;
const UPDATE_INTERVAL_MS = 33;

export interface TfDisplayConfig extends TfDisplaySettings {
  frames: string[];
}

interface FrameEntry {
  group: THREE.Group;
}

interface EdgeEntry {
  edge: TfFrameEdge;
  line: THREE.Line;
  positions: Float32Array;
}

const createLabel = (
  text: string,
  axesScale: number,
  labelScale: number,
  opacity: number,
  withBackground: boolean
): THREE.Sprite | null => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;

  const fontSize = 28;
  const padX = 14;
  const padY = 8;
  context.font = `600 ${fontSize}px sans-serif`;
  const width = Math.ceil(context.measureText(text).width) + padX * 2;
  const height = fontSize + padY * 2;
  canvas.width = width;
  canvas.height = height;
  context.font = `600 ${fontSize}px sans-serif`;
  context.textBaseline = 'middle';

  if (withBackground) {
    context.fillStyle = 'rgba(16, 18, 20, 0.82)';
    context.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(0.5, 0.5, width - 1, height - 1, 6);
    context.fill();
    context.stroke();
  } else {
    context.strokeStyle = 'rgba(16, 18, 20, 0.9)';
    context.lineWidth = 4;
    context.lineJoin = 'round';
    context.strokeText(text, padX, height / 2);
  }
  context.fillStyle = '#f6f8fb';
  context.fillText(text, padX, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, opacity, depthTest: false, depthWrite: false })
  );
  const labelHeight = Math.max(labelScale, 0.01);
  sprite.scale.set(labelHeight * (width / height), labelHeight, 1);
  sprite.position.set(axesScale * 0.6, axesScale * 0.6, axesScale * 0.25);
  sprite.renderOrder = 10;
  return sprite;
};

/**
 * TF frame axes, labels and parent-child links, ported from `useTfVisualizer`. The set of objects is
 * rebuilt when the frames or styling change; poses are refreshed at most ~30 times a second, since a
 * headset frame loop runs faster than TF arrives and most frames would find nothing new.
 */
export class TfDisplay implements XrDisplay {
  private readonly container = new THREE.Group();
  private readonly frames = new Map<string, FrameEntry>();
  private readonly edges = new Map<string, EdgeEntry>();
  private config: TfDisplayConfig | null = null;
  private transforms: TransformStore = {};
  private lastUpdate = 0;
  private dirty = true;

  constructor(private readonly env: XrDisplayEnv) {
    env.root.add(this.container);
  }

  configure(config: TfDisplayConfig, transforms: TransformStore): void {
    const restyled = !this.config || JSON.stringify(this.config) !== JSON.stringify(config);
    this.config = config;
    this.transforms = transforms;
    if (restyled) this.rebuild(config);
    else this.syncEdges(config);
    this.dirty = true;
  }

  setTransforms(transforms: TransformStore): void {
    this.transforms = transforms;
    this.dirty = true;
  }

  private rebuild(config: TfDisplayConfig): void {
    this.clear();
    for (const name of new Set(config.frames)) {
      const group = new THREE.Group();
      group.visible = false;
      if (config.showTfAxes) {
        const axes = new ROS3D.Axes({ lineSize: config.tfAxesScale });
        const materials = axes.lineSegments?.material;
        for (const material of Array.isArray(materials) ? materials : materials ? [materials] : []) {
          material.transparent = config.tfAxesOpacity < 1;
          material.opacity = config.tfAxesOpacity;
        }
        group.add(axes);
      }
      if (config.showTfFrameLabels) {
        const label = createLabel(name, config.tfAxesScale, config.tfLabelScale, config.tfLabelOpacity, config.showTfLabelBackground);
        if (label) group.add(label);
      }
      this.container.add(group);
      this.frames.set(name, { group });
    }
    this.syncEdges(config);
  }

  private syncEdges(config: TfDisplayConfig): void {
    const wanted = config.showTfConnections ? getSelectedTfFrameEdges(this.transforms, config.frames) : [];
    const keys = new Set(wanted.map(edge => `${edge.parentFrame}->${edge.childFrame}`));
    for (const [key, entry] of this.edges) {
      if (keys.has(key)) continue;
      this.container.remove(entry.line);
      disposeObject(entry.line);
      this.edges.delete(key);
    }
    for (const edge of wanted) {
      const key = `${edge.parentFrame}->${edge.childFrame}`;
      if (this.edges.has(key)) continue;
      const positions = new Float32Array(6);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.62, depthTest: false })
      );
      line.frustumCulled = false;
      line.renderOrder = 2;
      line.visible = false;
      this.container.add(line);
      this.edges.set(key, { edge, line, positions });
    }
  }

  update(nowMs: number): void {
    if (!this.dirty || nowMs - this.lastUpdate < UPDATE_INTERVAL_MS) return;
    this.lastUpdate = nowMs;
    this.dirty = false;

    const { provider } = this.env;
    const fixed = provider.fixedFrame;
    const cache = new Map<string, StoredTransform | null>();
    const lookup = (frame: string): StoredTransform | null => {
      if (!cache.has(frame)) cache.set(frame, provider.lookupTransform(fixed, frame));
      return cache.get(frame) ?? null;
    };

    for (const [name, entry] of this.frames) {
      const transform = lookup(name);
      entry.group.visible = Boolean(transform);
      if (!transform) continue;
      entry.group.position.copy(transform.translation);
      entry.group.quaternion.copy(transform.rotation);
    }

    for (const { edge, line, positions } of this.edges.values()) {
      const parent = lookup(edge.parentFrame);
      const child = lookup(edge.childFrame);
      line.visible = Boolean(parent && child);
      if (!parent || !child) continue;
      positions.set([parent.translation.x, parent.translation.y, parent.translation.z]);
      positions.set([child.translation.x, child.translation.y, child.translation.z], 3);
      (line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private clear(): void {
    for (const { group } of this.frames.values()) {
      this.container.remove(group);
      group.traverse(child => {
        const map = ((child as THREE.Sprite).material as THREE.SpriteMaterial | undefined)?.map;
        map?.dispose();
      });
      disposeObject(group);
    }
    this.frames.clear();
    for (const { line } of this.edges.values()) {
      this.container.remove(line);
      disposeObject(line);
    }
    this.edges.clear();
  }

  dispose(): void {
    this.clear();
    this.env.root.remove(this.container);
  }
}
