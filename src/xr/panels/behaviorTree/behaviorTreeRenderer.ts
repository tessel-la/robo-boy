import {
  getBehaviorTreePresentation,
  type BehaviorTreePresentation,
} from '../../../features/behaviorTree/presentation';
import { listBehaviorTrees, loadBehaviorTree } from '../../../features/behaviorTree/storage/treeStorage';
import { PanelFrame } from '../../ui/PanelFrame';
import { SpatialMenu } from '../../ui/SpatialMenu';
import { SpatialSurface, type SurfaceItem } from '../../ui/SpatialSurface';
import { XR_THEME, drawText, fillRoundRect, strokeRoundRect } from '../../ui/canvasKit';
import type { XrPanelRenderer } from '../registry';

export const behaviorTreePanelRenderer: XrPanelRenderer = {
  panelType: 'behaviorTree',
  create(ctx) {
    const frame = new PanelFrame({
      panelId: ctx.panelId,
      title: ctx.title,
      layout: 'surface',
      isPassthrough: ctx.isPassthrough,
      onClose: ctx.requestClose,
      onPlacementChange: ctx.savePlacement,
    });
    const graph = new SpatialSurface({ width: 0.86, height: frame.stageHeight });
    graph.mesh.name = 'xr-behavior-tree';
    graph.mesh.position.y = frame.stageHeight / 2;
    frame.viewRoot.add(graph.mesh);
    const menu = new SpatialMenu({ onClose: toolbar });
    frame.attachMenu(menu);
    let state: BehaviorTreePresentation | null = null,
      key = '',
      active = true;
    const latest = () => getBehaviorTreePresentation(ctx.panelId, ctx.storageScope)?.() ?? null;
    function savedTrees() {
      menu.open(() => ({
        title: 'Saved behavior trees',
        emptyText: 'Save a tree in the desktop editor first.',
        rows: listBehaviorTrees().map(({ tree }) => ({
          kind: 'button' as const,
          label: tree.name,
          disabled: Boolean(latest()?.executing),
          trailing: tree.id === latest()?.tree?.id ? ('check' as const) : undefined,
          onPress: () => {
            const saved = loadBehaviorTree(tree.id);
            if (saved) latest()?.load(saved);
            menu.refresh();
          },
        })),
      }));
      toolbar();
    }
    function settings() {
      menu.open(() => ({
        title: 'Execution',
        rows: [
          { kind: 'value', label: 'Tree', value: latest()?.tree?.name ?? 'No tree loaded' },
          { kind: 'value', label: 'State', value: latest()?.execution.status ?? 'idle' },
          { kind: 'value', label: 'Active node', value: latest()?.execution.activeNodeLabel ?? '—' },
          {
            kind: 'button',
            label: 'Execution mode',
            disabled: Boolean(latest()?.executing),
            detail: latest()?.persistent ? 'ROS host · continues when this panel closes' : 'This device',
            onPress: () => {
              const s = latest();
              if (s) s.setPersistent(!s.persistent);
              menu.refresh();
            },
          },
          {
            kind: 'button',
            label: 'Blackboard',
            onPress: () =>
              menu.push(() => ({
                title: 'Blackboard',
                emptyText: 'No blackboard values.',
                rows: Object.entries(latest()?.blackboard ?? {}).map(([label, value]) => ({
                  kind: 'value' as const,
                  label,
                  value: typeof value === 'string' ? value : (JSON.stringify(value) ?? '—'),
                })),
              })),
          },
        ],
      }));
      toolbar();
    }
    function toolbar() {
      const s = latest();
      frame.setToolbar([
        { id: 'bt-up', icon: 'chevronUp', label: 'Parent', disabled: !s?.path.length, onPress: () => latest()?.up() },
        { id: 'bt-trees', icon: 'layers', label: 'Trees', disabled: Boolean(s?.executing), onPress: savedTrees },
        {
          id: 'bt-run',
          icon: s?.executing && !s.paused ? 'pause' : 'play',
          label: s?.executing ? (s.paused ? 'Resume' : 'Pause') : 'Run',
          disabled: !s?.connected || !s.tree || !s.nodes.length,
          onPress: () => {
            const next = latest();
            if (next?.executing) {
              if (next.paused) next.resume();
              else next.pause();
            } else next?.execute();
          },
        },
        { id: 'bt-stop', icon: 'reset', label: 'Stop', disabled: !s?.executing, onPress: () => latest()?.stop() },
        {
          id: 'bt-execution',
          icon: 'gear',
          label: 'Execution',
          active: menu.isOpen,
          onPress: () => {
            if (menu.isOpen) {
              menu.close();
              toolbar();
            } else settings();
          },
        },
      ]);
    }
    function draw(s: BehaviorTreePresentation | null) {
      const w = graph.pixelWidth,
        h = graph.pixelHeight;
      if (!s?.nodes.length) {
        graph.setItems([
          {
            id: 'empty',
            x: 0,
            y: 0,
            w,
            h,
            draw: draw =>
              drawText(draw, 'Load a saved tree from Trees', w / 2, h / 2, w - 48, {
                align: 'center',
                size: 32,
                color: XR_THEME.textMuted,
              }),
          },
        ]);
        return;
      }
      const nodes = s.nodes;
      const minX = Math.min(...nodes.map(n => n.position.x)),
        minY = Math.min(...nodes.map(n => n.position.y));
      const maxX = Math.max(...nodes.map(n => n.position.x + 220)),
        maxY = Math.max(...nodes.map(n => n.position.y + 84));
      const scale = Math.min(2.5, (w - 64) / (maxX - minX), (h - 64) / (maxY - minY));
      const offsetX = (w - (maxX - minX) * scale) / 2,
        offsetY = (h - (maxY - minY) * scale) / 2;
      const bounds = new Map(
        nodes.map(n => [
          n.id,
          {
            x: offsetX + (n.position.x - minX) * scale,
            y: offsetY + (n.position.y - minY) * scale,
            w: 220 * scale,
            h: 84 * scale,
          },
        ])
      );
      const items: SurfaceItem[] = [
        {
          id: 'edges',
          x: 0,
          y: 0,
          w,
          h,
          draw: draw => {
            draw.strokeStyle = XR_THEME.surfaceBorder;
            draw.lineWidth = 3;
            for (const edge of s.edges) {
              const from = bounds.get(edge.source),
                to = bounds.get(edge.target);
              if (!from || !to) continue;
              draw.beginPath();
              draw.moveTo(from.x + from.w / 2, from.y + from.h);
              const middle = (from.y + from.h + to.y) / 2;
              draw.bezierCurveTo(from.x + from.w / 2, middle, to.x + to.w / 2, middle, to.x + to.w / 2, to.y);
              draw.stroke();
            }
          },
        },
      ];
      for (const node of nodes) {
        const box = bounds.get(node.id)!;
        const status = node.data.status ?? 'idle';
        items.push({
          id: `bt-node-${node.id}`,
          ...box,
          onPress: () => {
            menu.open(() => {
              const n = latest()?.nodes.find(n => n.id === node.id);
              return {
                title: n?.data.label ?? node.id,
                rows: [
                  ...(n?.type === 'subtree'
                    ? [
                        {
                          kind: 'button' as const,
                          label: 'Open subtree',
                          onPress: () => {
                            latest()?.enterSubtree(node.id);
                            menu.close();
                            toolbar();
                          },
                        },
                      ]
                    : []),
                  { kind: 'value', label: 'Type', value: n?.type ?? 'node' },
                  { kind: 'value', label: 'Status', value: n?.data.status ?? 'idle' },
                  ...Object.entries(n?.data ?? {})
                    .filter(([key]) => !['label', 'status', 'tree', 'isHighlighted'].includes(key))
                    .map(([label, value]) => ({
                      kind: 'value' as const,
                      label,
                      value: typeof value === 'string' ? value : (JSON.stringify(value) ?? '—'),
                    })),
                ],
              };
            });
            toolbar();
          },
          draw: (draw, item, hover) => {
            fillRoundRect(
              draw,
              item.x,
              item.y,
              item.w,
              item.h,
              14,
              hover.hover ? XR_THEME.itemHover : XR_THEME.surface
            );
            const color =
              status === 'running'
                ? XR_THEME.accent
                : status === 'success'
                  ? XR_THEME.success
                  : status === 'failure'
                    ? XR_THEME.danger
                    : XR_THEME.surfaceBorder;
            strokeRoundRect(draw, item.x + 2, item.y + 2, item.w - 4, item.h - 4, 12, color, 3);
            drawText(draw, node.data.label, item.x + 16, item.y + item.h * 0.38, item.w - 32, {
              size: Math.min(32, item.h * 0.32),
              weight: 700,
            });
            drawText(draw, `${node.type ?? 'node'} · ${status}`, item.x + 16, item.y + item.h * 0.72, item.w - 32, {
              size: Math.min(24, item.h * 0.24),
              color: XR_THEME.textMuted,
            });
          },
        });
      }
      graph.setItems(items);
    }
    toolbar();
    draw(null);
    return {
      object: frame.object,
      setActive(value) {
        active = value;
      },
      update() {
        if (!active) return;
        const next = latest();
        if (next === state) return;
        const nextKey = JSON.stringify(
          next && [
            next.tree?.id,
            next.tree?.name,
            next.nodes,
            next.edges,
            next.execution,
            next.connected,
            next.executing,
            next.paused,
            next.persistent,
            next.blackboard,
            next.path,
          ]
        );
        state = next;
        if (nextKey === key) return;
        key = nextKey;
        frame.setTitle(
          state?.tree?.name ?? ctx.title,
          state?.executing ? (state.paused ? 'Paused' : 'Running') : 'Behavior tree'
        );
        draw(state);
        toolbar();
        if (menu.isOpen) menu.refresh();
      },
      dispose() {
        graph.dispose();
        frame.dispose();
      },
    };
  },
};
