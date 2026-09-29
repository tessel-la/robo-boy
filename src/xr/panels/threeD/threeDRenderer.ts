import * as THREE from 'three';
import { getConnectionStorageKey } from '../../../runtime/connectionStorage';
import {
  getVisualizationStateForKey,
  saveVisualizationStateForKey,
  type VisualizationPanelState,
} from '../../../utils/visualizationState';
import { getPreferredUrdfTopic } from '../../../utils/urdfTopics';
import { getTopicsForVisualizationType } from '../../../utils/visualizationTopics';
import { applyXrPose, toXrPose } from '../../grabbable';
import type { XrGrabbableData } from '../../types';
import { PanelFrame } from '../../ui/PanelFrame';
import { SpatialMenu } from '../../ui/SpatialMenu';
import { DisplayHost } from '../../world/displays/DisplayHost';
import { VIEW_SCALE_LIMITS, computeMeshBounds, fitBoundsToStage } from '../../world/fit';
import type { XrPanelContext, XrPanelInstance, XrPanelRenderer } from '../registry';
import { LAYER_LABELS, Xr3dSettings } from './Xr3dSettings';

const STATE_KEY_PREFIX = 'roboboy_3d_visualization_state_';
/** How long after the first model appears the view keeps re-fitting while meshes stream in. */
const AUTO_FIT_WINDOW_MS = 6000;
const AUTO_FIT_INTERVAL_MS = 600;
const SETTINGS_APPLY_DELAY_MS = 250;
const ZOOM_STEP = 1.25;
const UP = new THREE.Vector3(0, 1, 0);

const hasStoredState = (key: string): boolean => {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
};

/**
 * The 3D panel as a small self-contained spatial world.
 *
 * Everything the panel shows lives under `view`, which lives on the frame's floor, so moving,
 * resizing or closing the panel carries the robot, the TF frames and every other layer with it.
 * `view` is itself grabbable and constrained to yaw, slide and scale on the floor: grabbing the
 * scene turns the world, grabbing the frame moves the panel.
 *
 * Layers and their settings are the same `VisualizationPanelState` the desktop panel saves under the
 * same key, so a layer set up on either side is there on the other the next time the panel mounts.
 */
class ThreeDPanel implements XrPanelInstance {
  readonly object: THREE.Object3D;

  private readonly ctx: XrPanelContext;
  private readonly frame: PanelFrame;
  private readonly menu: SpatialMenu;
  private readonly settings: Xr3dSettings;
  private readonly host: DisplayHost;
  private readonly view = new THREE.Group();
  private readonly rosFrame = new THREE.Group();
  private readonly proxyGeometry: THREE.CylinderGeometry;
  private readonly proxyMaterial: THREE.MeshBasicMaterial;
  private readonly storageKey: string;

  private state: VisualizationPanelState;
  private restY = 0;
  private autoFit: boolean;
  private autoFitStartedAt = 0;
  private lastFitAt = 0;
  private applyTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(ctx: XrPanelContext) {
    if (!ctx.ros) throw new Error('The 3D panel needs a ROS connection.');
    this.ctx = ctx;
    this.storageKey = getConnectionStorageKey(`${STATE_KEY_PREFIX}${ctx.panelId}`, ctx.storageScope);

    const fresh = !hasStoredState(this.storageKey);
    const saved = getVisualizationStateForKey(this.storageKey);
    this.state = {
      ...saved,
      visualizations: saved.visualizations.filter(layer => layer.type in LAYER_LABELS),
    };

    this.frame = new PanelFrame({
      panelId: ctx.panelId,
      title: ctx.title,
      isPassthrough: ctx.isPassthrough,
      onClose: () => ctx.requestClose(),
      onPlacementChange: () => {
        ctx.savePlacement();
        this.refreshToolbar();
      },
    });
    this.object = this.frame.object;

    // ROS is Z-up and WebXR is Y-up; the whole world turns once, here, rather than per display.
    this.rosFrame.rotation.x = -Math.PI / 2;
    this.rosFrame.userData.xrPickable = false;
    this.view.add(this.rosFrame);
    this.view.userData = {
      xrGrabbable: true,
      placementId: `${ctx.panelId}:view`,
      allowScale: true,
      constrain: () => this.constrainView(),
      onGrabEnd: () => this.commitView(),
    } satisfies XrGrabbableData;

    // The robot itself is not pickable (it can be tens of thousands of triangles), so an invisible
    // cylinder over the floor stands in for it and hands grabs on to `view`.
    this.proxyGeometry = new THREE.CylinderGeometry(
      this.frame.stageRadius,
      this.frame.stageRadius,
      this.frame.stageHeight * 0.75,
      32
    );
    this.proxyMaterial = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    const proxy = new THREE.Mesh(this.proxyGeometry, this.proxyMaterial);
    proxy.position.y = (this.frame.stageHeight * 0.75) / 2;
    proxy.userData.xrGrabTarget = this.view;
    this.frame.viewRoot.add(this.view, proxy);

    if (ctx.initialView) {
      applyXrPose(this.view, ctx.initialView);
      this.restY = this.view.position.y / Math.max(this.view.scale.x, 1e-6);
      this.autoFit = false;
    } else {
      this.autoFit = true;
    }

    this.menu = new SpatialMenu({ width: 0.5, pageSize: 6, onClose: () => this.refreshToolbar() });
    this.frame.attachMenu(this.menu);
    this.settings = new Xr3dSettings({
      menu: this.menu,
      ros: ctx.ros,
      getState: () => this.state,
      commit: next => this.commit(next),
      getFrameNames: () => this.host.frameNames,
      getFixedFrame: () => this.host.fixedFrame,
    });

    this.host = new DisplayHost({
      ros: ctx.ros,
      root: this.rosFrame,
      meshResourcesBaseUrl: ctx.meshResourcesBaseUrl,
      onTfChanged: () => this.handleTfChanged(),
    });
    this.host.setState(this.state);
    this.handleTfChanged();
    this.refreshToolbar();
    if (fresh && this.state.visualizations.length === 0) this.seedRobotModel(ctx);
  }

  update(frame: { time: number }): void {
    this.host.update(frame.time);
    if (this.autoFit && frame.time - this.lastFitAt >= AUTO_FIT_INTERVAL_MS) {
      this.lastFitAt = frame.time;
      if (this.fit()) {
        if (this.autoFitStartedAt === 0) this.autoFitStartedAt = frame.time;
        else if (frame.time - this.autoFitStartedAt > AUTO_FIT_WINDOW_MS) {
          this.autoFit = false;
          this.commitView();
        }
      }
    }
  }

  /** A fresh panel with nothing configured shows the robot, which is what nearly everyone wants first. */
  private seedRobotModel(ctx: XrPanelContext): void {
    ctx.ros?.getTopics(
      result => {
        if (this.disposed || this.state.visualizations.length > 0) return;
        const topics = result.topics.map((name, index) => ({ name, type: result.types[index] ?? '' }));
        const urdf = getPreferredUrdfTopic(getTopicsForVisualizationType('urdf', topics));
        if (!urdf) return;
        this.commit({
          ...this.state,
          visualizations: [
            {
              id: `urdf-${ctx.panelId}`,
              type: 'urdf',
              topic: urdf.name,
              options: { robotDescriptionTopic: urdf.name },
            },
          ],
        });
      },
      () => undefined
    );
  }

  private commit(next: VisualizationPanelState): void {
    this.state = next;
    saveVisualizationStateForKey(this.storageKey, next);
    // Rebuilding displays is heavy and stepper presses come in bursts, so the scene follows the
    // menu a beat later while the menu itself updates at once.
    if (this.applyTimer) clearTimeout(this.applyTimer);
    this.applyTimer = setTimeout(() => {
      this.applyTimer = null;
      if (!this.disposed) this.host.setState(this.state);
    }, SETTINGS_APPLY_DELAY_MS);
    if (this.menu.isOpen) this.menu.refresh();
  }

  private handleTfChanged(): void {
    if (this.disposed || !this.host) return;
    const fixed = this.host.fixedFrame;
    this.frame.setTitle(this.ctx.title, fixed ? `Fixed frame · ${fixed}` : 'Waiting for TF');
    if (this.menu?.isOpen) this.menu.refresh();
  }

  private refreshToolbar(): void {
    this.frame.setToolbar([
      {
        id: 'settings',
        icon: 'gear',
        label: 'Settings',
        active: this.menu.isOpen,
        onPress: () => {
          if (this.menu.isOpen) this.menu.close();
          else this.settings.open();
          this.refreshToolbar();
        },
      },
      { id: 'fit', icon: 'fit', label: 'Fit', onPress: () => this.userFit() },
      { id: 'reset', icon: 'reset', label: 'Reset', onPress: () => this.resetView() },
      {
        id: 'zoom-out',
        icon: 'minus',
        label: 'Zoom out',
        disabled: this.view.scale.x <= VIEW_SCALE_LIMITS.min + 1e-6,
        onPress: () => this.zoom(1 / ZOOM_STEP),
      },
      {
        id: 'zoom-in',
        icon: 'plus',
        label: 'Zoom in',
        disabled: this.view.scale.x >= VIEW_SCALE_LIMITS.max - 1e-6,
        onPress: () => this.zoom(ZOOM_STEP),
      },
    ]);
  }

  /** Keep the world yaw-only, standing on the floor and within reach of it. */
  private constrainView(): void {
    this.autoFit = false;
    const yaw = new THREE.Euler().setFromQuaternion(this.view.quaternion, 'YXZ').y;
    this.view.quaternion.setFromAxisAngle(UP, yaw);
    const { position, scale } = this.view;
    position.y = this.restY * scale.x;
    const limit = this.frame.stageRadius * 1.6;
    const distance = Math.hypot(position.x, position.z);
    if (distance > limit) {
      position.x *= limit / distance;
      position.z *= limit / distance;
    }
    this.refreshToolbar();
  }

  private commitView(): void {
    this.ctx.saveView(toXrPose(this.view));
  }

  /** Fit the world to the floor. Returns false, changing nothing meaningful, when there is nothing solid yet. */
  private fit(): boolean {
    this.view.position.set(0, 0, 0);
    this.view.quaternion.identity();
    this.view.scale.setScalar(1);
    this.view.updateWorldMatrix(true, false);
    const bounds = computeMeshBounds(this.rosFrame, this.view);
    if (!bounds) {
      this.restY = 0;
      return false;
    }
    const fit = fitBoundsToStage(bounds, {
      radius: this.frame.stageRadius,
      height: this.frame.stageHeight,
    });
    this.view.scale.setScalar(fit.scale);
    this.view.position.set(...fit.position);
    this.restY = fit.restY;
    this.view.updateWorldMatrix(true, false);
    return true;
  }

  private userFit(): void {
    this.autoFit = false;
    this.fit();
    this.commitView();
    this.refreshToolbar();
  }

  private resetView(): void {
    this.autoFit = false;
    this.view.position.set(0, 0, 0);
    this.view.quaternion.identity();
    this.view.scale.setScalar(1);
    this.restY = 0;
    this.view.updateWorldMatrix(true, false);
    this.commitView();
    this.refreshToolbar();
  }

  /** Scale the world about the middle of the floor, so it grows in place rather than sliding. */
  private zoom(factor: number): void {
    this.autoFit = false;
    const next = THREE.MathUtils.clamp(this.view.scale.x * factor, VIEW_SCALE_LIMITS.min, VIEW_SCALE_LIMITS.max);
    const ratio = next / this.view.scale.x;
    this.view.scale.setScalar(next);
    this.view.position.set(this.view.position.x * ratio, this.restY * next, this.view.position.z * ratio);
    this.view.updateWorldMatrix(true, false);
    this.commitView();
    this.refreshToolbar();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.applyTimer) clearTimeout(this.applyTimer);
    this.host.dispose();
    this.proxyGeometry.dispose();
    this.proxyMaterial.dispose();
    this.frame.dispose();
  }
}

export const threeDPanelRenderer: XrPanelRenderer = {
  panelType: '3d',
  create: ctx => new ThreeDPanel(ctx),
};
