import type { TfTreePresentation } from '../../../features/tfTree/presentation';
import { calculateTfBetweenFrames } from '../../../features/tfTree/tfTreeCalculator';
import {
  filterTfTree,
  getTfGraphDiagnostics,
  getTransformAgeMs,
  quaternionToEulerRpy,
} from '../../../features/tfTree/tfTreeModel';
import { SpatialMenu, type MenuPage, type MenuRow } from '../../ui/SpatialMenu';

const value = (label: string, value: string): MenuRow => ({ kind: 'value', label, value });
const number = (n: number) => Number(n.toPrecision(6)).toString();

export class XrTfTreeMenu {
  private source = '';
  private target = '';

  constructor(
    readonly menu: SpatialMenu,
    private readonly p: TfTreePresentation,
    private readonly focus: (frame: string) => void
  ) {}

  open(): void {
    this.menu.open(() => this.settings());
  }
  frames(): void {
    this.menu.open(() => this.framePicker(frame => this.details(frame), true));
  }
  details(frame: string): void {
    this.menu.open(() => this.frameDetails(frame));
  }

  private settings(): MenuPage {
    const settings = this.p.settings;
    return {
      title: 'TF tree settings',
      rows: [
        {
          kind: 'toggle',
          label: 'Static transforms',
          value: settings.showStatic,
          onChange: showStatic => this.p.configure({ showStatic }),
        },
        {
          kind: 'toggle',
          label: 'Highlight stale',
          value: settings.highlightStale,
          onChange: highlightStale => this.p.configure({ highlightStale }),
        },
        {
          kind: 'button',
          label: 'Clear frame filter',
          detail: settings.filter || 'None',
          disabled: !settings.filter,
          onPress: () => this.p.configure({ filter: '' }),
        },
        {
          kind: 'button',
          label: 'Diagnostics',
          trailing: 'chevron',
          onPress: () => this.menu.push(() => this.diagnostics()),
        },
        {
          kind: 'button',
          label: 'Calculate transform',
          trailing: 'chevron',
          onPress: () => this.menu.push(() => this.calculator()),
        },
        {
          kind: 'button',
          label: 'Refresh TF',
          onPress: () =>
            this.menu.push(() => ({
              title: 'Refresh TF',
              rows: [
                value('Shared connection', 'Clears TF in every view and reloads static frames.'),
                {
                  kind: 'button',
                  label: 'Refresh now',
                  onPress: () => {
                    this.p.refresh();
                    this.menu.pop();
                  },
                },
              ],
            })),
        },
      ],
    };
  }

  private framePicker(onSelect: (frame: string) => void, visibleOnly = false): MenuPage {
    const state = visibleOnly
      ? filterTfTree(this.p.state, this.p.settings.filter, this.p.settings.showStatic)
      : this.p.state;
    return {
      title: 'Frames',
      emptyText: 'No matching frames',
      rows: [...state.knownFrames].sort().map(frame => ({
        kind: 'button',
        label: frame,
        trailing: 'chevron',
        onPress: () => onSelect(frame),
      })),
    };
  }

  private frameDetails(frame: string): MenuPage {
    if (!this.p.state.knownFrames.has(frame))
      return {
        title: 'Frame unavailable',
        rows: [value('Frame', frame)],
        emptyText: 'Refresh or choose another frame',
      };
    const transform = this.p.state.transformsByChild.get(frame);
    const children = [...this.p.state.transformsByChild.values()]
      .filter(t => t.parentFrame === frame)
      .map(t => t.childFrame)
      .sort();
    const rows: MenuRow[] = [
      value('Frame', frame),
      { kind: 'button', label: 'Focus in graph', onPress: () => this.focus(frame) },
      value('Parent', transform?.parentFrame ?? 'Root'),
      value(
        'Source / age',
        transform
          ? transform.source === 'static'
            ? '/tf_static · Static'
            : `/tf · ${(getTransformAgeMs(transform, Date.now()) / 1000).toFixed(1)} s`
          : 'Root frame'
      ),
      {
        kind: 'button',
        label: 'Transform values',
        disabled: !transform,
        trailing: 'chevron',
        onPress: () =>
          this.menu.push(() => {
            const current = this.p.state.transformsByChild.get(frame);
            return {
              title: frame,
              rows: current
                ? this.transformRows(current.translation, current.rotation)
                : [value('Status', 'Frame unavailable')],
            };
          }),
      },
      {
        kind: 'button',
        label: 'Children',
        detail: String(children.length),
        disabled: !children.length,
        trailing: 'chevron',
        onPress: () =>
          this.menu.push(() => ({
            title: 'Children',
            rows: [...this.p.state.transformsByChild.values()]
              .filter(t => t.parentFrame === frame)
              .map(t => ({
                kind: 'button',
                label: t.childFrame,
                onPress: () => this.details(t.childFrame),
              })),
          })),
      },
      {
        kind: 'button',
        label: 'Use as source',
        onPress: () => {
          this.source = frame;
          this.menu.push(() => this.calculator());
        },
      },
      {
        kind: 'button',
        label: 'Use as target',
        onPress: () => {
          this.target = frame;
          this.menu.push(() => this.calculator());
        },
      },
    ];
    return { title: 'Frame details', rows };
  }

  private transformRows(
    translation: { x: number; y: number; z: number } | null,
    rotation: { x: number; y: number; z: number; w: number } | null
  ): MenuRow[] {
    const rpy = quaternionToEulerRpy(rotation);
    return [
      ...(['x', 'y', 'z'] as const).map(axis =>
        value(`Translation ${axis.toUpperCase()} (m)`, translation ? number(translation[axis]) : 'Unavailable')
      ),
      ...(['x', 'y', 'z', 'w'] as const).map(axis =>
        value(`Quaternion ${axis.toUpperCase()}`, rotation ? number(rotation[axis]) : 'Unavailable')
      ),
      ...(['roll', 'pitch', 'yaw'] as const).map(axis =>
        value(`${axis} (rad)`, rpy ? number(rpy[axis]) : 'Unavailable')
      ),
    ];
  }

  private calculator(): MenuPage {
    const result = calculateTfBetweenFrames(this.p.state, this.source, this.target);
    return {
      title: 'Calculate transform',
      rows: [
        {
          kind: 'button',
          label: 'Source',
          detail: this.source || 'Choose',
          trailing: 'chevron',
          onPress: () =>
            this.menu.push(() =>
              this.framePicker(frame => {
                this.source = frame;
                this.menu.pop();
              })
            ),
        },
        {
          kind: 'button',
          label: 'Target',
          detail: this.target || 'Choose',
          trailing: 'chevron',
          onPress: () =>
            this.menu.push(() =>
              this.framePicker(frame => {
                this.target = frame;
                this.menu.pop();
              })
            ),
        },
        {
          kind: 'button',
          label: 'Swap frames',
          disabled: !this.source || !this.target,
          onPress: () => {
            [this.source, this.target] = [this.target, this.source];
            this.menu.refresh();
          },
        },
        ...(!result
          ? [
              value(
                'Status',
                !this.source || !this.target ? 'Choose source and target frames' : 'No valid transform path'
              ),
            ]
          : [
              {
                kind: 'button' as const,
                label: 'Transform values',
                trailing: 'chevron' as const,
                onPress: () =>
                  this.menu.push(() => {
                    const current = calculateTfBetweenFrames(this.p.state, this.source, this.target);
                    return {
                      title: 'Calculated transform',
                      rows: current
                        ? this.transformRows(current.translation, current.rotation)
                        : [value('Status', 'No valid transform path')],
                    };
                  }),
              },
              {
                kind: 'button' as const,
                label: 'Path',
                detail: `${result.path.length} frames`,
                trailing: 'chevron' as const,
                onPress: () =>
                  this.menu.push(() => ({
                    title: 'Transform path',
                    rows: (calculateTfBetweenFrames(this.p.state, this.source, this.target)?.path ?? []).map(
                      (frame, i) => value(`Frame ${i + 1}`, frame)
                    ),
                  })),
              },
            ]),
      ],
    };
  }

  private diagnostics(): MenuPage {
    const d = getTfGraphDiagnostics(this.p.state);
    return {
      title: 'TF diagnostics',
      rows: [
        value('Connected trees', String(d.components.length)),
        value('Cycles', String(d.cycles.length)),
        value('Frames with multiple parents', String(d.multipleParents.length)),
        ...d.cycles.map(
          (cycle, index): MenuRow => ({
            kind: 'button',
            label: `Cycle ${index + 1}`,
            trailing: 'chevron',
            onPress: () => this.menu.push(() => ({ title: 'Cycle', rows: cycle.map(frame => value('Frame', frame)) })),
          })
        ),
        ...d.multipleParents.map(
          (warning): MenuRow => ({
            kind: 'button',
            label: warning.childFrame,
            trailing: 'chevron',
            onPress: () =>
              this.menu.push(() => ({
                title: 'Observed parents',
                rows: warning.parentFrames.map(frame => value('Parent', frame)),
              })),
          })
        ),
      ],
    };
  }
}
