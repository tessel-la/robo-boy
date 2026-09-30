import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import desktopCss from '../../index.css?raw';
import { applyThemeToDocument, type CustomTheme } from '../../features/theme/themeUtils';
import { readPanelTheme } from '../../panels/theme';
import { PanelFrame } from './PanelFrame';
import { SpatialSurface } from './SpatialSurface';
import { stubCanvasContext } from './canvasStub';
import { XR_THEME, resolveXrTheme, startXrTheme, subscribeXrTheme } from './xrTheme';

const custom: CustomTheme = {
  id: 'tessella-test',
  name: 'Tessella',
  fontFamily: "Georgia, 'Times New Roman', serif",
  colors: { primary: '#3e5fd8', secondary: '#ffa65c', background: '#fff6d5', text: '#121212', cardBg: '#fffbec' },
};
let stop: () => void;
beforeEach(() => {
  stubCanvasContext();
  const style = document.createElement('style');
  style.textContent = desktopCss;
  document.head.appendChild(style);
  applyThemeToDocument('dark', []);
  stop = startXrTheme();
});
afterEach(() => {
  stop();
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});

describe('desktop theme in XR', () => {
  it.each(['dark', 'light', 'solarized', custom.id])('uses the resolved %s desktop tokens', theme => {
    applyThemeToDocument(theme, [custom]);
    const snapshot = readPanelTheme(document.documentElement);
    const resolved = resolveXrTheme(snapshot);
    expect(resolved.surface).toBe(snapshot.tokens['--card-bg']);
    expect(resolved.background).toBe(snapshot.tokens['--background-color']);
    expect(resolved.accent).toBe(snapshot.tokens['--primary-color']);
    expect(resolved.accentText).toBe(snapshot.tokens['--button-text-color']);
    expect(resolved.font).toBe(snapshot.tokens['--font-family-ui']);
    expect(resolved.danger).toBe(snapshot.tokens['--error-color']);
    expect(resolved.success).toBe(snapshot.tokens['--success-color']);
  });

  it('keeps hover washes in CSS sRGB rather than darkening them to linear RGB', () => {
    expect(resolveXrTheme({ colorScheme: 'dark', tokens: { '--primary-color': '#3e5fd8' } }).itemHover).toBe(
      'rgba(62, 95, 216, 0.16)'
    );
  });

  it('repaints existing surfaces and meshes without replacing their controls or placement', async () => {
    const frame = new PanelFrame({
      panelId: 'camera',
      title: 'Camera',
      layout: 'surface',
      isPassthrough: true,
      onClose() {},
      onPlacementChange() {},
    });
    const surfaces: SpatialSurface[] = [];
    let plate: THREE.MeshBasicMaterial | undefined;
    frame.object.traverse(object => {
      if (object.userData.xrSurface) surfaces.push(object.userData.xrSurface);
      const material = (object as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (material?.isMeshBasicMaterial && !material.map) plate = material;
    });
    const redraws = surfaces.map(surface => vi.spyOn(surface, 'redraw'));
    const close = surfaces.find(surface => surface.getItem('close'))!.getItem('close');
    frame.object.position.set(1, 2, 3);
    applyThemeToDocument(custom.id, [custom]);
    await vi.waitFor(() => expect(XR_THEME.surface).toBe('#fffbec'));
    expect(plate!.color.getHexString()).toBe('fffbec');
    expect(plate!.opacity).toBe(0.7);
    expect(redraws.every(spy => spy.mock.calls.length > 0)).toBe(true);
    expect(surfaces.find(surface => surface.getItem('close'))!.getItem('close')).toBe(close);
    expect(frame.object.position.toArray()).toEqual([1, 2, 3]);
    frame.dispose();
    redraws.forEach(spy => spy.mockClear());
    applyThemeToDocument('dark', []);
    await vi.waitFor(() => expect(XR_THEME.surface).toBe(readPanelTheme(document.documentElement).tokens['--card-bg']));
    expect(XR_THEME.surface).not.toBe('#fffbec');
    expect(redraws.every(spy => spy.mock.calls.length === 0)).toBe(true);
  });

  it('observes edits to the active custom stylesheet and disconnects with the session', async () => {
    applyThemeToDocument(custom.id, [custom]);
    await vi.waitFor(() => expect(XR_THEME.surface).toBe('#fffbec'));
    const notify = vi.fn();
    const unsubscribe = subscribeXrTheme(notify);
    try {
      applyThemeToDocument(custom.id, [{ ...custom, colors: { ...custom.colors, cardBg: '#222220' } }]);
      await vi.waitFor(() => expect(XR_THEME.surface).toBe('#222220'));
      expect(notify).toHaveBeenCalledTimes(1);
      stop();
      applyThemeToDocument('light', []);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });
});
