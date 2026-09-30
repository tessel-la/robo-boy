import * as THREE from 'three';
import { getPadSpatialControl, type PadSpatialControl } from '../../../features/customGamepad/spatialControl';
import { capturePanelSurface } from '../../../panels/capturePanelSurface';
import { getPadPresentation } from '../../../features/customGamepad/presentation';
import { PanelFrame } from '../../ui/PanelFrame';
import { SpatialMenu } from '../../ui/SpatialMenu';
import { XR_THEME } from '../../ui/canvasKit';
import type { XrInputTarget } from '../../XrInputManager';
import type { XrPanelRenderer } from '../registry';

/** Keep the configured layout and its mounted publishers; share balanced control handlers. */
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
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 840;
    const draw = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.86, frame.stageHeight),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, transparent: true })
    );
    screen.name = 'xr-pad-surface';
    screen.position.y = frame.stageHeight / 2;
    frame.viewRoot.add(screen);
    let root: HTMLElement | null = null,
      active = true,
      disposed = false,
      capturing = false;
    let ready = false,
      layoutId = '';
    let capturedWidth = 0,
      capturedHeight = 0;
    let lastCapture = -Infinity,
      generation = 0;
    const holds = new Map<string, { element: HTMLElement; control: PadSpatialControl }>();
    let messageText = '';
    let imageBounds = { x: 0, y: 0, width: 1, height: 1 };
    function message(text: string) {
      if (!draw || messageText === text) return;
      messageText = text;
      draw.clearRect(0, 0, canvas.width, canvas.height);
      draw.fillStyle = XR_THEME.textMuted;
      draw.font = `30px ${XR_THEME.font}`;
      draw.fillText(text, 48, canvas.height / 2, canvas.width - 96);
      texture.needsUpdate = true;
    }
    function release(pointer: string) {
      const held = holds.get(pointer);
      if (!held) return;
      holds.delete(pointer);
      held.control.end?.();
    }
    function releaseAll() {
      for (const pointer of holds.keys()) release(pointer);
    }
    const menu = new SpatialMenu({ onClose: toolbar });
    frame.attachMenu(menu);
    function toolbar() {
      frame.setToolbar([
        {
          id: 'pad-layouts',
          icon: 'layers',
          label: 'Layouts',
          active: menu.isOpen,
          onPress: () => {
            if (menu.isOpen) menu.close();
            else
              menu.open(() => {
                const state = getPadPresentation(ctx.panelId, ctx.storageScope);
                return {
                  title: 'Pad layouts',
                  rows: (state?.layouts ?? []).map(layout => ({
                    kind: 'button' as const,
                    label: layout.name,
                    trailing: layout.id === state?.layoutId ? ('check' as const) : undefined,
                    onPress: () => {
                      releaseAll();
                      state?.selectLayout(layout.id);
                      menu.refresh();
                    },
                  })),
                };
              });
            toolbar();
          },
        },
        { id: 'pad-stop', icon: 'pause', label: 'Release', onPress: releaseAll },
      ]);
    }
    function point(target: XrInputTarget) {
      if (!active || !ready || target.object !== screen || !target.uv || !root?.isConnected) return null;
      const x = (target.uv.x - imageBounds.x) / imageBounds.width;
      const y = (1 - target.uv.y - imageBounds.y) / imageBounds.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return null;
      const rect = root.getBoundingClientRect();
      if (rect.width !== capturedWidth || rect.height !== capturedHeight) return null;
      return { x: rect.left + x * rect.width, y: rect.top + y * rect.height };
    }
    function resolve(target: XrInputTarget): HTMLElement | null {
      const p = point(target);
      if (!p || !root) return null;
      let el = root.ownerDocument.elementsFromPoint(p.x, p.y).find(element => root!.contains(element)) ?? null;
      if (!el || !root.contains(el) || el.closest(':disabled, [aria-disabled="true"], [inert]')) return null;
      for (; el && root.contains(el); el = el.parentElement) {
        if (el instanceof HTMLElement && getPadSpatialControl(el)) return el;
        // Numeric setpoints use their existing step/send buttons. No synthetic text entry.
        if (el instanceof HTMLButtonElement && el.closest('.pad-setpoint')) return el;
      }
      return null;
    }
    function local(el: HTMLElement, target: XrInputTarget) {
      const p = point(target),
        rect = el.getBoundingClientRect();
      return p && rect.width > 0 && rect.height > 0
        ? {
            x: THREE.MathUtils.clamp((p.x - rect.left) / rect.width, 0, 1),
            y: THREE.MathUtils.clamp((p.y - rect.top) / rect.height, 0, 1),
          }
        : null;
    }
    message('Waiting for Pad layout…');
    toolbar();
    return {
      object: frame.object,
      getActivationTarget: resolve,
      allowsPressDrag: target => {
        const el = resolve(target);
        return Boolean(el && getPadSpatialControl(el)?.drag);
      },
      onActivate(target) {
        const el = resolve(target);
        if (!el) return;
        const control = getPadSpatialControl(el);
        if (control) control.activate?.();
        else el.click();
      },
      onPressStart(pointer, target) {
        release(pointer);
        const el = resolve(target),
          p = el && local(el, target);
        const control = el && getPadSpatialControl(el);
        // A control belongs to one XR pointer at a time; the other hand cannot release it.
        if (!el || !p || !control || [...holds.values()].some(held => held.element === el)) return;
        holds.set(pointer, { element: el, control });
        control.start?.(p.x, p.y);
      },
      onPressMove(pointer, target) {
        const held = holds.get(pointer);
        if (!held) return;
        const p = local(held.element, target);
        if (!p || resolve(target) !== held.element || getPadSpatialControl(held.element) !== held.control) {
          release(pointer);
          return;
        }
        held.control.move?.(p.x, p.y);
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
        const next = ctx.domElement?.querySelector<HTMLElement>('.custom-gamepad-layout') ?? null;
        const nextLayoutId = getPadPresentation(ctx.panelId, ctx.storageScope)?.layoutId ?? '';
        if (next !== root || nextLayoutId !== layoutId) {
          releaseAll();
          root = next;
          layoutId = nextLayoutId;
          ready = false;
          message('Loading Pad layout…');
          generation++;
          lastCapture = -Infinity;
          if (menu.isOpen) menu.refresh();
        }
        for (const [pointer, held] of holds) {
          if (!held.element.isConnected || getPadSpatialControl(held.element) !== held.control) release(pointer);
        }
        if (!root || !root.isConnected) {
          message('Choose a Pad layout in the workspace.');
          return;
        }
        if (capturing || time - lastCapture < 200) return;
        const rect = root.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        capturing = true;
        lastCapture = time;
        const version = generation;
        void capturePanelSurface(root, rect.width, rect.height)
          .then(image => {
            if (disposed || !active || version !== generation || !draw) return;
            const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
            const width = image.width * scale,
              height = image.height * scale;
            const x = (canvas.width - width) / 2,
              y = (canvas.height - height) / 2;
            // A cross-origin image must never taint the WebGL texture.
            image.getContext('2d')?.getImageData(0, 0, 1, 1);
            draw.clearRect(0, 0, canvas.width, canvas.height);
            draw.drawImage(image, x, y, width, height);
            messageText = '';
            imageBounds = {
              x: x / canvas.width,
              y: y / canvas.height,
              width: width / canvas.width,
              height: height / canvas.height,
            };
            capturedWidth = rect.width;
            capturedHeight = rect.height;
            ready = true;
            texture.needsUpdate = true;
          })
          .catch(() => {
            if (!disposed && version === generation) { ready = false; releaseAll(); message('This Pad content could not be drawn in XR.'); }
          })
          .finally(() => {
            capturing = false;
          });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        generation++;
        releaseAll();
        screen.geometry.dispose();
        (screen.material as THREE.Material).dispose();
        texture.dispose();
        frame.dispose();
      },
    };
  },
};
