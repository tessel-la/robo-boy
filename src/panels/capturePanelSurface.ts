import { Context } from 'html2canvas/dist/lib/core/context';
import { CacheStorage } from 'html2canvas/dist/lib/core/cache-storage';
import { Bounds } from 'html2canvas/dist/lib/css/layout/bounds';
import { parseTree } from 'html2canvas/dist/lib/dom/node-parser';
import { CanvasRenderer } from 'html2canvas/dist/lib/render/canvas/canvas-renderer';

/**
 * html2canvas's public entry point clones into another iframe, inaccessible from our opaque origin.
 * Use its parser/renderer in the existing document instead. These internal imports are why the
 * dependency is pinned; the real sandbox browser test must pass before updating it.
 */
export async function capturePanelSurface(element: HTMLElement, width: number, height: number) {
  if (element.querySelector('video, iframe')) throw new Error('Video and embedded frames need a native XR renderer.');
  CacheStorage.setContext(window);
  const context = new Context(
    { logging: false, allowTaint: false, useCORS: false, imageTimeout: 1500 },
    new Bounds(window.scrollX, window.scrollY, window.innerWidth, window.innerHeight)
  );
  // Parsing may temporarily disable transforms/animations. Restore all inline styles synchronously,
  // before events or a browser paint can observe them. Unsupported shadows are omitted in the image.
  const elements = [element, ...element.querySelectorAll<HTMLElement>('*')];
  const styles = elements.map(el => el.getAttribute('style'));
  let tree: ReturnType<typeof parseTree>;
  try {
    for (const el of elements) el.style?.setProperty('box-shadow', 'none', 'important');
    tree = parseTree(context, element);
  } finally {
    elements.forEach((el, i) => {
      if (styles[i] === null) el.removeAttribute('style');
      else el.setAttribute('style', styles[i]!);
    });
  }
  return new CanvasRenderer(context, {
    backgroundColor: null,
    x: 0,
    y: 0,
    width,
    height,
    scale: Math.min(1, 1280 / width, 1280 / height),
  }).render(tree);
}
