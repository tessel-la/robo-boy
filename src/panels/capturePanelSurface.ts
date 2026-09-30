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
  const bounds = element.getBoundingClientRect();
  const context = new Context(
    { logging: false, allowTaint: false, useCORS: false, imageTimeout: 1500 },
    new Bounds(window.scrollX, window.scrollY, window.innerWidth, window.innerHeight)
  );
  // Parsing may temporarily disable transforms/animations. Restore all inline styles synchronously,
  // before events or a browser paint can observe them. Unsupported shadows are omitted in the image.
  const elements = [element, ...element.querySelectorAll<HTMLElement>('*')];
  const styles = elements.map(el => el.getAttribute('style'));
  // html2canvas also assigns SVG width/height before serializing its image.
  const svgs = [...element.querySelectorAll('svg')];
  if (element instanceof SVGSVGElement) svgs.unshift(element);
  const svgSizes = svgs.map(svg => [svg.getAttribute('width'), svg.getAttribute('height')]);
  const replacements: { svg: SVGSVGElement; image: HTMLImageElement }[] = [];
  const snapshotSizes = new Map<string, { width: number; height: number }>();
  // Chromium resolves color-mix/OKLCH to CSS Color 4 values that this pinned parser cannot read.
  // Let the browser convert those colors to sRGB; use a per-capture cache so repeated colors cost
  // one pixel read. SVGs also need their CSS paint/fonts inlined before html2canvas serializes them.
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = 1;
  const colorContext = colorCanvas.getContext('2d');
  const colors = new Map<string, string>();
  const resolveColor = (value: string) => {
    if (!colorContext || !/^(color|color-mix|lab|lch|oklab|oklch)\(/.test(value)) return value;
    const cached = colors.get(value);
    if (cached) return cached;
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = value;
    colorContext.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorContext.getImageData(0, 0, 1, 1).data;
    const resolved = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    colors.set(value, resolved);
    return resolved;
  };
  let tree: ReturnType<typeof parseTree>;
  try {
    for (const el of elements) {
      const computed = getComputedStyle(el);
      for (const property of [
        'color',
        'background-color',
        'border-top-color',
        'border-right-color',
        'border-bottom-color',
        'border-left-color',
        'outline-color',
        'text-decoration-color',
        'fill',
        'stroke',
      ]) {
        const value = computed.getPropertyValue(property);
        const resolved = resolveColor(value);
        if (resolved !== value || (el instanceof SVGElement && ['fill', 'stroke', 'color'].includes(property)))
          el.style?.setProperty(property, resolved, 'important');
      }
      if (el instanceof SVGElement) {
        for (const property of ['font-family', 'font-size', 'font-weight', 'stroke-width', 'stroke-dasharray'])
          el.style.setProperty(property, computed.getPropertyValue(property), 'important');
      }
      el.style?.setProperty('box-shadow', 'none', 'important');
    }
    // Positioned SVGs without a viewBox (ReactFlow edges) paint beyond their viewport. An SVG
    // decoded as an image clips that overflow. Snapshot the visible region into a bounded image,
    // retaining its local coordinates so the parser can apply the parent's pan/zoom unchanged.
    for (const svg of svgs) {
      const computed = getComputedStyle(svg);
      if (svg.hasAttribute('viewBox') || computed.position !== 'absolute' || computed.overflow !== 'visible') continue;
      const rect = svg.getBoundingClientRect();
      const sx = rect.width / svg.clientWidth,
        sy = rect.height / svg.clientHeight;
      if (!(sx > 0 && sy > 0)) continue;
      let left = bounds.left,
        top = bounds.top,
        right = bounds.right,
        bottom = bounds.bottom;
      for (let parent = svg.parentElement; parent && parent !== element; parent = parent.parentElement) {
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
      if (!(right > left && bottom > top)) continue;
      const x = (left - rect.left) / sx,
        y = (top - rect.top) / sy;
      const w = (right - left) / sx,
        h = (bottom - top) / sy;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      const scale = Math.min(1, 1280 / (right - left), 1280 / (bottom - top));
      const pixelWidth = Math.ceil((right - left) * scale),
        pixelHeight = Math.ceil((bottom - top) * scale);
      clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
      clone.setAttribute('width', String(pixelWidth));
      clone.setAttribute('height', String(pixelHeight));
      clone.style.setProperty('width', `${pixelWidth}px`, 'important');
      clone.style.setProperty('height', `${pixelHeight}px`, 'important');
      const image = document.createElement('img');
      image.src = 'data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
      snapshotSizes.set(image.src, { width: pixelWidth, height: pixelHeight });
      image.style.cssText = `position:absolute;left:${(parseFloat(computed.left) || 0) + x}px;top:${(parseFloat(computed.top) || 0) + y}px;width:${w}px;height:${h}px;max-width:none;max-height:none;`;
      svg.replaceWith(image);
      replacements.push({ svg, image });
    }
    tree = parseTree(context, element);
    // Newly created images have no naturalWidth until decoded. Their snapshot sizes are already
    // known; supply them now so the first frame renders after the cache finishes decoding.
    const applySnapshotSizes = (node: typeof tree) => {
      if ('src' in node && typeof node.src === 'string' && 'intrinsicWidth' in node && 'intrinsicHeight' in node) {
        const size = snapshotSizes.get(node.src);
        if (size) {
          node.intrinsicWidth = size.width;
          node.intrinsicHeight = size.height;
        }
      }
      node.elements.forEach(applySnapshotSizes);
    };
    if (snapshotSizes.size) applySnapshotSizes(tree);
  } finally {
    replacements.forEach(({ svg, image }) => image.replaceWith(svg));
    elements.forEach((el, i) => {
      // Setting the attribute flushes Chromium's pending CSSOM serialization before removal.
      // Otherwise a later getAttribute can resurrect an empty style attribute.
      el.setAttribute('style', styles[i] ?? '');
      if (styles[i] === null) el.removeAttribute('style');
    });
    svgs.forEach((svg, i) => {
      ['width', 'height'].forEach((attribute, j) => {
        const value = svgSizes[i][j];
        if (value === null) svg.removeAttribute(attribute);
        else svg.setAttribute(attribute, value);
      });
    });
  }
  return new CanvasRenderer(context, {
    backgroundColor: null,
    x: bounds.left + window.scrollX,
    y: bounds.top + window.scrollY,
    width,
    height,
    scale: Math.min(1, 1280 / width, 1280 / height),
  }).render(tree);
}
