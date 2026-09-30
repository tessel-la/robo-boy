import { expect, test } from '@playwright/test';

test('capture preserves CSS Color 4, SVG overflow under pan/zoom and live DOM identity', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/panels/capturePanelSurface.ts';
    const { capturePanelSurface } = await import(/* @vite-ignore */ path);
    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;left:0;top:0;width:120px;height:80px;background:color-mix(in srgb, green 50%, blue);';
    root.innerHTML = `<div style="position:absolute;inset:0;overflow:hidden">
      <div style="position:absolute;transform:translate(10px,10px) scale(.5);transform-origin:0 0;width:20px;height:20px">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" style="position:absolute;left:0;top:0;overflow:visible">
          <path d="M60 40L140 40" fill="none" stroke="red" stroke-width="4"/>
        </svg>
      </div>
    </div>`;
    document.body.appendChild(root);
    const nodes = [root, ...root.querySelectorAll('*')];
    const before = nodes.map(node => node.outerHTML);
    const svg = root.querySelector('svg')!;
    try {
      const pending = capturePanelSurface(root, 120, 80);
      const restored = nodes.every((node, i) => node.outerHTML === before[i]) && root.querySelector('svg') === svg;
      const canvas = await pending;
      const context = canvas.getContext('2d')!;
      return {
        restored,
        // The red edge is outside the original 20px SVG viewport, inside its clipped parent.
        edge: [...context.getImageData(50, 30, 1, 1).data],
        background: [...context.getImageData(1, 1, 1, 1).data],
      };
    } finally {
      root.remove();
    }
  });
  expect(result.restored).toBe(true);
  expect(result.edge).toEqual([255, 0, 0, 255]);
  expect(result.background).toEqual([0, 64, 128, 255]);
});
