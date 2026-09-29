import {
  COLORS,
  SERIES_LIMIT,
  createSeriesId,
  displayName,
  sanitizeConfig,
  sourceKey,
  type TimeseriesConfig,
  type TimeseriesSeriesConfig,
} from '../../../features/timeSeries/config';
import { sanitizeMath } from '../../../features/timeSeries/math';
import type { TimeSeriesPresentation } from '../../../features/timeSeries/presentation';
import { SpatialMenu, type MenuPage, type MenuRow } from '../../ui/SpatialMenu';

/** A spatial editor of the desktop tile's config; no separate settings or ROS subscriptions. */
export class XrTimeSeriesSettings {
  private topics: Array<{ name: string; messageType: string }> = [];
  private topicStatus = '';
  private request = 0;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly menu: SpatialMenu,
    private readonly presentation: TimeSeriesPresentation,
    private readonly onClear: () => void
  ) {}

  private get config() {
    return this.presentation.engine.config;
  }

  private commit(config: TimeseriesConfig): void {
    this.presentation.configure(sanitizeConfig(config));
    this.menu.refresh();
  }

  private patch(id: string, patch: Partial<TimeseriesSeriesConfig>): void {
    this.commit({ ...this.config, series: this.config.series.map(s => (s.id === id ? { ...s, ...patch } : s)) });
  }

  open(): void {
    this.menu.open(() => this.root());
  }

  private root(): MenuPage {
    return {
      title: 'Time Series settings',
      rows: [
        {
          kind: 'button',
          label: 'Add ROS topic',
          trailing: 'chevron',
          onPress: () => {
            this.menu.push(() => this.topicPage());
            this.refreshTopics();
          },
        },
        {
          kind: 'button',
          label: 'Signals',
          detail: `${this.config.series.length} / ${SERIES_LIMIT}`,
          trailing: 'chevron',
          onPress: () => this.menu.push(() => this.signals()),
        },
        {
          kind: 'button',
          label: 'Plot and performance',
          trailing: 'chevron',
          onPress: () => this.menu.push(() => this.plot()),
        },
        { kind: 'button', label: 'Clear captured history', danger: true, onPress: this.onClear },
      ],
    };
  }

  private topicPage(): MenuPage {
    return {
      title: 'Add ROS topic',
      rows: [
        {
          kind: 'button',
          label: 'Refresh topics',
          disabled: !this.presentation.connected,
          onPress: () => this.refreshTopics(),
        },
        ...(this.topicStatus ? [{ kind: 'header' as const, label: this.topicStatus }] : []),
        ...this.topics.map(topic => ({
          kind: 'button' as const,
          label: topic.name,
          detail: topic.messageType,
          disabled:
            this.config.series.length >= SERIES_LIMIT ||
            this.config.series.some(s => s.topic === topic.name && s.messageType === topic.messageType),
          onPress: () => {
            this.add(topic.name, topic.messageType);
            this.menu.pop();
          },
        })),
      ],
    };
  }

  private refreshTopics(): void {
    const ros = this.presentation.ros;
    const request = ++this.request;
    clearTimeout(this.timeout);
    if (!ros || !this.presentation.connected) {
      this.topicStatus = 'Connect to ROS to discover topics';
      this.menu.refresh();
      return;
    }
    this.topicStatus = 'Loading topics…';
    this.menu.refresh();
    this.timeout = setTimeout(() => {
      if (request !== this.request) return;
      this.request++;
      this.topicStatus = 'Discovery timed out. Refresh to retry.';
      this.menu.refresh();
    }, 8000);
    const fail = (error: unknown) => {
      if (request !== this.request) return;
      clearTimeout(this.timeout);
      this.topicStatus = String(error);
      this.menu.refresh();
    };
    try {
      ros.getTopics(result => {
        if (request !== this.request) return;
        clearTimeout(this.timeout);
        this.topics = result.topics
          .map((name, index) => ({ name, messageType: result.types[index] }))
          .filter(topic => topic.messageType)
          .sort((a, b) => a.name.localeCompare(b.name));
        this.topicStatus = this.topics.length ? '' : 'No ROS topics available';
        this.menu.refresh();
      }, fail);
    } catch (error) {
      fail(error);
    }
  }

  private add(topic: string, messageType: string, fieldPath = ''): void {
    if (
      this.config.series.length >= SERIES_LIMIT ||
      this.config.series.some(s => s.topic === topic && s.messageType === messageType && s.fieldPath === fieldPath)
    )
      return;
    const series: TimeseriesSeriesConfig = {
      id: createSeriesId(topic, fieldPath, new Set(this.config.series.map(s => s.id))),
      topic,
      messageType,
      fieldPath,
      enabled: true,
      label: '',
      unit: '',
      color: COLORS[this.config.series.length % COLORS.length],
      filter: { type: 'raw' },
      math: sanitizeMath(null),
    };
    this.commit({ ...this.config, series: [...this.config.series, series] });
  }

  private signals(): MenuPage {
    return {
      title: 'Signals',
      emptyText: 'Add a ROS topic to start plotting',
      rows: this.config.series.map(s => ({
        kind: 'button',
        label: displayName(s),
        trailing: 'chevron',
        detail: s.enabled ? 'Visible' : 'Hidden',
        onPress: () => this.menu.push(() => this.signal(s.id)),
        secondary: {
          icon: 'close',
          danger: true,
          onPress: () => this.commit({ ...this.config, series: this.config.series.filter(item => item.id !== s.id) }),
        },
      })),
    };
  }

  private signal(id: string): MenuPage {
    const s = this.config.series.find(item => item.id === id);
    if (!s) return { title: 'Signal removed', rows: [], emptyText: 'Go back to Signals' };
    const filter = s.filter;
    const fields = this.presentation.engine.discovered.get(sourceKey(s.topic, s.messageType)) ?? [];
    const rows: MenuRow[] = [
      { kind: 'toggle', label: 'Visible', value: s.enabled, onChange: enabled => this.patch(id, { enabled }) },
      {
        kind: 'button',
        label: 'Numeric field',
        detail: s.fieldPath || 'Detecting…',
        trailing: 'chevron',
        onPress: () =>
          this.menu.push(() => ({
            title: 'Numeric field',
            emptyText: 'Waiting for numeric fields from ROS',
            rows: (this.presentation.engine.discovered.get(sourceKey(s.topic, s.messageType)) ?? []).map(fieldPath => ({
              kind: 'button',
              label: fieldPath,
              onPress: () => {
                this.patch(id, { fieldPath });
                this.menu.pop();
              },
            })),
          })),
      },
      {
        kind: 'button',
        label: 'Smoothing',
        detail: filter.type === 'raw' ? 'Raw' : filter.type === 'ema' ? 'Exponential' : 'Moving average',
        onPress: () =>
          this.patch(id, {
            filter:
              filter.type === 'raw'
                ? { type: 'movingAverage', window: 10 }
                : filter.type === 'movingAverage'
                  ? { type: 'ema', alpha: 0.2 }
                  : { type: 'raw' },
          }),
      },
    ];
    if (filter.type === 'movingAverage')
      rows.push(
        this.stepper('Filter samples', filter.window, 1, 2, 500, window =>
          this.patch(id, { filter: { type: 'movingAverage', window } })
        )
      );
    if (filter.type === 'ema')
      rows.push(
        this.stepper('EMA factor', filter.alpha, 0.05, 0.01, 1, alpha =>
          this.patch(id, { filter: { type: 'ema', alpha } })
        )
      );
    rows.push(
      {
        kind: 'button',
        label: 'Signal color',
        detail: s.color,
        onPress: () =>
          this.patch(id, { color: COLORS[(COLORS.findIndex(color => color === s.color) + 1) % COLORS.length] }),
      },
      {
        kind: 'button',
        label: 'Add another field',
        trailing: 'chevron',
        disabled: !fields.length || this.config.series.length >= SERIES_LIMIT,
        onPress: () =>
          this.menu.push(() => ({
            title: 'Add another field',
            rows: fields.map(fieldPath => ({
              kind: 'button',
              label: fieldPath,
              disabled:
                this.config.series.length >= SERIES_LIMIT ||
                this.config.series.some(
                  item => item.topic === s.topic && item.messageType === s.messageType && item.fieldPath === fieldPath
                ),
              onPress: () => {
                this.add(s.topic, s.messageType, fieldPath);
                this.menu.pop();
              },
            })),
          })),
      },
      { kind: 'header', label: 'Labels and expressions: edit on desktop' }
    );
    return { title: displayName(s), rows };
  }

  private stepper(
    label: string,
    value: number,
    step: number,
    min: number,
    max: number,
    change: (n: number) => void
  ): MenuRow {
    const next = (delta: number) => change(Number(Math.max(min, Math.min(max, value + delta)).toPrecision(10)));
    return {
      kind: 'stepper',
      label,
      value: String(Number(value.toPrecision(5))),
      canDecrement: value > min,
      canIncrement: value < max,
      onDecrement: () => next(-step),
      onIncrement: () => next(step),
    };
  }

  private plot(): MenuPage {
    const c = this.config;
    const change = (patch: Partial<TimeseriesConfig>) => this.commit({ ...this.config, ...patch });
    return {
      title: 'Plot and performance',
      rows: [
        this.stepper('Window (s)', c.timeWindowSec, 5, 1, 600, timeWindowSec => change({ timeWindowSec })),
        { kind: 'toggle', label: 'Auto Y range', value: c.autoScale, onChange: autoScale => change({ autoScale }) },
        { kind: 'toggle', label: 'Point markers', value: c.showPoints, onChange: showPoints => change({ showPoints }) },
        ...(!c.autoScale
          ? [
              this.stepper('Y minimum', c.minY, 1, -1e12, c.maxY - 1, minY => change({ minY })),
              this.stepper('Y maximum', c.maxY, 1, c.minY + 1, 1e12, maxY => change({ maxY })),
            ]
          : []),
        this.stepper('Samples / signal', c.sampleLimit, 100, 100, 10000, sampleLimit => change({ sampleLimit })),
        this.stepper('Throttle (ms)', c.throttleMs, 10, 0, 2000, throttleMs => change({ throttleMs })),
        this.stepper('Refresh (Hz)', c.renderFps, 5, 5, 60, renderFps => change({ renderFps })),
      ],
    };
  }

  dispose(): void {
    this.request++;
    clearTimeout(this.timeout);
  }
}
