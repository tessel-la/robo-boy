import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Ros } from 'roslib';
import { useRuntimeConfig } from '../runtime/runtimeConfig';
import { XrSceneManager } from './XrSceneManager';
import { XrInputManager } from './XrInputManager';
import {
  XrGrabController,
  applyXrPose,
  defaultPanelPose,
  frontOfViewerPose,
  toXrPose,
} from './grabbable';
import { SurfaceInteraction } from './ui/SurfaceInteraction';
import { WristMenu, type WristMenuCatalogEntry } from './ui/WristMenu';
import { HintBoard } from './ui/HintBoard';
import { threeDPanelRenderer } from './panels/threeD/threeDRenderer';
import { timeSeriesPanelRenderer } from './panels/timeSeries/timeSeriesRenderer';
import { cameraPanelRenderer } from './panels/camera/cameraRenderer';
import { behaviorTreePanelRenderer } from './panels/behaviorTree/behaviorTreeRenderer';
import { recordReplayPanelRenderer } from './panels/recordReplay/recordReplayRenderer';
import { padPanelRenderer } from './panels/pad/padRenderer';
import { tfTreePanelRenderer } from './panels/tfTree/tfTreeRenderer';
import {
  domSurfaceRenderer,
  findUnrasterizableReason,
} from './panels/domSurfaceRenderer';
import {
  registerXrPanelRenderer,
  hasNativeXrPanelRenderer,
  resolveXrPanelRenderer,
  setFallbackXrPanelRenderer,
  type XrPanelContext,
  type XrPanelInstance,
} from './panels/registry';
import {
  loadXrWorkspaceState,
  pruneXrWorkspaceState,
  saveXrWorkspaceState,
  withPanelPlacement,
} from './xrWorkspaceStorage';
import { setXrPresenting } from './xrPresentationBus';
import { hasAnyXrSupport, useXrSupport } from './useXrSupport';
import type { XrGrabbableData, XrPose, XrSessionMode, XrWorkspaceState } from './types';
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
  /** Panel types the wrist menu offers. */
  panelCatalog?: readonly WristMenuCatalogEntry[];
  /** Add a panel to the workspace; it appears in `panels` on the next render. */
  onAddPanel?: (panelType: string) => void;
  /** Remove a panel from the workspace. */
  onRemovePanel?: (panelId: string) => void;
}

// The generic renderer is installed once, at module load, so the registry never has to import it.
setFallbackXrPanelRenderer(domSurfaceRenderer);
registerXrPanelRenderer(threeDPanelRenderer);
registerXrPanelRenderer(timeSeriesPanelRenderer);
registerXrPanelRenderer(tfTreePanelRenderer);
registerXrPanelRenderer(padPanelRenderer);
registerXrPanelRenderer(behaviorTreePanelRenderer);
registerXrPanelRenderer(recordReplayPanelRenderer);
registerXrPanelRenderer(cameraPanelRenderer);

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
  panelCatalog,
  onAddPanel,
  onRemovePanel,
}) => {
  const support = useXrSupport();
  const { meshResourcesBaseUrl } = useRuntimeConfig();

  const [mode, setMode] = useState<XrSessionMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const generationRef = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<XrSceneManager | null>(null);
  const inputRef = useRef<XrInputManager | null>(null);
  const grabRef = useRef<XrGrabController | null>(null);
  const interactionRef = useRef<SurfaceInteraction | null>(null);
  const wristMenuRef = useRef<WristMenu | null>(null);
  const hintRef = useRef<HintBoard | null>(null);
  const panelsReadyRef = useRef(false);
  const mountedPanelsRef = useRef<MountedPanel[]>([]);
  const stateRef = useRef<XrWorkspaceState | null>(null);
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const catalogRef = useRef(panelCatalog);
  catalogRef.current = panelCatalog;
  const onAddPanelRef = useRef(onAddPanel);
  onAddPanelRef.current = onAddPanel;
  const onRemovePanelRef = useRef(onRemovePanel);
  onRemovePanelRef.current = onRemovePanel;

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

      const existing = state.panels[placementId];
      stateRef.current = withPanelPlacement(state, placementId, {
        ...(existing ?? { pinned: false, attach: 'world' as const }),
        pose: toXrPose(object),
      });
      persist();
    },
    [persist]
  );

  /** Record the pose of a panel's inner world, kept beside the panel's own placement. */
  const captureView = useCallback(
    (panelId: string, view: XrPose) => {
      const state = stateRef.current;
      const existing = state?.panels[panelId];
      if (!state || !existing) return;
      stateRef.current = withPanelPlacement(state, panelId, { ...existing, view });
      persist();
    },
    [persist]
  );

  const teardown = useCallback(() => {
    generationRef.current += 1;
    setIsStarting(false);
    for (const mounted of mountedPanelsRef.current) {
      try {
        mounted.instance.dispose();
      } catch {
        // A panel failing to clean up must not block the rest of the teardown.
      }
    }
    mountedPanelsRef.current = [];
    panelsReadyRef.current = false;

    wristMenuRef.current?.dispose();
    wristMenuRef.current = null;
    hintRef.current?.dispose();
    hintRef.current = null;
    interactionRef.current?.dispose();
    interactionRef.current = null;
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
  useEffect(() => () => teardown(), [teardown, ros, storageScope]);
  useEffect(() => {
    if (!isConnected) teardown();
  }, [isConnected, teardown]);

  /** The camera whose pose is the user's head: the session's own while presenting. */
  const headCamera = (scene: XrSceneManager): THREE.Camera =>
    scene.renderer.xr.isPresenting ? scene.renderer.xr.getCamera() : scene.camera;

  /** Put something where the user is looking, in the space the panels live in. */
  const placeInFrontOfViewer = useCallback((scene: XrSceneManager, object: THREE.Object3D) => {
    const camera = headCamera(scene);
    const head = camera.getWorldPosition(new THREE.Vector3());
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const pose = frontOfViewerPose(head, forward);
    const local = scene.uiGroup.worldToLocal(new THREE.Vector3(...pose.position));
    applyXrPose(object, {
      ...pose,
      position: [local.x, local.y, local.z],
      scale: object.scale.x || 1,
    });
  }, []);

  const findPanelForObject = (object: THREE.Object3D): MountedPanel | null => {
    let current: THREE.Object3D | null = object;
    while (current) {
      const match = mountedPanelsRef.current.find(entry => entry.instance.object === current);
      if (match) return match;
      current = current.parent;
    }
    return null;
  };

  const refreshRoomChrome = useCallback(() => {
    hintRef.current?.setVisible(mountedPanelsRef.current.length === 0);
    wristMenuRef.current?.refresh();
  }, []);

  /**
   * Create one panel's spatial instance and put it in the room.
   *
   * A panel with a saved placement returns to it; one without lands on the default arc when the room
   * is first being filled (`arc`), or in front of the user when it is added while they are inside.
   */
  const mountPanel = useCallback(
    (scene: XrSceneManager, panel: XrWorkspacePanel, arc?: { index: number; total: number }) => {
      const renderer = resolveXrPanelRenderer(panel.type);
      if (!renderer) return;

      const stored = stateRef.current?.panels[panel.id];
      const objectOf = () =>
        mountedPanelsRef.current.find(entry => entry.panelId === panel.id)?.instance.object;
      const context: XrPanelContext = {
        panelId: panel.id,
        panelType: panel.type,
        title: panel.title,
        domElement: findPanelElement(panel.id),
        ros,
        isPassthrough: scene.isPassthrough,
        storageScope,
        meshResourcesBaseUrl,
        initialView: stored?.view,
        requestClose: () => onRemovePanelRef.current?.(panel.id),
        savePlacement: () => {
          const object = objectOf();
          if (object) capturePlacement(object);
        },
        saveView: view => captureView(panel.id, view),
      };

      let instance: XrPanelInstance;
      try {
        instance = renderer.create(context);
      } catch (nativeError) {
        // A native renderer that cannot start (no connection, a bad saved state) degrades to the
        // mirrored panel rather than leaving a hole in the room.
        console.warn(`[xr] ${panel.type} renderer failed, using the DOM surface`, nativeError);
        if (renderer === domSurfaceRenderer) return;
        try {
          instance = domSurfaceRenderer.create(context);
        } catch (fallbackError) {
          console.error('[xr] panel could not be created', fallbackError);
          return;
        }
      }

      if (stored) applyXrPose(instance.object, stored.pose);
      else if (arc) applyXrPose(instance.object, defaultPanelPose(arc.index, arc.total));
      else placeInFrontOfViewer(scene, instance.object);

      scene.uiGroup.add(instance.object);
      mountedPanelsRef.current.push({ panelId: panel.id, instance });
      // Recorded straight away so the panel has a placement for its inner state to hang off.
      if (!stored) capturePlacement(instance.object);
    },
    [captureView, capturePlacement, meshResourcesBaseUrl, placeInFrontOfViewer, ros, storageScope]
  );

  const unmountPanel = useCallback((entry: MountedPanel) => {
    try {
      entry.instance.dispose();
    } catch {
      // A panel failing to clean up must not keep it in the room.
    }
    entry.instance.object.removeFromParent();
  }, []);

  const mountPanels = useCallback(
    (scene: XrSceneManager) => {
      const livePanels = panelsRef.current;
      livePanels.forEach((panel, index) =>
        mountPanel(scene, panel, { index, total: livePanels.length })
      );
      panelsReadyRef.current = true;
      refreshRoomChrome();
    },
    [mountPanel, refreshRoomChrome]
  );

  // Panels added or removed while inside — from the wrist menu, a panel's own close button, or the
  // 2D workspace — are reconciled here rather than by rebuilding the room.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !panelsReadyRef.current) return;
    const wanted = new Set(panels.map(panel => panel.id));
    mountedPanelsRef.current = mountedPanelsRef.current.filter(entry => {
      if (wanted.has(entry.panelId)) return true;
      unmountPanel(entry);
      return false;
    });
    for (const panel of panels) {
      if (!mountedPanelsRef.current.some(entry => entry.panelId === panel.id)) mountPanel(scene, panel);
    }
    refreshRoomChrome();
  }, [panels, mountPanel, refreshRoomChrome, unmountPanel]);

  useEffect(() => {
    wristMenuRef.current?.refresh();
  }, [panelCatalog]);

  const buildScene = useCallback(
    (scene: XrSceneManager) => {
      const interaction = new SurfaceInteraction();
      interactionRef.current = interaction;

      const input = new XrInputManager({
        renderer: scene.renderer,
        scene: scene.scene,
        getInteractables: () => {
          const objects: THREE.Object3D[] = mountedPanelsRef.current.map(
            entry => entry.instance.object
          );
          if (wristMenuRef.current) objects.push(wristMenuRef.current.object);
          return objects;
        },
        getActivationTarget: target => {
          // A ray on a spatial surface activates a control, never the surface itself; on an empty
          // margin of a menu that is null, so pressing there does nothing.
          if (interaction.isSurface(target)) return interaction.getActivationTarget(target);
          const instance = findPanelForObject(target.object)?.instance;
          return instance?.getActivationTarget ? instance.getActivationTarget(target) : target.object;
        },
        onActivate: (_pointer, target) => {
          if (interaction.activate(target)) return;
          findPanelForObject(target.object)?.instance.onActivate?.(target);
        },
        allowsPressDrag: target => findPanelForObject(target.object)?.instance.allowsPressDrag?.(target) ?? false,
        onPressStart: (pointer, target) => findPanelForObject(target.object)?.instance.onPressStart?.(pointer.id, target),
        onPressMove: (pointer, target) => findPanelForObject(target.object)?.instance.onPressMove?.(pointer.id, target),
        onPressEnd: (pointer, cancelled) => {
          for (const entry of mountedPanelsRef.current) entry.instance.onPressEnd?.(pointer.id, cancelled);
        },
        onHoverChange: (pointer, target) => {
          interaction.hover(pointer.id, target);
          // Clear the previous hover before setting the new one, so two pointers cannot leave a
          // panel stuck highlighted.
          for (const entry of mountedPanelsRef.current) entry.instance.onHover?.(null);
          if (!target) return;
          findPanelForObject(target.object)?.instance.onHover?.(target);
        },
        onGrabStart: (pointer, target) => {
          const pose = pointerPose(input, pointer.id);
          if (!pose) return;
          const allowScale =
            (target.object.userData as { allowScale?: boolean }).allowScale !== false;
          grabRef.current?.begin(target.object, pose, allowScale);
        },
        onGrabEnd: (pointer, object) => {
          const own = (object.userData as Partial<XrGrabbableData>).onGrabEnd;
          if (own) own(object);
          else capturePlacement(object);
          const remaining = input.getGrabbingPointers().find(entry => entry.grabbed === object);
          grabRef.current?.release(
            object,
            pointer.id,
            remaining ? input.getPointerPose(remaining.pointer.id) ?? undefined : undefined
          );
        },
      });
      inputRef.current = input;
      grabRef.current = new XrGrabController();

      const wristMenu = new WristMenu({
        input,
        parent: scene.uiGroup,
        getCatalog: () => catalogRef.current ?? [],
        getPanels: () => panelsRef.current,
        onAdd: type => onAddPanelRef.current?.(type),
        onRemove: id => onRemovePanelRef.current?.(id),
        onSummon: id => {
          const object = mountedPanelsRef.current.find(entry => entry.panelId === id)?.instance.object;
          if (!object) return;
          placeInFrontOfViewer(scene, object);
          capturePlacement(object);
        },
      });
      wristMenuRef.current = wristMenu;

      const hint = new HintBoard('No panels open', 'Raise your left wrist and choose a panel to add.');
      hint.object.position.set(0, 1.3, -1.2);
      scene.uiGroup.add(hint.object);
      hintRef.current = hint;

      scene.addFrameListener((time, delta) => {
        input.update();

        const poses = new Map<string, { id: string; matrixWorld: THREE.Matrix4; origin: THREE.Vector3 }>();
        for (const { pointer } of input.getGrabbingPointers()) {
          const pose = pointerPose(input, pointer.id);
          if (pose) poses.set(pointer.id, pose);
        }
        grabRef.current?.update(poses);
        wristMenu.update(headCamera(scene), delta);

        const frameContext = {
          delta,
          time,
          mode: scene.mode ?? 'immersive-vr',
          pointers: input.getPointers(),
          interaction: input.interactionMode,
        };
        for (const entry of mountedPanelsRef.current) entry.instance.update?.(frameContext);
      });
    },
    [capturePlacement, placeInFrontOfViewer]
  );

  const handleEnter = useCallback(async () => {
    if (sceneRef.current || isStarting) return;
    const activeRos = ros;
    const container = containerRef.current;
    if (!container) return;
    if (!activeRos || !isConnected) {
      setError('Connect to a robot before entering the XR workspace.');
      return;
    }

    const generation = generationRef.current;
    setError(null);
    setIsStarting(true);

    const loaded = loadXrWorkspaceState(storageScope);
    stateRef.current = pruneXrWorkspaceState(
      loaded,
      panelsRef.current.map(panel => panel.id)
    );

    try {
    const scene = new XrSceneManager({
      container,
      onSessionStart: startedMode => {
        setMode(startedMode);
        setXrPresenting(true);
      },
      onSessionEnd: () => {
        // Persist before tearing down: the objects holding the placements are about to be disposed.
        for (const entry of mountedPanelsRef.current) capturePlacement(entry.instance.object);
        teardown();
      },
      onError: frameError => {
        console.error('[xr] frame error', frameError);
      },
    });
    sceneRef.current = scene;

      buildScene(scene);
      await scene.start(selectedMode);
      if (sceneRef.current !== scene) return;
      mountPanels(scene);
    } catch (startError) {
      if (generationRef.current !== generation) return;
      const message =
        startError instanceof Error ? startError.message : 'The XR session could not be started.';
      setError(message);
      teardown();
    } finally {
      if (generationRef.current === generation) setIsStarting(false);
    }
  }, [
    buildScene,
    capturePlacement,
    isConnected,
    isStarting,
    mountPanels,
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
      panels.filter(panel => !hasNativeXrPanelRenderer(panel.type) && findUnrasterizableReason(findPanelElement(panel.id)) !== null).length,
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
  return input.getPointerPose(pointerId);
};

export default XrWorkspace;
