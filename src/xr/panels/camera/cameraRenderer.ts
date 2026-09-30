import * as THREE from 'three';
import { getCameraPresentation, type CameraPresentation } from '../../../features/camera/presentation';
import { PanelFrame } from '../../ui/PanelFrame';
import { SpatialMenu } from '../../ui/SpatialMenu';
import { getXrThemeRevision } from '../../ui/xrTheme';
import { XR_THEME } from '../../ui/canvasKit';
import type { XrPanelRenderer } from '../registry';

/** Share the tile's decoded image/canvas; never open another stream or ROS subscription. */
export const cameraPanelRenderer: XrPanelRenderer = {
  panelType: 'camera',
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
    const geometry = new THREE.PlaneGeometry(0.86, frame.stageHeight);
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    const screen = new THREE.Mesh(geometry, material);
    screen.name = 'xr-camera-image';
    screen.position.y = frame.stageHeight / 2;
    frame.viewRoot.add(screen);
    let presentation: CameraPresentation | null = null;
    let active = true,
      disposed = false,
      lastDraw = -Infinity;
    let source: HTMLImageElement | HTMLCanvasElement | null = null;
    let sourceKey = '',
      lastRevision: number | null = -1,
      blocked = false;
    let status = '',
      menuKey = '';
    const menu = new SpatialMenu({ onClose: () => toolbar() });
    frame.attachMenu(menu);
    function topics() {
      menu.open(() => {
        const state = presentation?.snapshot();
        return {
          title: state?.recorded ? 'Recorded cameras' : 'Camera topics',
          emptyText: 'No camera topics found.',
          rows: (state?.topics ?? []).map(topic => ({
            kind: 'button' as const,
            label: topic,
            trailing: topic === state?.topic ? ('check' as const) : undefined,
            onPress: () => {
              presentation?.selectTopic(topic);
              menu.refresh();
            },
          })),
        };
      });
      toolbar();
    }
    function toolbar() {
      frame.setToolbar([
        {
          id: 'topics',
          icon: 'camera',
          label: 'Topics',
          active: menu.isOpen,
          onPress: () => {
            if (menu.isOpen) menu.close();
            else topics();
            toolbar();
          },
        },
        {
          id: 'retry',
          icon: 'reset',
          label: 'Retry',
          onPress: () => {
            blocked = false;
            lastRevision = -1;
            presentation?.retry();
          },
        },
      ]);
    }
    let messageTheme = -1;
    function message(text: string) {
      if ((status === text && messageTheme === getXrThemeRevision()) || !draw) return;
      messageTheme = getXrThemeRevision();
      status = text;
      // Resizing clears origin taint after a rejected cross-origin source.
      canvas.width = 1200;
      draw.fillStyle = XR_THEME.surface;
      draw.fillRect(0, 0, canvas.width, canvas.height);
      draw.fillStyle = XR_THEME.textMuted;
      draw.font = `32px ${XR_THEME.font}`;
      let line = '',
        y = 360;
      for (const word of text.split(' ')) {
        if (draw.measureText(line + word).width > 1080) {
          draw.fillText(line, 60, y);
          line = '';
          y += 44;
        }
        line += word + ' ';
      }
      draw.fillText(line, 60, y);
      texture.needsUpdate = true;
    }
    toolbar();
    message('Waiting for camera…');
    return {
      object: frame.object,
      setActive(value) {
        if (disposed) return;
        active = value;
        presentation?.setPresented(value);
      },
      update({ time }) {
        if (disposed || !active) return;
        const next = getCameraPresentation(ctx.panelId, ctx.storageScope);
        if (next !== presentation) {
          presentation?.setPresented(false);
          presentation = next;
          next?.setPresented(true);
          source = null;
          sourceKey = '';
          status = '';
          blocked = false;
          lastRevision = -1;
          lastDraw = -Infinity;
          menuKey = '';
          message('Waiting for camera…');
        }
        if (time - lastDraw < 1000 / 30) return;
        lastDraw = time;
        const state = presentation?.snapshot();
        if (!state) {
          message('Waiting for camera…');
          return;
        }
        const key = JSON.stringify([state.topic, state.topics, state.recorded]);
        if (menuKey !== key) {
          menuKey = key;
          frame.setTitle(ctx.title, state.recorded ? 'Recording' : 'Live');
          if (menu.isOpen) menu.refresh();
        }
        const image = state.source;
        const keyForSource = state.topic + (image instanceof HTMLImageElement ? image.src : '');
        if (source !== image || sourceKey !== keyForSource) {
          source = image;
          sourceKey = keyForSource;
          blocked = false;
          lastRevision = -1;
          // Clear any prior source and its origin taint before testing a replacement.
          canvas.width = 1200;
          status = '';
        }
        if (state.message) {
          message(state.message);
          return;
        }
        if (blocked) {
          if (status) message(status);
          return;
        }
        const width = image instanceof HTMLImageElement ? image.naturalWidth : (image?.width ?? 0);
        const height = image instanceof HTMLImageElement ? image.naturalHeight : (image?.height ?? 0);
        if (!image || !width || !height) {
          message('Waiting for camera frame…');
          return;
        }
        if (state.revision !== null && state.revision === lastRevision && !status) return;
        if (!draw) return;
        try {
          const scale = Math.min(canvas.width / width, canvas.height / height);
          draw.fillStyle = '#000';
          draw.fillRect(0, 0, canvas.width, canvas.height);
          draw.drawImage(
            image,
            (canvas.width - width * scale) / 2,
            (canvas.height - height * scale) / 2,
            width * scale,
            height * scale
          );
          // WebGL refuses a tainted canvas. Check once per source before it reaches the renderer.
          if (lastRevision === -1) draw.getImageData(0, 0, 1, 1);
          lastRevision = state.revision;
          status = '';
          texture.needsUpdate = true;
        } catch (error) {
          blocked = error instanceof DOMException && error.name === 'SecurityError';
          message(
            blocked
              ? 'Camera cannot be used in XR. Use the same-origin video proxy or enable CORS on the camera server.'
              : 'This camera frame could not be drawn. Waiting for the next frame…'
          );
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        presentation?.setPresented(false);
        texture.dispose();
        geometry.dispose();
        material.dispose();
        frame.dispose();
      },
    };
  },
};
