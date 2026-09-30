import * as THREE from 'three';
import { getExternalPanelSurface, type ExternalPanelSurface } from '../../panels/externalPanelSurface';
import type { PanelSurfaceFrame, PanelSurfaceInput } from '../../panels/surfaceProtocol';
import { XR_THEME, getXrThemeRevision } from '../ui/xrTheme';
import { PanelFrame } from '../ui/PanelFrame';
import type { XrInputTarget } from '../XrInputManager';
import type { XrPanelContext, XrPanelInstance } from './registry';

/** The sandbox owns rendering and DOM events; XR owns only the image and controller lifecycle. */
export function createExternalSurface(ctx: XrPanelContext): XrPanelInstance {
  const frame = new PanelFrame({
    panelId: ctx.panelId,
    title: ctx.title,
    layout: 'surface',
    isPassthrough: ctx.isPassthrough,
    onClose: ctx.requestClose,
    onPlacementChange: ctx.savePlacement,
  });
  const canvas = document.createElement('canvas');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'external-panel-surface';
  mesh.position.y = frame.stageHeight / 2;
  mesh.visible = false;
  frame.viewRoot.add(mesh);
  let bridge: ExternalPanelSurface | null = null;
  let shown: PanelSurfaceFrame | null = null;
  let disposed = false;
  let active = true,
    lastCapture = -Infinity,
    failure = '';
  let failureTheme = -1;
  const held = new Map<string, { message: Extract<PanelSurfaceInput, { type: 'surface-input' }>; moved: number }>();
  const cancel = () => {
    for (const [pointerId, entry] of held) bridge?.input({ ...entry.message, pointerId, action: 'cancel' });
    held.clear();
  };
  const scroll = (delta: number) => {
    cancel();
    bridge?.input({ type: 'surface-scroll', delta });
    lastCapture = -Infinity;
  };
  frame.setToolbar([
    { id: 'scroll-up', icon: 'chevronUp', label: 'Scroll up', onPress: () => scroll(-1) },
    { id: 'scroll-down', icon: 'chevronDown', label: 'Scroll down', onPress: () => scroll(1) },
  ]);
  frame.setTitle(ctx.title, 'Loading panel…');
  function hit(target: XrInputTarget) {
    if (disposed || !active || bridge?.error || !shown?.image || target.object !== mesh || !target.uv) return null;
    const x = target.uv.x,
      y = 1 - target.uv.y;
    const control = [...shown.targets]
      .reverse()
      .find(t => x >= t.x && x <= t.x + t.width && y >= t.y && y <= t.y + t.height);
    return control ? { targetId: control.id, x, y } : null;
  }
  return {
    object: frame.object,
    setActive(value) {
      if (disposed) return;
      active = value;
      if (!value) cancel();
      bridge?.setPresented(value);
    },
    update({ time }) {
      if (disposed || !active) return;
      const next = getExternalPanelSurface(ctx.panelId, ctx.storageScope);
      if (next !== bridge) {
        cancel();
        bridge?.setPresented(false);
        bridge = next;
        shown = null;
        failure = '';
        frame.setTitle(ctx.title, 'Loading panel…');
        mesh.visible = false;
        bridge?.setPresented(true);
        lastCapture = -Infinity;
      }
      if (!bridge) return;
      if (time - lastCapture >= (bridge.error ? 2000 : 500)) {
        bridge.request(time);
        lastCapture = time;
      }
      if (bridge.error) {
        cancel();
        if (failure !== bridge.error || failureTheme !== getXrThemeRevision()) {
          failureTheme = getXrThemeRevision();
          failure = bridge.error;
          frame.setTitle(ctx.title, 'Preview unavailable');
          canvas.width = 720;
          canvas.height = 500;
          const draw = canvas.getContext('2d');
          if (draw) {
            draw.fillStyle = XR_THEME.surface;
            draw.fillRect(0, 0, 720, 500);
            draw.fillStyle = XR_THEME.textMuted;
            draw.font = `24px ${XR_THEME.font}`;
            let line = '',
              y = 180;
            for (const word of failure.slice(0, 220).split(' ')) {
              if (draw.measureText(line + word).width > 640) {
                draw.fillText(line, 40, y);
                y += 34;
                line = '';
              }
              line += word + ' ';
            }
            draw.fillText(line, 40, y);
          }
          texture.needsUpdate = true;
          mesh.scale.set(0.86, frame.stageHeight, 1);
          mesh.visible = true;
        }
        return;
      }
      if (!bridge.frame || shown === bridge.frame) return;
      failure = '';
      shown = bridge.frame;
      if (!shown.image) return;
      canvas.width = shown.image.width;
      canvas.height = shown.image.height;
      canvas.getContext('2d')?.drawImage(shown.image, 0, 0);
      texture.needsUpdate = true;
      const scale = Math.min(0.86 / canvas.width, frame.stageHeight / canvas.height);
      mesh.scale.set(canvas.width * scale, canvas.height * scale, 1);
      mesh.visible = true;
      frame.setTitle(ctx.title);
    },
    getActivationTarget(target) {
      return hit(target)?.targetId ?? null;
    },
    onPressStart(pointerId, target) {
      const control = hit(target);
      if (!control || !bridge) return;
      const message = { type: 'surface-input', action: 'down', pointerId, ...control } as const;
      held.set(pointerId, { message, moved: performance.now() });
      bridge.input(message);
    },
    onPressMove(pointerId, target) {
      const entry = held.get(pointerId),
        control = hit(target);
      if (!entry || !control || performance.now() - entry.moved < 100) return;
      entry.moved = performance.now();
      entry.message = { ...entry.message, ...control };
      bridge?.input({ ...entry.message, action: 'move' });
    },
    onPressEnd(pointerId, cancelled) {
      const entry = held.get(pointerId);
      if (!entry) return;
      bridge?.input({ ...entry.message, action: cancelled ? 'cancel' : 'up' });
      held.delete(pointerId);
      lastCapture = -Infinity;
    },
    onActivate(target) {
      const control = hit(target);
      if (control) bridge?.input({ type: 'surface-input', action: 'click', pointerId: 'activation', ...control });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      bridge?.setPresented(false);
      texture.dispose();
      geometry.dispose();
      material.dispose();
      frame.dispose();
    },
  };
}
