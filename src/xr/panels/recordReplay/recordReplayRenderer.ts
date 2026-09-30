import { getRecordReplayPresentation } from '../../../features/recordReplay/presentation';
import { formatBytes, formatDuration } from '../../../features/recordReplay/format';
import type { RecordOptions } from '../../../features/recordReplay/types';
import { PanelFrame } from '../../ui/PanelFrame';
import { SpatialMenu, type MenuRow } from '../../ui/SpatialMenu';
import { SpatialSurface, getSurfaceOf, type SurfaceItem } from '../../ui/SpatialSurface';
import type { XrInputTarget } from '../../XrInputManager';
import { XR_THEME, drawText, fillRoundRect } from '../../ui/canvasKit';
import type { XrPanelRenderer } from '../registry';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
export const recordReplayPanelRenderer: XrPanelRenderer = {
  panelType: 'recordReplay',
  create(ctx) {
    const frame = new PanelFrame({
      panelId: ctx.panelId,
      title: ctx.title,
      layout: 'surface',
      isPassthrough: ctx.isPassthrough,
      onClose: ctx.requestClose,
      onPlacementChange: ctx.savePlacement,
    });
    const surface = new SpatialSurface({ width: 0.86, height: frame.stageHeight });
    surface.mesh.name = 'xr-record-replay';
    surface.mesh.position.y = frame.stageHeight / 2;
    frame.viewRoot.add(surface.mesh);
    const menu = new SpatialMenu({ onClose: toolbar });
    frame.attachMenu(menu);
    const latest = () => getRecordReplayPresentation(ctx.panelId, ctx.storageScope)?.() ?? null;
    let active = true,
      key = '',
      lastDraw = -Infinity;
    let scrubPointer: string | null = null;
    let lastScrub = -Infinity;
    function timeline(target: XrInputTarget) {
      if (!active || getSurfaceOf(target.object) !== surface) return false;
      const item = surface.itemAt(target.uv);
      return item?.id === 'rr-timeline' && !item.disabled;
    }
    function seek(target: XrInputTarget) {
      const s = latest(),
        item = surface.getItem('rr-timeline');
      if (!s || !item || !target.uv || !timeline(target)) return;
      const fraction = Math.max(0, Math.min(1, (target.uv.x * surface.pixelWidth - item.x) / item.w));
      const position = Math.round(fraction * s.session.duration * 1000) / 1000;
      if (position === lastScrub) return;
      lastScrub = position;
      s.seek(position);
    }
    const busy = () => ['recording', 'paused', 'stopping'].includes(latest()?.recorder.status?.state ?? '');
    function recordings() {
      latest()?.setTab('replay');
      menu.open(() => {
        const s = latest(),
          remote = s?.remote;
        const listing = remote && 'listing' in remote ? remote.listing : undefined;
        const rows: MenuRow[] = [
          { kind: 'button', label: 'Refresh', onPress: () => latest()?.refresh() },
          {
            kind: 'button',
            label: 'Parent folder',
            disabled: !s?.remotePath,
            onPress: () => {
              const path = latest()?.remotePath ?? '';
              latest()?.browse(path.split('/').slice(0, -1).join('/'));
            },
          },
        ];
        for (const folder of listing?.folders ?? [])
          rows.push({
            kind: 'button',
            label: folder,
            trailing: 'chevron',
            onPress: () => latest()?.browse([latest()?.remotePath, folder].filter(Boolean).join('/')),
          });
        for (const recording of listing?.recordings ?? []) {
          for (const file of recording.files)
            rows.push({
              kind: 'button',
              label: file.name,
              detail: recording.active ? 'Still recording' : `${recording.name} · ${formatBytes(file.size)}`,
              disabled: recording.active,
              onPress: () => {
                latest()?.open(file);
                menu.close();
                toolbar();
              },
            });
        }
        for (const file of listing?.files ?? [])
          rows.push({
            kind: 'button',
            label: file.name,
            detail: formatBytes(file.size),
            onPress: () => {
              latest()?.open(file);
              menu.close();
              toolbar();
            },
          });
        if (remote?.status === 'error') rows.push({ kind: 'value', label: 'Error', value: remote.error });
        if (s?.replay.info)
          rows.push({ kind: 'button', label: 'Close recording to browse', onPress: () => latest()?.session.close() });
        return {
          title: 'Recordings on ROS host',
          rows,
          emptyText: remote?.status === 'loading' ? 'Loading recordings…' : 'No recordings found.',
        };
      });
      toolbar();
    }
    function replaySettings() {
      menu.open(() => {
        const s = latest();
        return {
          title: 'Replay',
          rows: [
            {
              kind: 'toggle',
              label: 'Loop',
              value: s?.replay.loop ?? false,
              onChange: value => {
                latest()?.session.setLoop(value);
                menu.refresh();
              },
            },
            {
              kind: 'stepper',
              label: 'Speed',
              value: `${s?.replay.speed ?? 1}×`,
              canDecrement: (s?.replay.speed ?? 1) > SPEEDS[0],
              canIncrement: (s?.replay.speed ?? 1) < SPEEDS[SPEEDS.length - 1],
              onDecrement: () => {
                const s = latest();
                if (s) s.session.setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(s.replay.speed) - 1)]);
              },
              onIncrement: () => {
                const s = latest();
                if (s) s.session.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(s.replay.speed) + 1)]);
              },
            },
            { kind: 'button', label: 'Restart', disabled: !s?.replay.info, onPress: () => latest()?.session.seek(0) },
            {
              kind: 'button',
              label: 'Return to live data',
              disabled: !s?.replay.info,
              onPress: () => latest()?.session.close(),
            },
            {
              kind: 'button',
              label: 'Retry',
              disabled: !s?.session.canRetry,
              onPress: () => latest()?.session.retry(),
            },
            {
              kind: 'button',
              label: 'Recorded topics',
              onPress: () =>
                menu.push(() => ({
                  title: 'Recorded topics',
                  emptyText: 'No recording loaded.',
                  rows: (latest()?.replay.info?.topics ?? []).map(topic => ({
                    kind: 'value' as const,
                    label: topic.name,
                    value: topic.error ?? `${topic.type} · ${topic.count} messages`,
                  })),
                })),
            },
          ],
        };
      });
      toolbar();
    }
    function recordSettings() {
      menu.open(() => {
        const s = latest(),
          o = s?.options;
        const locked = busy() || Boolean(s?.recorder.pending);
        const numeric = (
          label: string,
          field: keyof Pick<RecordOptions, 'frequency' | 'maxSizeMiB' | 'maxDurationSec' | 'cacheMiB'>,
          step: number,
          min = 0,
          max = 100000
        ): MenuRow => ({
          kind: 'stepper',
          label,
          value: String(o?.[field] ?? 0),
          canDecrement: !locked && (o?.[field] ?? 0) > min,
          canIncrement: !locked && (o?.[field] ?? 0) < max,
          onDecrement: () => {
            const value = latest()?.options[field] ?? min;
            latest()?.changeOptions({ [field]: Math.max(min, value - step) });
          },
          onIncrement: () => {
            const value = latest()?.options[field] ?? min;
            latest()?.changeOptions({ [field]: Math.min(max, value + step) });
          },
        });
        return {
          title: 'Recording options',
          rows: [
            { kind: 'value', label: 'Name', value: o?.name ?? '—' },
            { kind: 'value', label: 'Destination', value: o?.path || s?.recorder.status?.root || '/recordings' },
            {
              kind: 'button',
              label: 'Topics',
              disabled: locked,
              onPress: () =>
                menu.push(() => {
                  const s = latest();
                  return {
                    title: 'Recording topics',
                    rows: [
                      {
                        kind: 'toggle',
                        label: 'All topics',
                        value: s?.options.allTopics ?? true,
                        onChange: value => latest()?.changeOptions({ allTopics: value }),
                      },
                      ...[...new Set([...(s?.topics ?? []), ...(s?.options.topics ?? [])])].sort().map(topic => ({
                        kind: 'button' as const,
                        label: topic,
                        disabled: Boolean(s?.options.allTopics) || busy(),
                        trailing: s?.options.topics.includes(topic) ? ('check' as const) : undefined,
                        onPress: () => {
                          const s = latest();
                          if (s)
                            s.changeOptions({
                              topics: s.options.topics.includes(topic)
                                ? s.options.topics.filter(t => t !== topic)
                                : [...s.options.topics, topic],
                            });
                        },
                      })),
                    ],
                  };
                }),
            },
            numeric('Maximum Hz per topic', 'frequency', 1),
            {
              kind: 'button',
              label: 'Compression',
              detail: o?.compression ?? 'zstd',
              disabled: locked,
              onPress: () => {
                const o = latest()?.options;
                latest()?.changeOptions({ compression: o?.compression === 'zstd' ? 'none' : 'zstd' });
              },
            },
            numeric('Split size (MiB)', 'maxSizeMiB', 100),
            numeric('Split interval (seconds)', 'maxDurationSec', 60),
            numeric('Writer queue (MiB)', 'cacheMiB', 16, 1, 1024),
            {
              kind: 'button',
              label: 'Delivery policy',
              detail: o?.qos ?? 'auto',
              disabled: locked,
              onPress: () => {
                const values = ['auto', 'reliable', 'best_effort'] as const;
                const o = latest()?.options;
                latest()?.changeOptions({ qos: values[(values.indexOf(o?.qos ?? 'auto') + 1) % values.length] });
              },
            },
            {
              kind: 'button',
              label: 'Hidden topics',
              detail: o?.includeHidden ? 'Included' : 'Excluded',
              disabled: locked,
              onPress: () => latest()?.changeOptions({ includeHidden: !latest()?.options.includeHidden }),
            },
            {
              kind: 'button',
              label: 'Simulation time',
              detail: o?.useSimTime ? 'Enabled' : 'Disabled',
              disabled: locked,
              onPress: () => latest()?.changeOptions({ useSimTime: !latest()?.options.useSimTime }),
            },
            { kind: 'value', label: 'Include expression', value: o?.include || '—' },
            { kind: 'value', label: 'Exclude expression', value: o?.exclude || '—' },
          ],
        };
      });
      toolbar();
    }
    function toolbar() {
      const s = latest();
      frame.setToolbar([
        {
          id: 'rr-replay',
          icon: 'play',
          label: 'Replay',
          active: s?.tab === 'replay',
          onPress: () => {
            latest()?.setTab('replay');
            menu.close();
          },
        },
        {
          id: 'rr-record',
          icon: 'plus',
          label: 'Record',
          active: s?.tab === 'record',
          onPress: () => {
            latest()?.setTab('record');
            menu.close();
          },
        },
        { id: 'rr-files', icon: 'layers', label: 'Files', onPress: recordings },
        {
          id: 'rr-settings',
          icon: 'gear',
          label: 'Options',
          active: menu.isOpen,
          onPress: () => {
            if (menu.isOpen) {
              menu.close();
              toolbar();
            } else if (latest()?.tab === 'record') recordSettings();
            else replaySettings();
          },
        },
      ]);
    }
    function dashboard() {
      const s = latest(),
        w = surface.pixelWidth,
        h = surface.pixelHeight;
      const text = (id: string, label: string, y: number, color: string = XR_THEME.text, size = 32): SurfaceItem => ({
        id,
        x: 24,
        y,
        w: w - 48,
        h: 64,
        draw: draw => drawText(draw, label, 32, y + 32, w - 64, { size, color }),
      });
      const button = (
        id: string,
        label: string,
        column: number,
        disabled: boolean,
        onPress: () => void
      ): SurfaceItem => ({
        id,
        x: 24 + (column * w) / 3,
        y: h - 144,
        w: w / 3 - 48,
        h: 96,
        disabled,
        onPress,
        draw: (draw, item, hover) => {
          fillRoundRect(
            draw,
            item.x,
            item.y,
            item.w,
            item.h,
            16,
            disabled ? XR_THEME.itemDisabled : hover.hover ? XR_THEME.itemHover : XR_THEME.item
          );
          drawText(draw, label, item.x + item.w / 2, item.y + item.h / 2, item.w - 24, {
            align: 'center',
            size: 32,
            color: disabled ? XR_THEME.textDisabled : XR_THEME.text,
          });
        },
      });
      if (!s) {
        surface.setItems([text('waiting', 'Waiting for Record & Replay…', h / 2)]);
        return;
      }
      const items: SurfaceItem[] = [];
      if (s.tab === 'replay') {
        const replay = s.replay,
          ready = Boolean(replay.info) && replay.phase !== 'error';
        items.push(text('name', replay.info?.name ?? 'Choose a recording from Files', 24, XR_THEME.text, 40));
        items.push(
          text(
            'status',
            replay.error ??
              (replay.phase === 'loading'
                ? 'Loading recording…'
                : replay.phase === 'seeking'
                  ? 'Seeking…'
                  : replay.playing
                    ? replay.buffering
                      ? 'Buffering…'
                      : 'Playing'
                    : 'Paused'),
            110,
            replay.error ? XR_THEME.danger : XR_THEME.textMuted
          )
        );
        items.push(
          text(
            'position',
            `${formatDuration(s.position)} / ${formatDuration(s.session.duration)} · ${replay.speed}×`,
            216,
            XR_THEME.text,
            44
          )
        );
        items.push(
          text(
            'hint',
            replay.info
              ? 'Camera, Time Series, TF and 3D follow this recording.'
              : 'Open local MCAP files in the desktop workspace before entering XR.',
            330,
            XR_THEME.textMuted,
            26
          )
        );
        items.push(
          {
            id: 'rr-timeline',
            x: 32,
            y: 440,
            w: w - 64,
            h: 96,
            disabled: !ready || !s.session.duration,
            onPress: () => {},
            draw: (draw, item, hover) => {
              fillRoundRect(
                draw,
                item.x,
                item.y + 40,
                item.w,
                16,
                8,
                hover.hover ? XR_THEME.itemHover : XR_THEME.surfaceBorder
              );
              const progress = s.session.duration ? Math.max(0, Math.min(1, s.position / s.session.duration)) : 0;
              fillRoundRect(draw, item.x, item.y + 40, item.w * progress, 16, 8, XR_THEME.accent);
              draw.fillStyle = item.disabled ? XR_THEME.textDisabled : XR_THEME.accent;
              draw.beginPath();
              draw.arc(item.x + item.w * progress, item.y + 48, 18, 0, Math.PI * 2);
              draw.fill();
            },
          },
          button('rr-back', 'Back 10s', 0, !ready, () => {
            const s = latest();
            if (s) s.session.seek(s.replay.position - 10);
          }),
          button('rr-play', replay.playing ? 'Pause' : 'Play', 1, !ready, () => {
            const s = latest();
            if (s?.replay.playing) s.session.pause();
            else s?.session.play();
          }),
          button('rr-forward', 'Forward 10s', 2, !ready, () => {
            const s = latest();
            if (s) s.session.seek(s.replay.position + 10);
          })
        );
      } else {
        const recorder = s.recorder,
          status = recorder.status;
        const locked = !recorder.online || recorder.pending;
        const recording = status?.state === 'recording' || status?.state === 'paused';
        items.push(text('name', s.options.name, 24, XR_THEME.text, 40));
        items.push(
          text(
            'status',
            recorder.error ||
              status?.error ||
              (!recorder.online
                ? 'Waiting for ROS recorder…'
                : recorder.pending
                  ? 'Waiting for acknowledgement…'
                  : (status?.state ?? 'Ready')),
            110,
            recorder.error || status?.error ? XR_THEME.danger : XR_THEME.textMuted
          )
        );
        items.push(text('path', status?.path || s.options.path || status?.root || '/recordings', 204));
        items.push(
          text(
            'counts',
            `${formatDuration(status?.elapsed ?? 0)} · ${status?.messages ?? 0} messages · ${formatBytes(status?.bytes ?? 0)}`,
            292
          )
        );
        items.push(
          text(
            'dropped',
            status?.dropped
              ? `${status.dropped} messages dropped`
              : 'Recording continues on the ROS host when this panel closes.',
            370,
            status?.dropped ? XR_THEME.danger : XR_THEME.textMuted,
            26
          )
        );
        if (!busy())
          items.push(
            button(
              'rr-start',
              'Start recording',
              0,
              locked || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(s.options.name),
              () => latest()?.start()
            )
          );
        else
          items.push(
            button('rr-pause', status?.state === 'paused' ? 'Resume' : 'Pause', 0, locked || !recording, () => {
              const s = latest();
              s?.recorder.command(s.recorder.status?.state === 'paused' ? 'resume' : 'pause');
            }),
            button('rr-split', 'Split', 1, locked || !recording, () => latest()?.recorder.command('split')),
            button('rr-stop', 'Stop & save', 2, locked || !recording, () => latest()?.recorder.command('stop'))
          );
      }
      surface.setItems(items);
    }
    toolbar();
    dashboard();
    return {
      object: frame.object,
      allowsPressDrag: timeline,
      onPressStart(pointer, target) {
        if (scrubPointer === null && timeline(target)) {
          scrubPointer = pointer;
          lastScrub = -Infinity;
          seek(target);
        }
      },
      onPressMove(pointer, target) {
        if (pointer === scrubPointer) seek(target);
      },
      onPressEnd(pointer) {
        if (pointer === scrubPointer) scrubPointer = null;
      },
      setActive(value) {
        active = value;
        if (!value) scrubPointer = null;
      },
      update({ time }) {
        if (!active || time - lastDraw < 100) return;
        lastDraw = time;
        dashboard();
        const s = latest();
        const nextKey = JSON.stringify(
          s && [
            s.tab,
            s.replay.phase,
            s.replay.info?.name,
            s.replay.playing,
            s.replay.speed,
            s.replay.loop,
            s.replay.error,
            s.recorder.status?.state,
            s.recorder.online,
            s.recorder.pending,
            s.recorder.error,
            s.options,
            s.topics,
            s.remote,
          ]
        );
        if (key !== nextKey) {
          key = nextKey;
          toolbar();
          if (menu.isOpen) menu.refresh();
          frame.setTitle(ctx.title, s?.tab === 'record' ? 'ROS host' : s?.replay.remote ? 'ROS host replay' : 'Replay');
        }
      },
      dispose() {
        surface.dispose();
        frame.dispose();
      },
    };
  },
};
