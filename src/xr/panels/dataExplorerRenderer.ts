import * as THREE from 'three';
import { capturePanelSurface } from '../../panels/capturePanelSurface';
import { getDataExplorerPresentation } from '../../features/dataExplorer/presentation';
import { PanelFrame } from '../ui/PanelFrame';
import { SpatialKeyboard } from '../ui/SpatialKeyboard';
import { SpatialMenu } from '../ui/SpatialMenu';
import { XR_THEME } from '../ui/canvasKit';
import type { XrInputTarget } from '../XrInputManager';
import type { XrPanelRenderer } from './registry';

const SELECTOR = 'button, input, select, textarea, a, summary, [role="button"], [tabindex], .react-flow__pane';
type PaintedTarget = { element: HTMLElement; left: number; top: number; right: number; bottom: number };
const enabled = (element: HTMLElement) => !element.closest(':disabled, [aria-disabled="true"], [inert]');

/** Clip hit regions to the same scroll panes as the image, including virtualized resource rows. */
function paintedTargets(root: HTMLElement, bounds: DOMRect): PaintedTarget[] {
  return [...root.querySelectorAll<HTMLElement>(SELECTOR)].slice(0, 512).flatMap(element => {
    if (!enabled(element)) return [];
    const rect = element.getBoundingClientRect();
    let left = Math.max(bounds.left, rect.left),
      top = Math.max(bounds.top, rect.top);
    let right = Math.min(bounds.right, rect.right),
      bottom = Math.min(bounds.bottom, rect.bottom);
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
      const style = getComputedStyle(parent),
        clip = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
    }
    return right > left && bottom > top
      ? [
          {
            element,
            left: left - bounds.left,
            top: top - bounds.top,
            right: right - bounds.left,
            bottom: bottom - bounds.top,
          },
        ]
      : [];
  });
}

/** A faithful view of the existing Explorer, with native XR text/select/scroll controls.
 * The desktop component retains all discovery, watch budgets, replay, rules and panel-opening logic.
 */
export const dataExplorerPanelRenderer: XrPanelRenderer = {
  panelType: 'dataExplorer',
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
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    );
    screen.name = 'xr-data-explorer-surface';
    screen.position.y = frame.stageHeight / 2;
    frame.viewRoot.add(screen);
    const keyboard = new SpatialKeyboard(() => invalidate());
    keyboard.surface.mesh.name = 'xr-data-explorer-keyboard';
    keyboard.surface.mesh.position.set(0, -0.26, 0.12);
    frame.viewRoot.add(keyboard.surface.mesh);
    const menu = new SpatialMenu();
    frame.attachMenu(menu);
    let root: HTMLElement | null = null;
    let presentation: ReturnType<typeof getDataExplorerPresentation> = null;
    let targets: PaintedTarget[] = [];
    let focus: HTMLElement | null = null;
    let active = true,
      disposed = false,
      capturing = false,
      ready = false,
      generation = 0,
      lastCapture = -Infinity;
    let width = 0,
      height = 0;
    let drag: { pointer: string; element: HTMLElement; x: number; y: number; moved: boolean } | null = null;
    let suppressClick = false;
    function invalidate() {
      ready = false;
      lastCapture = -Infinity;
    }
    function usable(element: HTMLElement) {
      return Boolean(
        active && ready && root?.isConnected && element.isConnected && root.contains(element) && enabled(element)
      );
    }
    function point(target: XrInputTarget) {
      if (target.object !== screen || !target.uv || !active || !ready) return null;
      return { x: target.uv.x * width, y: (1 - target.uv.y) * height };
    }
    function hit(target: XrInputTarget) {
      const p = point(target);
      if (!p) return null;
      const bounds = root!.getBoundingClientRect();
      if (bounds.width !== width || bounds.height !== height) return null;
      return (
        [...targets].reverse().find(t => {
          if (!(p.x >= t.left && p.x <= t.right && p.y >= t.top && p.y <= t.bottom && usable(t.element))) return false;
          const current = t.element.getBoundingClientRect();
          return (
            p.x >= current.left - bounds.left &&
            p.x <= current.right - bounds.left &&
            p.y >= current.top - bounds.top &&
            p.y <= current.bottom - bounds.top
          );
        })?.element ?? null
      );
    }
    function mouse(element: HTMLElement, type: string, x: number, y: number) {
      const bounds = root!.getBoundingClientRect();
      element.dispatchEvent(
        new MouseEvent(type, {
          view: window,
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === 'mouseup' ? 0 : 1,
          clientX: bounds.left + x,
          clientY: bounds.top + y,
        })
      );
    }
    function release(cancelled = true) {
      if (!drag) return;
      const entry = drag;
      drag = null;
      // d3's mouse drag listeners are on window; mouseup must reach them even after DOM replacement.
      if (root) mouse(entry.element.isConnected ? entry.element : document.body, 'mouseup', entry.x, entry.y);
      suppressClick = !cancelled && entry.moved;
      if (entry.moved) invalidate();
    }
    function scroll(delta: number) {
      if (!root) return;
      release();
      const scrollable = (element: HTMLElement) =>
        element.scrollHeight > element.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(element).overflowY);
      let pane = focus;
      while (pane && root.contains(pane) && !scrollable(pane)) pane = pane.parentElement;
      if (!pane || !root.contains(pane))
        pane = [root, ...root.querySelectorAll<HTMLElement>('*')].find(scrollable) ?? null;
      if (pane) {
        pane.scrollTop += delta * pane.clientHeight * 0.7;
        pane.dispatchEvent(new Event('scroll'));
        invalidate();
      }
    }
    function activate(element: HTMLElement) {
      if (!usable(element)) return;
      focus = element;
      if (element instanceof HTMLSelectElement) {
        menu.open(() => ({
          title:
            element.getAttribute('aria-label') ||
            element.closest('label')?.textContent?.trim().slice(0, 60) ||
            'Choose option',
          rows: [...element.options].map(option => ({
            kind: 'button' as const,
            label: option.text,
            disabled: option.disabled,
            trailing: option.selected ? ('check' as const) : undefined,
            onPress: () => {
              if (!element.isConnected || !root?.contains(element) || !enabled(element)) return;
              element.value = option.value;
              element.dispatchEvent(new Event('change', { bubbles: true }));
              menu.close();
              invalidate();
            },
          })),
        }));
      } else if (element.getAttribute('role') === 'separator') {
        const resize = (key: string) => {
          if (element.isConnected && root?.contains(element))
            element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: true, bubbles: true }));
          invalidate();
        };
        menu.open(() => ({
          title: element.getAttribute('aria-label') || 'Column width',
          rows: [
            { kind: 'button', label: 'Wider', onPress: () => resize('ArrowLeft') },
            { kind: 'button', label: 'Narrower', onPress: () => resize('ArrowRight') },
          ],
        }));
      } else if (
        (element instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(element.type)) ||
        element instanceof HTMLTextAreaElement
      ) {
        if (element.readOnly) return;
        keyboard.open(
          element.getAttribute('aria-label') ||
            element.closest('label')?.textContent?.trim().slice(0, 60) ||
            'Edit value',
          element.value,
          value => {
            if (!element.isConnected || !root?.contains(element) || !enabled(element))
              throw new Error('This field is no longer available.');
            const prototype =
              element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!;
            const previous = element.value;
            setter.call(element, value);
            if (!element.checkValidity()) {
              setter.call(element, previous);
              throw new Error(element.validationMessage);
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }
        );
      } else {
        element.click();
        invalidate();
      }
    }
    frame.setToolbar([
      { id: 'scroll-up', icon: 'chevronUp', label: 'Scroll up', onPress: () => scroll(-1) },
      { id: 'scroll-down', icon: 'chevronDown', label: 'Scroll down', onPress: () => scroll(1) },
      {
        id: 'refresh',
        icon: 'reset',
        label: 'Refresh',
        onPress: () => {
          root?.querySelector<HTMLButtonElement>('[aria-label="Refresh resources"]')?.click();
          invalidate();
        },
      },
    ]);
    function message(text: string) {
      canvas.width = 900;
      canvas.height = 650;
      const draw = canvas.getContext('2d');
      if (draw) {
        draw.fillStyle = XR_THEME.surface;
        draw.fillRect(0, 0, 900, 650);
        draw.fillStyle = XR_THEME.textMuted;
        draw.font = `26px ${XR_THEME.font}`;
        draw.fillText(text, 35, 320, 830);
      }
      screen.scale.set(0.86, frame.stageHeight, 1);
      texture.needsUpdate = true;
    }
    message('Loading Data Explorer…');
    return {
      object: frame.object,
      setActive(value) {
        active = value;
        presentation?.(value);
        if (!value) {
          release();
          keyboard.close();
          menu.close();
          generation++;
          ready = false;
        } else invalidate();
      },
      getActivationTarget(target) {
        return drag && point(target) ? drag.element : hit(target);
      },
      allowsPressDrag(target) {
        return Boolean(hit(target)?.closest('.react-flow__node, .react-flow__pane'));
      },
      onPressStart(pointer, target) {
        if (drag || keyboard.isOpen || menu.isOpen) return;
        suppressClick = false;
        const element = hit(target),
          p = point(target);
        if (!element || !p || !element.matches('.react-flow__node, .react-flow__pane')) return;
        focus = element;
        drag = { pointer, element, ...p, moved: false };
        mouse(element, 'mousedown', p.x, p.y);
      },
      onPressMove(pointer, target) {
        if (!drag || drag.pointer !== pointer) return;
        const p = point(target);
        if (!p) return;
        if (Math.hypot(p.x - drag.x, p.y - drag.y) < 2) return;
        drag.moved = true;
        drag.x = p.x;
        drag.y = p.y;
        mouse(drag.element, 'mousemove', p.x, p.y);
      },
      onPressEnd(pointer, cancelled) {
        if (drag?.pointer === pointer) release(cancelled);
      },
      onActivate(target) {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        if (drag || keyboard.isOpen || menu.isOpen) return;
        const element = hit(target);
        if (element) activate(element);
      },
      update({ time }) {
        if (disposed || !active) return;
        const next = getDataExplorerPresentation(ctx.panelId, ctx.storageScope);
        const nextRoot = ctx.domElement?.querySelector<HTMLElement>('.data-explorer-panel') ?? null;
        if (next !== presentation || nextRoot !== root) {
          release();
          presentation?.(false);
          presentation = next;
          root = nextRoot;
          generation++;
          targets = [];
          keyboard.close();
          menu.close();
          presentation?.(true);
          invalidate();
        }
        if (
          !presentation ||
          !root?.isConnected ||
          root.dataset.xrPresented !== 'true' ||
          capturing ||
          drag ||
          time - lastCapture < 250
        )
          return;
        const bounds = root.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const version = generation,
          source = root;
        const painted = paintedTargets(source, bounds);
        lastCapture = time;
        capturing = true;
        void capturePanelSurface(source, bounds.width, bounds.height)
          .then(image => {
            if (disposed || !active || version !== generation || root !== source) return;
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext('2d')?.drawImage(image, 0, 0);
            texture.needsUpdate = true;
            const scale = Math.min(0.86 / image.width, frame.stageHeight / image.height);
            screen.scale.set(image.width * scale, image.height * scale, 1);
            width = bounds.width;
            height = bounds.height;
            targets = painted;
            ready = true;
            frame.setTitle(ctx.title);
          })
          .catch(() => {
            if (disposed || version !== generation) return;
            ready = false;
            targets = [];
            message('Data Explorer preview unavailable. Press Refresh to retry.');
          })
          .finally(() => {
            capturing = false;
          });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        generation++;
        release();
        presentation?.(false);
        keyboard.dispose();
        screen.geometry.dispose();
        screen.material.dispose();
        texture.dispose();
        frame.dispose();
      },
    };
  },
};
