import { getTfTreePresentation, type TfTreePresentation } from '../../../features/tfTree/presentation';
import { filterTfTree, type TfTreeState } from '../../../features/tfTree/tfTreeModel';
import { PanelFrame } from '../../ui/PanelFrame';
import { SpatialMenu } from '../../ui/SpatialMenu';
import type { XrPanelRenderer } from '../registry';
import { TfTreeSurface } from './TfTreeSurface';
import { XrTfTreeMenu } from './XrTfTreeMenu';

export const tfTreePanelRenderer: XrPanelRenderer = {
  panelType: 'tfTree',
  create(ctx) {
    const frame = new PanelFrame({
      panelId: ctx.panelId,
      title: ctx.title,
      isPassthrough: ctx.isPassthrough,
      layout: 'surface',
      onClose: ctx.requestClose,
      onPlacementChange: ctx.savePlacement,
    });
    let presentation: TfTreePresentation | null = null;
    let editor: XrTfTreeMenu | null = null;
    let disposed = false;
    let active = true;
    let lastDraw = -Infinity;
    let lastState: TfTreeState | null = null;
    let lastSettings = '';
    let lastSecond = -1;
    const menu = new SpatialMenu({ onClose: () => toolbar() });
    const graph = new TfTreeSurface(frame => {
      editor?.details(frame);
      toolbar();
    });
    graph.surface.mesh.position.y = frame.stageHeight / 2;
    frame.viewRoot.add(graph.surface.mesh);
    frame.attachMenu(menu);

    function toolbar() {
      frame.setToolbar([
        {
          id: 'settings',
          icon: 'gear',
          label: 'Settings',
          disabled: !editor,
          active: menu.isOpen,
          onPress: () => {
            if (menu.isOpen) menu.close();
            else editor?.open();
            toolbar();
          },
        },
        {
          id: 'frames',
          icon: 'layers',
          label: 'Frames',
          disabled: !editor,
          onPress: () => {
            editor?.frames();
            toolbar();
          },
        },
        { id: 'fit', icon: 'fit', label: 'Fit', onPress: () => graph.fit() },
        { id: 'zoom-out', icon: 'minus', label: 'Zoom out', onPress: () => graph.zoom(1 / 1.3) },
        { id: 'zoom-in', icon: 'plus', label: 'Zoom in', onPress: () => graph.zoom(1.3) },
      ]);
    }
    toolbar();
    return {
      object: frame.object,
      setActive(value) {
        active = value;
        presentation?.setPresented(value);
      },
      update({ time }) {
        if (disposed || !active) return;
        const next = getTfTreePresentation(ctx.panelId, ctx.storageScope);
        if (next !== presentation) {
          presentation?.setPresented(false);
          menu.close();
          graph.clear();
          presentation = next;
          next?.setPresented(true);
          editor = next
            ? new XrTfTreeMenu(menu, next, selected => {
                // A frame reached through transform details may be hidden by the desktop filter.
                next.configure({ filter: '', showStatic: true });
                graph.focus(selected);
              })
            : null;
          lastState = null;
          lastDraw = -Infinity;
          toolbar();
        }
        if (!presentation || time - lastDraw < 100) return;
        const state = presentation.state;
        const settings = presentation.settings;
        const settingsKey = JSON.stringify(settings);
        const now = Date.now(),
          second = Math.floor(now / 1000);
        if (lastState === state && lastSettings === settingsKey && lastSecond === second) return;
        lastState = state;
        lastSettings = settingsKey;
        lastSecond = second;
        lastDraw = time;
        graph.setState(filterTfTree(state, settings.filter, settings.showStatic), settings.highlightStale, now);
        if (menu.isOpen) menu.refresh();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        presentation?.setPresented(false);
        graph.dispose();
        frame.dispose();
      },
    };
  },
};
