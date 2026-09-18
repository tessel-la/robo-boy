import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Ros } from 'roslib';
import { useRuntimeConfig } from '../runtime/runtimeConfig';
import { XrSceneManager } from './XrSceneManager';
import { XrInputManager, type XrInputTarget } from './XrInputManager';
import { XrGrabController, applyXrPose, defaultPanelPose, toXrPose } from './grabbable';
import { RobotWorld } from './world/RobotWorld';
import {
  domSurfaceRenderer,
  findUnrasterizableReason,
} from './panels/domSurfaceRenderer';
import {
  resolveXrPanelRenderer,
  setFallbackXrPanelRenderer,
  type XrPanelInstance,
} from './panels/registry';
import {
  loadXrWorkspaceState,
  pruneXrWorkspaceState,
  saveXrWorkspaceState,
  withPanelPlacement,
  withWorldPose,
} from './xrWorkspaceStorage';
import { setXrPresenting } from './xrPresentationBus';
import { hasAnyXrSupport, useXrSupport } from './useXrSupport';
import { XR_WORLD_PLACEMENT_ID, type XrSessionMode, type XrWorkspaceState } from './types';
import { getSessionModeDescriptor } from './sessionModes';
import './XrWorkspace.css';

/** The panel shape this component needs. Structurally compatible with MainControlView's WorkspacePanel. */
export interface XrWorkspacePanel {
  id: string;
  type: string;
  title: string;
}

export interface XrWorkspaceProps {
  ros: Ros | null;
  isConnected: boolean;
  panels: readonly XrWorkspacePanel[];
  /** Per-connection storage scope, so an XR room belongs to one robot. */
  storageScope?: string;
  fixedFrame?: string;
}

// The generic renderer is installed once, at module load, so the registry never has to import it.
setFallbackXrPanelRenderer(domSurfaceRenderer);

/**
 * Find the live DOM for a panel so it can be mirrored onto a surface.
 *
 * Reads the `data-workspace-card-id` attribute the workspace already puts on every tile, which is
 * also how the behaviour-tree panel locates its own card. Nothing had to be added to the 2D
 * workspace for this.
 */
const findPanelElement = (panelId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    `[data-workspace-card-id="${CSS.escape(panelId)}"] .workspace-card-content`
  );

interface MountedPanel {
  panelId: string;
  instance: XrPanelInstance;
}

/**
 * The immersive workspace: entry affordance, session lifecycle, and the spatial scene.
 *
 * Mounted once per connection session next to the other top-level features, following the same
 * "single top-level mount" guidance the global assistant follows. It reads the workspace's panels
 * and the session's ROS connection and owns nothing the 2D interface depends on, so with no session
 * running it renders one button and costs nothing else.
 */
const XrWorkspace: React.FC<XrWorkspaceProps> = ({
  ros,
  isConnected,
  panels,
  storageScope,
  fixedFrame = 'odom',
}) => {
  const support = useXrSupport();
  const { meshResourcesBaseUrl } = useRuntimeConfig();

  const [mode, setMode] = useState<XrSessionMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<XrSceneManager | null>(null);
  const inputRef = useRef<XrInputManager | null>(null);
  const grabRef = useRef<XrGrabController | null>(null);
  const worldRef = useRef<RobotWorld | null>(null);
  const mountedPanelsRef = useRef<MountedPanel[]>([]);
  const stateRef = useRef<XrWorkspaceState | null>(null);
  const panelsRef = useRef(panels);
  panelsRef.current = panels;

  /** Preferred mode when a device offers both; VR is the control-room default. */
  const defaultMode: XrSessionMode = support.vr ? 'immersive-vr' : 'immersive-ar';
  const [selectedMode, setSelectedMode] = useState<XrSessionMode>(defaultMode);
  useEffect(() => {
    setSelectedMode(support.vr ? 'immersive-vr' : 'immersive-ar');
  }, [support.vr, support.ar]);

  const persist = useCallback(() => {
    const state = stateRef.current;
    if (!state) return;
    saveXrWorkspaceState(state, storageScope);
  }, [storageScope]);

  /** Record where something ended up, so the room is the same next time. */
  const capturePlacement = useCallback(
    (object: THREE.Object3D) => {
      const placementId = (object.userData as { placementId?: string }).placementId;
      const state = stateRef.current;
      if (!placementId || !state) return;

      if (placementId === XR_WORLD_PLACEMENT_ID) {
        stateRef.current = withWorldPose(state, toXrPose(object));
      } else {
        const existing = state.panels[placementId];
        stateRef.current = withPanelPlacement(state, placementId, {
          pose: toXrPose(object),
          pinned: existing?.pinned ?? false,
          attach: existing?.attach ?? 'world',
        });
      }
      persist();
    },
    [persist]
  );

  const teardown = useCallback(() => {
    for (const mounted of mountedPanelsRef.current) {
      try {
        mounted.instance.dispose();
      } catch {
        // A panel failing to clean up must not block the rest of the teardown.
      }
    }
    mountedPanelsRef.current = [];

    worldRef.current?.dispose();
    worldRef.current = null;
    grabRef.current?.releaseAll();
    grabRef.current = null;
    inputRef.current?.dispose();
    inputRef.current = null;
    sceneRef.current?.dispose();
    sceneRef.current = null;

    setXrPresenting(false);
    setMode(null);
  }, []);

  // Every exit path converges here. Unmount, a lost ROS connection and an ended session all have to
  // leave the same nothing behind: no session held open, no listeners, no orphaned WebGL context.
  useEffect(() => () => teardown(), [teardown]);
  useEffect(() => {
    if (!isConnected && sceneRef.current) {
      void sceneRef.current.end();
    }
  }, [isConnected]);

  const buildScene = useCallback(
    (scene: XrSceneManager, activeRos: Ros) => {
      const input = new XrInputManager({
        renderer: scene.renderer,
        scene: scene.scene,
        getInteractables: () => {
          const objects: THREE.Object3D[] = mountedPanelsRef.current.map(
            entry => entry.instance.object
          );
          if (worldRef.current) objects.push(worldRef.current.object);
          return objects;
        },
        onActivate: (_pointer, target) => {
          const owner = findPanelForObject(target.object);
          owner?.instance.onActivate?.(target);
        },
        onHoverChange: (_pointer, target) => {
          // Clear the previous hover before setting the new one, so two pointers cannot leave a
          // panel stuck highlighted.
          for (const entry of mountedPanelsRef.current) entry.instance.onHover?.(null);
          if (!target) return;
          const owner = findPanelForObject(target.object);
          owner?.instance.onHover?.(target);
        },
        onGrabStart: (pointer, target) => {
          const pose = pointerPose(input, pointer.id);
          if (!pose) return;
          const allowScale =
            (target.object.userData as { allowScale?: boolean }).allowScale !== false;
          grabRef.current?.begin(target.object, pose, allowScale);
        },
        onGrabEnd: () => {
          // Placements are captured on release rather than per frame: writing localStorage at
          // headset refresh rate would be absurd, and the value only matters once it settles.
          for (const entry of mountedPanelsRef.current) {
            if (grabRef.current?.isGrabbed(entry.instance.object)) {
              capturePlacement(entry.instance.object);
            }
          }
          if (worldRef.current && grabRef.current?.isGrabbed(worldRef.current.object)) {
            capturePlacement(worldRef.current.object);
          }
          grabRef.current?.releaseAll();
        },
      });
      inputRef.current = input;
      grabRef.current = new XrGrabController();

      const world = new RobotWorld({
        ros: activeRos,
        parent: scene.worldGroup,
        meshResourcesBaseUrl,
        fixedFrame,
      });
      worldRef.current = world;

      const storedWorld = stateRef.current?.world;
      if (storedWorld) applyXrPose(world.object, storedWorld);
      else {
        // A robot at true scale two metres away is the most useful first view: close enough to read
        // and far enough not to be standing inside.
        world.object.position.set(0, 0, -1.6);
        world.object.scale.setScalar(1);
      }

      mountPanels(scene);

      scene.addFrameListener((_time, delta) => {
        input.update();

        const poses = new Map<string, { id: string; matrixWorld: THREE.Matrix4; origin: THREE.Vector3 }>();
        for (const { pointer } of input.getGrabbingPointers()) {
          const pose = pointerPose(input, pointer.id);
          if (pose) poses.set(pointer.id, pose);
        }
        grabRef.current?.update(poses);

        const frameContext = {
          delta,
          time: _time,
          mode: scene.mode ?? 'immersive-vr',
          pointers: input.getPointers(),
          interaction: input.interactionMode,
        };
        for (const entry of mountedPanelsRef.current) entry.instance.update?.(frameContext);
      });
    },
    [capturePlacement, fixedFrame, meshResourcesBaseUrl]
  );

  const mountPanels = useCallback((scene: XrSceneManager) => {
    const livePanels = panelsRef.current;
    const total = livePanels.length;

    livePanels.forEach((panel, index) => {
      const renderer = resolveXrPanelRenderer(panel.type);
      if (!renderer) return;

      const domElement = findPanelElement(panel.id);
      const instance = renderer.create({
        panelId: panel.id,
        panelType: panel.type,
        title: panel.title,
        domElement,
        ros,
        isPassthrough: scene.isPassthrough,
      });

      const stored = stateRef.current?.panels[panel.id];
      applyXrPose(instance.object, stored?.pose ?? defaultPanelPose(index, total));

      scene.uiGroup.add(instance.object);
      mountedPanelsRef.current.push({ panelId: panel.id, instance });
    });
  }, [ros]);

  const findPanelForObject = (object: THREE.Object3D): MountedPanel | null => {
    let current: THREE.Object3D | null = object;
    while (current) {
      const match = mountedPanelsRef.current.find(entry => entry.instance.object === current);
      if (match) return match;
      current = current.parent;
    }
    return null;
  };

  const handleEnter = useCallback(async () => {
    if (sceneRef.current || isStarting) return;
    const activeRos = ros;
    const container = containerRef.current;
    if (!container) return;
    if (!activeRos || !isConnected) {
      setError('Connect to a robot before entering the XR workspace.');
      return;
    }

    setError(null);
    setIsStarting(true);

    const loaded = loadXrWorkspaceState(storageScope);
    stateRef.current = pruneXrWorkspaceState(
      loaded,
      panelsRef.current.map(panel => panel.id)
    );

    const scene = new XrSceneManager({
      container,
      onSessionStart: startedMode => {
        setMode(startedMode);
        setXrPresenting(true);
      },
      onSessionEnd: () => {
        // Persist before tearing down: the objects holding the placements are about to be disposed.
        for (const entry of mountedPanelsRef.current) capturePlacement(entry.instance.object);
        if (worldRef.current) capturePlacement(worldRef.current.object);
        teardown();
      },
      onError: frameError => {
        console.error('[xr] frame error', frameError);
      },
    });
    sceneRef.current = scene;

    try {
      await scene.start(selectedMode);
      buildScene(scene, activeRos);
    } catch (startError) {
      const message =
        startError instanceof Error ? startError.message : 'The XR session could not be started.';
      setError(message);
      teardown();
    } finally {
      setIsStarting(false);
    }
  }, [
    buildScene,
    capturePlacement,
    isConnected,
    isStarting,
    ros,
    selectedMode,
    storageScope,
    teardown,
  ]);

  const handleExit = useCallback(() => {
    void sceneRef.current?.end();
  }, []);

  const unrasterizableCount = useMemo(
    () =>
      panels.filter(panel => findUnrasterizableReason(findPanelElement(panel.id)) !== null).length,
    [panels]
  );

  if (support.isChecking || !hasAnyXrSupport(support)) {
    // Nothing is rendered at all where XR is unavailable — no disabled button, no explanation for a
    // capability the device was never going to have.
    return <div ref={containerRef} className="xr-canvas-host" aria-hidden="true" />;
  }

  const bothModes = support.vr && support.ar;

  return (
    <>
      <div ref={containerRef} className="xr-canvas-host" aria-hidden="true" />
      <div className="xr-entry" role="group" aria-label="Immersive workspace">
        {mode ? (
          <button type="button" className="xr-entry-button is-active" onClick={handleExit}>
            Exit {getSessionModeDescriptor(mode).label}
          </button>
        ) : (
          <>
            {bothModes && (
              <div className="xr-mode-toggle" role="radiogroup" aria-label="Immersive mode">
                {(['immersive-vr', 'immersive-ar'] as const).map(candidate => (
                  <button
                    key={candidate}
                    type="button"
                    role="radio"
                    aria-checked={selectedMode === candidate}
                    className={`xr-mode-option ${selectedMode === candidate ? 'is-selected' : ''}`}
                    onClick={() => setSelectedMode(candidate)}
                  >
                    {getSessionModeDescriptor(candidate).label}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="xr-entry-button"
              onClick={() => void handleEnter()}
              disabled={isStarting || !isConnected}
              title={
                isConnected
                  ? `Enter the immersive workspace in ${getSessionModeDescriptor(selectedMode).label}`
                  : 'Connect to a robot first'
              }
            >
              {isStarting ? 'Starting…' : `Enter XR Workspace`}
              {!bothModes && <span className="xr-entry-mode"> · {getSessionModeDescriptor(selectedMode).label}</span>}
            </button>
          </>
        )}
        {error && <p className="xr-entry-error">{error}</p>}
        {!mode && unrasterizableCount > 0 && (
          <p className="xr-entry-note">
            {unrasterizableCount} panel{unrasterizableCount === 1 ? '' : 's'} cannot be mirrored and
            will appear as placeholders.
          </p>
        )}
      </div>
    </>
  );
};

/** Read a pointer's current world pose for the grab maths. */
const pointerPose = (
  input: XrInputManager,
  pointerId: string
): { id: string; matrixWorld: THREE.Matrix4; origin: THREE.Vector3 } | null => {
  const origin = input.getPointerOrigin(pointerId);
  if (!origin) return null;
  const pointer = input.getPointers().find(entry => entry.id === pointerId);
  if (!pointer) return null;

  // Rebuild a world matrix from the ray, which is all the grab needs: position plus the orientation
  // implied by the pointing direction.
  const matrixWorld = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, -1),
    pointer.ray.direction.clone().normalize()
  );
  matrixWorld.compose(origin, quaternion, new THREE.Vector3(1, 1, 1));
  return { id: pointerId, matrixWorld, origin };
};

export default XrWorkspace;
