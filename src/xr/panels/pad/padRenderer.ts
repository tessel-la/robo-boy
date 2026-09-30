import * as THREE from 'three';
import { getPadSpatialControl, type PadSpatialControl } from '../../../features/customGamepad/spatialControl';
import { capturePanelSurface } from '../../../panels/capturePanelSurface';
import { getPadPresentation } from '../../../features/customGamepad/presentation';
import type { CustomGamepadLayout, PadComponentType } from '../../../features/customGamepad/types';
import { PanelFrame } from '../../ui/PanelFrame';
import { SpatialMenu } from '../../ui/SpatialMenu';
import { XR_THEME } from '../../ui/canvasKit';
import { subscribeXrTheme } from '../../ui/xrTheme';
import { applyXrPose, toXrPose } from '../../grabbable';
import type { XrGrabbableData } from '../../types';
import type { XrInputTarget } from '../../XrInputManager';
import type { XrPanelRenderer } from '../registry';
import { PadControl } from './PadControl';
import { XrPadEditor } from './XrPadEditor';
import {
  normalizePadPoses,
  padDimensions,
  padGridDestination,
  readPadPoses,
  snapPadPose,
  type PadPoses,
} from './padSpatialLayout';

const CONTROL_SELECTORS: Partial<Record<PadComponentType, string>> = {
  joystick: '.joystick-component',
  button: '.button-component',
  toggle: '.toggle-switch',
  slider: '.slider-component input',
};

/** XR owns meshes and draft placement; the mounted desktop controls still own every command. */
export const padPanelRenderer: XrPanelRenderer = {
  panelType: 'pad',
  create(ctx) {
    const frame = new PanelFrame({
      panelId: ctx.panelId,
      title: ctx.title,
      layout: 'surface',
      isPassthrough: ctx.isPassthrough,
      onClose: ctx.requestClose,
      onPlacementChange: ctx.savePlacement,
    });
    const menu = new SpatialMenu({ onClose: toolbar });
    frame.attachMenu(menu);
    const canvas = document.createElement('canvas');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const controls = new Map<string, PadControl>();
    let grid: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | undefined;
    let destinationStatus: 'success' | 'danger' = 'success';
    const destination = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: XR_THEME.success, transparent: true, opacity: 0.3, depthWrite: false })
    );
    const stopTheme = subscribeXrTheme(() => {
      grid?.material.color.set(XR_THEME.accent);
      destination.material.color.set(XR_THEME[destinationStatus]);
    });
    destination.name = 'xr-pad-grid-destination';
    destination.userData.xrPickable = false;
    destination.visible = false;
    frame.viewRoot.add(destination);
    const elements = new Map<string, HTMLElement>();
    const holds = new Map<
      string,
      { element: HTMLElement; control: PadSpatialControl; block: PadControl; part: string }
    >();
    let active = true,
      disposed = false,
      signature = '',
      capturing = false,
      generation = 0,
      lastCapture = -Infinity;
    let root: HTMLElement | null = null;
    let lastLayout: CustomGamepadLayout | undefined;
    let captureReady = false,
      capturedWidth = 0,
      capturedHeight = 0;
    const presentation = () => getPadPresentation(ctx.panelId, ctx.storageScope);
    const snapshot = (): PadPoses =>
      Object.fromEntries(
        [...controls].map(([id, block]) => [id, editor.editing ? editor.poses[id] : toXrPose(block.object)])
      );
    const editor = new XrPadEditor(menu, ctx.storageScope, presentation, snapshot, rebuild);

    function release(pointer: string) {
      const held = holds.get(pointer);
      if (!held) return;
      holds.delete(pointer);
      held.control.end?.();
      held.block.feedback(held.part, false);
    }
    function releaseAll() {
      for (const pointer of holds.keys()) release(pointer);
    }

    function toolbar() {
      const editing = editor.editing;
      frame.setToolbar(
        editing
          ? [
              {
                id: 'pad-editor',
                icon: 'gear',
                label: 'Designer',
                active: true,
                onPress: () => menu.open(() => editor.designerPage()),
              },
              { id: 'pad-save', icon: 'check', label: 'Save', onPress: () => editor.save() },
              { id: 'pad-cancel', icon: 'close', label: 'Cancel', onPress: () => editor.cancel() },
            ]
          : [
              {
                id: 'pad-layouts',
                icon: 'layers',
                label: 'Layouts',
                active: menu.isOpen,
                onPress: () => {
                  if (menu.isOpen) menu.close();
                  else
                    menu.open(() => ({
                      title: 'Pad layouts',
                      rows: (presentation()?.layouts ?? []).map(layout => ({
                        kind: 'button',
                        label: layout.name,
                        trailing: layout.id === presentation()?.layoutId ? 'check' : undefined,
                        onPress: () => {
                          releaseAll();
                          presentation()?.selectLayout(layout.id);
                          menu.refresh();
                        },
                      })),
                    }));
                  toolbar();
                },
              },
              {
                id: 'pad-editor',
                icon: 'gear',
                label: 'Edit',
                disabled: !presentation()?.layout,
                onPress: () => {
                  releaseAll();
                  editor.begin();
                },
              },
              {
                id: 'pad-new',
                icon: 'plus',
                label: 'New',
                disabled: !presentation()?.layout,
                onPress: () => {
                  releaseAll();
                  editor.begin(true);
                },
              },
              { id: 'pad-stop', icon: 'pause', label: 'Release', onPress: releaseAll },
            ]
      );
    }
    function rebuild() {
      releaseAll();
      generation++;
      captureReady = false;
      lastCapture = -Infinity;
      for (const block of controls.values()) block.dispose();
      controls.clear();
      grid?.removeFromParent();
      grid?.geometry.dispose();
      grid?.material.dispose();
      grid = undefined;
      destination.visible = false;
      const state = presentation(),
        layout = editor.layout ?? state?.layout;
      signature = JSON.stringify(state?.layout ?? null);
      lastLayout = state?.layout;
      if (layout) {
        const { cell, width, height } = padDimensions(layout);
        const points: number[] = [];
        for (let x = 0; x <= layout.gridSize.width; x++) {
          const px = -width / 2 + x * cell;
          points.push(px, 0.3 - height / 2, 0.008, px, 0.3 + height / 2, 0.008);
        }
        for (let y = 0; y <= layout.gridSize.height; y++) {
          const py = 0.3 + height / 2 - y * cell;
          points.push(-width / 2, py, 0.008, width / 2, py, 0.008);
        }
        grid = new THREE.LineSegments(
          new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)),
          new THREE.LineBasicMaterial({
            color: XR_THEME.accent,
            transparent: true,
            opacity: editor.editing ? 0.55 : 0.22,
          })
        );
        grid.name = 'xr-pad-grid';
        grid.userData.xrPickable = false;
        frame.viewRoot.add(grid);
        const poses = normalizePadPoses(
          layout,
          editor.editing ? editor.poses : readPadPoses(layout.id, ctx.storageScope)
        );
        if (editor.editing) editor.poses = poses;
        for (const config of layout.components) {
          const block = new PadControl(
            config,
            Math.max(0.025, config.position.width * cell - 0.008),
            Math.max(0.025, config.position.height * cell - 0.008),
            texture
          );
          if (editor.editing) block.setStatus('Configure');
          applyXrPose(block.object, poses[config.id]);
          if (editor.editing)
            block.object.userData = {
              componentId: config.id,
              xrGrabbable: true,
              placementId: ctx.panelId,
              allowScale: true,
              constrain: object => {
                if (disposed || !editor.editing || controls.get(config.id) !== block) return;
                const desired = padGridDestination(layout, config, toXrPose(object));
                object.scale.setScalar(desired.pose.scale);
                destination.position.set(desired.pose.position[0], desired.pose.position[1], 0.012);
                destination.scale.set(desired.rect.width * cell, desired.rect.height * cell, 1);
                destinationStatus = snapPadPose(layout, config, desired.pose, editor.poses) ? 'success' : 'danger';
                destination.material.color.set(XR_THEME[destinationStatus]);
                destination.visible = true;
              },
              onGrabEnd: object => {
                if (disposed || !editor.editing || controls.get(config.id) !== block) return;
                const snapped = snapPadPose(layout, config, toXrPose(object), editor.poses);
                applyXrPose(object, snapped ?? editor.poses[config.id]);
                if (snapped) editor.poses[config.id] = snapped;
                destination.visible = false;
              },
            } satisfies XrGrabbableData & { componentId: string };
          controls.set(config.id, block);
          frame.viewRoot.add(block.object);
        }
        frame.setTitle(layout.name, editor.editing ? 'DESIGNER · commands disabled' : 'SPATIAL PAD');
      } else frame.setTitle(ctx.title, 'Waiting for Pad layout');
      toolbar();
    }
    function element(block: PadControl) {
      // Compare ids directly rather than interpolate untrusted imported ids into a CSS selector.
      return elements.get(block.config.id) ?? null;
    }
    function refreshElements() {
      elements.clear();
      for (const el of root?.querySelectorAll<HTMLElement>('[data-component-id]') ?? []) {
        if (el.dataset.componentId) elements.set(el.dataset.componentId, el);
      }
    }
    function blockAt(target: XrInputTarget) {
      for (const block of controls.values()) if (block.part(target) !== null) return block;
      return null;
    }
    function resolve(target: XrInputTarget) {
      if (!active || disposed || editor.editing) return null;
      const block = blockAt(target);
      if (!block) return null;
      const el = element(block);
      if (!el?.isConnected) return null;
      const part = block.part(target)!;
      let node: HTMLElement | null;
      if (block.native) {
        const selector = CONTROL_SELECTORS[block.config.type];
        if (block.config.type === 'dpad') {
          const index = ['up', 'left', 'right', 'down'].indexOf(part);
          node = el.querySelectorAll<HTMLButtonElement>('.dpad-component button')[index] ?? null;
        } else node = selector ? el.querySelector<HTMLElement>(selector) : null;
      } else {
        if (
          !captureReady ||
          !root ||
          root.getBoundingClientRect().width !== capturedWidth ||
          root.getBoundingClientRect().height !== capturedHeight
        )
          return null;
        const p = block.point(target),
          rect = el.getBoundingClientRect();
        const hit = el.ownerDocument
          .elementsFromPoint(rect.left + p.x * rect.width, rect.top + p.y * rect.height)
          .find(candidate => el.contains(candidate));
        node = hit?.closest<HTMLButtonElement>('.pad-setpoint button') ?? null;
      }
      if (!node || !el.contains(node) || node.closest(':disabled, [aria-disabled="true"], [inert]')) return null;
      return { node, block, part, p: block.point(target) };
    }
    rebuild();
    return {
      object: frame.object,
      getActivationTarget(target) {
        if (editor.editing) return blockAt(target)?.object ?? null;
        return resolve(target)?.node ?? null;
      },
      allowsPressDrag: target => {
        const hit = resolve(target);
        return Boolean(hit && getPadSpatialControl(hit.node)?.drag);
      },
      onActivate(target) {
        if (editor.editing) {
          const block = blockAt(target);
          if (block) editor.select(block.config.id);
          return;
        }
        const hit = resolve(target);
        if (!hit) return;
        const control = getPadSpatialControl(hit.node);
        if (control) control.activate?.();
        else hit.node.click();
      },
      onPressStart(pointer, target) {
        release(pointer);
        const hit = resolve(target),
          control = hit && getPadSpatialControl(hit.node);
        if (!hit || !control || [...holds.values()].some(held => held.element === hit.node)) return;
        holds.set(pointer, { element: hit.node, control, block: hit.block, part: hit.part });
        control.start?.(hit.p.x, hit.p.y);
        hit.block.feedback(hit.part, true, hit.p.x, hit.p.y);
      },
      onPressMove(pointer, target) {
        const held = holds.get(pointer);
        if (!held) return;
        const hit = resolve(target);
        if (!hit || hit.node !== held.element || getPadSpatialControl(hit.node) !== held.control) {
          release(pointer);
          return;
        }
        held.control.move?.(hit.p.x, hit.p.y);
        held.block.feedback(held.part, true, hit.p.x, hit.p.y);
      },
      onPressEnd: release,
      setActive(value) {
        active = value;
        if (!value) {
          generation++;
          releaseAll();
        }
      },
      update({ time }) {
        if (disposed || !active) return;
        const nextRoot = ctx.domElement?.querySelector<HTMLElement>('.custom-gamepad-layout') ?? null;
        const nextLayout = presentation()?.layout;
        const nextSignature = nextLayout === lastLayout ? signature : JSON.stringify(nextLayout ?? null);
        lastLayout = nextLayout;
        if (root !== nextRoot) {
          releaseAll();
          root = nextRoot;
          refreshElements();
          generation++;
          captureReady = false;
          lastCapture = -Infinity;
        }
        if (nextSignature !== signature) {
          refreshElements();
          if (editor.editing) {
            signature = nextSignature;
            editor.sourceChanged();
          } else {
            rebuild();
            if (menu.isOpen) menu.refresh();
          }
        }
        for (const [pointer, held] of holds)
          if (!held.element.isConnected || getPadSpatialControl(held.element) !== held.control) release(pointer);
        for (const block of controls.values()) block.sync(element(block), editor.selected === block.config.id);
        const data = [...controls.values()].filter(block => !block.native);
        if (editor.editing || !data.length || !root?.isConnected || capturing || time - lastCapture < 200) return;
        const rect = root.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const crops = data.map(block => ({ block, rect: element(block)?.getBoundingClientRect() }));
        capturing = true;
        lastCapture = time;
        const version = generation;
        void capturePanelSurface(root, rect.width, rect.height)
          .then(image => {
            if (disposed || !active || version !== generation) return;
            image.getContext('2d')?.getImageData(0, 0, 1, 1);
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext('2d')?.drawImage(image, 0, 0);
            for (const { block, rect: crop } of crops)
              if (crop)
                block.setCrop(
                  (crop.left - rect.left) / rect.width,
                  (crop.top - rect.top) / rect.height,
                  crop.width / rect.width,
                  crop.height / rect.height
                );
            texture.needsUpdate = true;
            captureReady = true;
            capturedWidth = rect.width;
            capturedHeight = rect.height;
          })
          .catch(() => {
            if (!disposed && version === generation) {
              captureReady = false;
              releaseAll();
              for (const block of data) block.setStatus('Content unavailable');
            }
          })
          .finally(() => {
            capturing = false;
          });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        stopTheme();
        generation++;
        releaseAll();
        editor.dispose();
        for (const block of controls.values()) block.dispose();
        controls.clear();
        grid?.geometry.dispose();
        grid?.material.dispose();
        destination.geometry.dispose();
        destination.material.dispose();
        texture.dispose();
        frame.dispose();
      },
    };
  },
};
