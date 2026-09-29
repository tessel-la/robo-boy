import { v4 as uuidv4 } from 'uuid';
import type { Ros } from 'roslib';
import type { MenuPage, MenuRow, SpatialMenu } from '../../ui/SpatialMenu';
import {
  TOPIC_VISUALIZATION_TYPES,
  getTopicsForVisualizationType,
  type TopicVisualizationType,
} from '../../../utils/visualizationTopics';
import type { RosTopicInfo } from '../../../utils/urdfTopics';
import type { VisualizationPanelState } from '../../../utils/visualizationState';

type Layer = VisualizationPanelState['visualizations'][number];

export const LAYER_LABELS: Record<TopicVisualizationType, string> = {
  urdf: 'Robot model',
  pointcloud: 'Point cloud',
  laserscan: 'Laser scan',
  markerarray: 'Markers',
  posestamped: 'Pose',
  camerainfo: 'Camera frustum',
};

type OptionSpec =
  | { kind: 'number'; key: string; label: string; fallback: number; step: number; min: number; max: number }
  | { kind: 'choice'; key: string; label: string; fallback: string; choices: ReadonlyArray<[string, string]> }
  | { kind: 'bool'; key: string; label: string; fallback: boolean };

/** The options worth reaching with a controller; everything else keeps the value it was given in 2D. */
export const LAYER_OPTION_SPECS: Partial<Record<TopicVisualizationType, readonly OptionSpec[]>> = {
  pointcloud: [
    { kind: 'number', key: 'pointSize', label: 'Point size', fallback: 0.05, step: 0.01, min: 0.01, max: 0.5 },
    {
      kind: 'choice',
      key: 'colorAxis',
      label: 'Colour by',
      fallback: 'none',
      choices: [['none', 'Solid'], ['x', 'X axis'], ['y', 'Y axis'], ['z', 'Height (Z)']],
    },
  ],
  laserscan: [{ kind: 'number', key: 'pointSize', label: 'Point size', fallback: 1, step: 0.25, min: 0.25, max: 5 }],
  posestamped: [
    {
      kind: 'choice',
      key: 'visualizationType',
      label: 'Shape',
      fallback: 'arrow',
      choices: [['arrow', 'Arrow'], ['axes', 'Axes']],
    },
    { kind: 'number', key: 'scale', label: 'Scale', fallback: 1, step: 0.25, min: 0.25, max: 5 },
    { kind: 'bool', key: 'trailEnabled', label: 'Trail', fallback: false },
  ],
  camerainfo: [{ kind: 'number', key: 'lineScale', label: 'Frustum size', fallback: 1, step: 0.25, min: 0.25, max: 5 }],
};

const round = (value: number): number => Math.round(value * 1000) / 1000;
const shortTopic = (topic: string): string => (topic.length > 22 ? `…${topic.slice(-21)}` : topic);

export interface Xr3dSettingsDeps {
  menu: SpatialMenu;
  ros: Ros;
  getState: () => VisualizationPanelState;
  /** Persist and apply a new state. The caller refreshes the menu afterwards. */
  commit: (next: VisualizationPanelState) => void;
  getFrameNames: () => string[];
  getFixedFrame: () => string;
}

/**
 * The 3D panel's settings, as pages of a `SpatialMenu`.
 *
 * Every action is "compute the next `VisualizationPanelState` and commit it", which is the same
 * shape the desktop panel persists — so the menu can be tested as a pure editor of state and the
 * live scene can never disagree with what is saved.
 */
export class Xr3dSettings {
  private topics: RosTopicInfo[] = [];
  private topicsLoading = false;
  private topicsFailed = false;

  constructor(private readonly deps: Xr3dSettingsDeps) {}

  open(): void {
    this.loadTopics();
    this.deps.menu.open(this.rootPage);
  }

  loadTopics(): void {
    if (this.topicsLoading) return;
    this.topicsLoading = true;
    this.topicsFailed = false;
    const finish = () => {
      this.topicsLoading = false;
      this.deps.menu.refresh();
    };
    this.deps.ros.getTopics(
      result => {
        this.topics = result.topics.map((name, index) => ({ name, type: result.types[index] ?? '' }));
        finish();
      },
      () => {
        this.topicsFailed = true;
        finish();
      }
    );
  }

  private update(mutate: (state: VisualizationPanelState) => Partial<VisualizationPanelState>): void {
    const state = this.deps.getState();
    this.deps.commit({ ...state, ...mutate(state) });
  }

  private updateLayer(id: string, mutate: (layer: Layer) => Layer): void {
    this.update(state => ({
      visualizations: state.visualizations.map(layer => (layer.id === id ? mutate(layer) : layer)),
    }));
  }

  readonly rootPage = (): MenuPage => {
    const state = this.deps.getState();
    const autoFrame = this.deps.getFixedFrame();
    return {
      title: '3D scene',
      rows: [
        {
          kind: 'button',
          label: 'Fixed frame',
          detail: state.fixedFrame || (autoFrame ? `Auto · ${autoFrame}` : 'Auto'),
          trailing: 'chevron',
          onPress: () => this.deps.menu.push(this.framePickerPage),
        },
        {
          kind: 'button',
          label: 'Layers',
          detail: String(state.visualizations.length),
          trailing: 'chevron',
          onPress: () => this.deps.menu.push(this.layersPage),
        },
        {
          kind: 'button',
          label: 'TF frames',
          detail: state.showAllTfFrames ? 'All' : String(state.displayedTfFrames.length),
          trailing: 'chevron',
          onPress: () => this.deps.menu.push(this.tfPage),
        },
      ],
    };
  };

  private readonly framePickerPage = (): MenuPage => {
    const state = this.deps.getState();
    const choose = (fixedFrame: string) => {
      this.update(() => ({ fixedFrame }));
      this.deps.menu.pop();
    };
    return {
      title: 'Fixed frame',
      rows: [
        {
          kind: 'button',
          label: 'Auto',
          trailing: state.fixedFrame === '' ? 'check' : undefined,
          onPress: () => choose(''),
        },
        ...this.deps.getFrameNames().map(
          (frame): MenuRow => ({
            kind: 'button',
            label: frame,
            trailing: state.fixedFrame === frame ? 'check' : undefined,
            onPress: () => choose(frame),
          })
        ),
      ],
    };
  };

  private readonly layersPage = (): MenuPage => {
    const state = this.deps.getState();
    return {
      title: 'Layers',
      emptyText: 'No layers yet',
      rows: [
        { kind: 'button', label: 'Add layer', trailing: 'chevron', onPress: () => this.deps.menu.push(this.addLayerPage) },
        ...state.visualizations.map(
          (layer): MenuRow => ({
            kind: 'button',
            label: LAYER_LABELS[layer.type as TopicVisualizationType] ?? layer.type,
            detail: shortTopic(layer.topic),
            trailing: 'chevron',
            onPress: () => this.deps.menu.push(() => this.layerPage(layer.id)),
            secondary: { icon: 'close', danger: true, onPress: () => this.removeLayer(layer.id) },
          })
        ),
      ],
    };
  };

  private removeLayer(id: string): void {
    this.update(state => ({ visualizations: state.visualizations.filter(layer => layer.id !== id) }));
  }

  private readonly addLayerPage = (): MenuPage => ({
    title: 'Add layer',
    rows: TOPIC_VISUALIZATION_TYPES.map(
      (type): MenuRow => ({
        kind: 'button',
        label: LAYER_LABELS[type],
        trailing: 'chevron',
        onPress: () => {
          this.loadTopics();
          this.deps.menu.push(() =>
            this.topicPage(type, topic => {
              this.update(state => ({
                visualizations: [
                  ...state.visualizations,
                  {
                    id: uuidv4(),
                    type,
                    topic,
                    options: type === 'urdf' ? { robotDescriptionTopic: topic } : {},
                  },
                ],
              }));
              // Back to the layers list, past the type page and this one.
              this.deps.menu.pop();
              this.deps.menu.pop();
            })
          );
        },
      })
    ),
  });

  private topicPage(type: TopicVisualizationType, choose: (topic: string) => void, current?: string): MenuPage {
    const compatible = getTopicsForVisualizationType(type, this.topics);
    return {
      title: `${LAYER_LABELS[type]} topic`,
      emptyText: this.topicsLoading
        ? 'Loading topics…'
        : this.topicsFailed
          ? 'Could not list topics'
          : 'No compatible topics',
      rows: compatible.map(
        (topic): MenuRow => ({
          kind: 'button',
          label: shortTopic(topic.name),
          trailing: topic.name === current ? 'check' : undefined,
          onPress: () => choose(topic.name),
        })
      ),
    };
  }

  private layerPage(id: string): MenuPage {
    const layer = this.deps.getState().visualizations.find(entry => entry.id === id);
    if (!layer) return { title: 'Layer', rows: [], emptyText: 'This layer was removed' };
    const type = layer.type as TopicVisualizationType;
    const options = (layer.options ?? {}) as Record<string, unknown>;

    const rows: MenuRow[] = [
      {
        kind: 'button',
        label: 'Topic',
        detail: shortTopic(layer.topic),
        trailing: 'chevron',
        onPress: () => {
          this.loadTopics();
          this.deps.menu.push(() =>
            this.topicPage(
              type,
              topic => {
                this.updateLayer(id, entry => ({
                  ...entry,
                  topic,
                  options: type === 'urdf' ? { ...entry.options, robotDescriptionTopic: topic } : entry.options,
                }));
                this.deps.menu.pop();
              },
              layer.topic
            )
          );
        },
      },
    ];

    for (const spec of LAYER_OPTION_SPECS[type] ?? []) {
      const set = (value: unknown) =>
        this.updateLayer(id, entry => ({ ...entry, options: { ...entry.options, [spec.key]: value } }));
      if (spec.kind === 'number') {
        const value = typeof options[spec.key] === 'number' ? (options[spec.key] as number) : spec.fallback;
        rows.push({
          kind: 'stepper',
          label: spec.label,
          value: String(round(value)),
          canDecrement: value > spec.min + 1e-9,
          canIncrement: value < spec.max - 1e-9,
          onDecrement: () => set(round(Math.max(spec.min, value - spec.step))),
          onIncrement: () => set(round(Math.min(spec.max, value + spec.step))),
        });
      } else if (spec.kind === 'bool') {
        rows.push({
          kind: 'toggle',
          label: spec.label,
          value: typeof options[spec.key] === 'boolean' ? (options[spec.key] as boolean) : spec.fallback,
          onChange: set,
        });
      } else {
        const value = typeof options[spec.key] === 'string' ? (options[spec.key] as string) : spec.fallback;
        const index = Math.max(0, spec.choices.findIndex(([choice]) => choice === value));
        rows.push({
          kind: 'button',
          label: spec.label,
          detail: spec.choices[index][1],
          onPress: () => set(spec.choices[(index + 1) % spec.choices.length][0]),
        });
      }
    }

    rows.push({
      kind: 'button',
      label: 'Remove layer',
      danger: true,
      onPress: () => {
        this.removeLayer(id);
        this.deps.menu.pop();
      },
    });
    return { title: LAYER_LABELS[type] ?? layer.type, rows };
  }

  private readonly tfPage = (): MenuPage => {
    const state = this.deps.getState();
    const scaleStepper = (
      label: string,
      key: 'tfAxesScale' | 'tfLabelScale',
      min: number,
      max: number
    ): MenuRow => ({
      kind: 'stepper',
      label,
      value: `${state[key].toFixed(2)} m`,
      canDecrement: state[key] > min + 1e-9,
      canIncrement: state[key] < max - 1e-9,
      onDecrement: () => this.update(() => ({ [key]: round(Math.max(min, state[key] / 1.25)) })),
      onIncrement: () => this.update(() => ({ [key]: round(Math.min(max, state[key] * 1.25)) })),
    });
    return {
      title: 'TF frames',
      rows: [
        {
          kind: 'toggle',
          label: 'Show all frames',
          value: state.showAllTfFrames,
          onChange: showAllTfFrames => this.update(() => ({ showAllTfFrames })),
        },
        {
          kind: 'button',
          label: 'Choose frames',
          detail: state.showAllTfFrames ? 'All shown' : String(state.displayedTfFrames.length),
          trailing: 'chevron',
          disabled: state.showAllTfFrames,
          onPress: () => this.deps.menu.push(this.frameListPage),
        },
        {
          kind: 'toggle',
          label: 'Axes',
          value: state.showTfAxes,
          onChange: showTfAxes => this.update(() => ({ showTfAxes })),
        },
        {
          kind: 'toggle',
          label: 'Names',
          value: state.showTfFrameLabels,
          onChange: showTfFrameLabels => this.update(() => ({ showTfFrameLabels })),
        },
        {
          kind: 'toggle',
          label: 'Parent links',
          value: state.showTfConnections,
          onChange: showTfConnections => this.update(() => ({ showTfConnections })),
        },
        scaleStepper('Axes size', 'tfAxesScale', 0.02, 0.5),
        scaleStepper('Name size', 'tfLabelScale', 0.02, 0.3),
      ],
    };
  };

  private readonly frameListPage = (): MenuPage => {
    const state = this.deps.getState();
    const shown = new Set(state.displayedTfFrames);
    return {
      title: 'Choose frames',
      emptyText: 'No TF frames yet',
      rows: this.deps.getFrameNames().map(
        (frame): MenuRow => ({
          kind: 'toggle',
          label: frame,
          value: shown.has(frame),
          onChange: on => {
            const next = new Set(shown);
            if (on) next.add(frame);
            else next.delete(frame);
            this.update(() => ({ displayedTfFrames: [...next] }));
          },
        })
      ),
    };
  };
}
