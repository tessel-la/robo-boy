import * as THREE from 'three';
import type { PadPresentation } from '../../../features/customGamepad/presentation';
import type {
  CustomGamepadLayout,
  GamepadComponentConfig,
  PadComponentType,
  PhysicalGamepadControlId,
  ROSTopicConfig,
} from '../../../features/customGamepad/types';
import {
  PHYSICAL_GAMEPAD_CONTROLS,
  DEFAULT_PHYSICAL_GAMEPAD_PUBLISH_HZ,
  getPhysicalGamepadControlLabel,
} from '../../../features/customGamepad/physicalGamepad';
import { componentLibrary, createComponent } from '../../../features/customGamepad/defaultLayouts';
import { generateGamepadId, getGamepadLayout } from '../../../features/customGamepad/gamepadStorage';
import { fitNewComponent, occupiedExtent, resizeWithin } from '../../../features/customGamepad/padGeometry';
import { SpatialMenu, type MenuPage, type MenuRow } from '../../ui/SpatialMenu';
import { SpatialSurface, type SurfaceItem } from '../../ui/SpatialSurface';
import { XR_THEME, drawText, fillRoundRect } from '../../ui/canvasKit';
import {
  defaultControlPose,
  padGridDestination,
  padPoseKey,
  readPadPoses,
  snapPadPose,
  type PadPoses,
} from './padSpatialLayout';
import type { RosOperation } from '../../../utils/rosOperations';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
type ComponentOptions = NonNullable<GamepadComponentConfig['config']>;
// Expose the options used by the existing control handlers. Unknown/pre-existing options are kept too.
const OPTION_DEFAULTS: Partial<Record<PadComponentType, ComponentOptions>> = {
  joystick: {
    min: -1,
    max: 1,
    axes: ['0', '1'],
    axisScales: [1, 1],
    twistStampedFrameId: '',
    poseStampedFrameId: '',
    poseStampedReferenceMode: 'frame',
    poseStampedReferenceFrameId: '',
    poseStampedOdometryTopic: '',
  },
  button: { momentary: true, buttonIndex: 0, messagePath: 'data', pressedValue: 1, releasedValue: 0 },
  dpad: { buttonMapping: { up: 0, right: 1, down: 2, left: 3 }, min: -1, max: 1 },
  slider: { min: -1, max: 1, step: 0.1, orientation: 'horizontal' },
  'physical-gamepad': {
    physicalGamepadProfile: 'auto',
    physicalGamepadIndex: 0,
    physicalGamepadDeadzone: 0.08,
    physicalGamepadPublishHz: DEFAULT_PHYSICAL_GAMEPAD_PUBLISH_HZ,
    physicalGamepadBindings: {},
  },
  setpoint: { min: 0, max: 100, step: 1, decimals: 1, unit: '', sendOnChange: false },
  camera: { cameraTransport: 'ros', streamWidth: 640, streamHeight: 480 },
  plot: { fieldPaths: ['data'], timeWindowSec: 10, sampleLimit: 1000, autoScale: true, minY: 0, maxY: 1 },
  heartbeat: { heartbeatMode: 'boolean', heartbeatTimeoutMs: 3000, heartbeatFieldPath: 'data' },
};
const VALUE_DEFAULTS: ComponentOptions = {
  min: 0,
  max: 100,
  decimals: 1,
  unit: '',
  scale: 1,
  offset: 0,
  staleAfterMs: 0,
};
const friendly = (key: string) =>
  key
    .replace(/^physicalGamepad/, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase());

/** Immersive draft editor. It owns no publishers and writes nothing until Save. */
export class XrPadEditor {
  readonly keyboard: SpatialSurface;
  layout: CustomGamepadLayout | null = null;
  poses: PadPoses = {};
  selected: string | null = null;
  private source: PadPresentation | null = null;
  private sourceSignature = '';
  private createsLayout = false;
  private input: { label: string; text: string; commit: (text: string) => void } | null = null;
  private symbols = false;
  private shift = false;
  private error = '';
  private disposed = false;

  constructor(
    readonly menu: SpatialMenu,
    private readonly scope: string | undefined,
    private readonly presentation: () => PadPresentation | null,
    private readonly snapshot: () => PadPoses,
    private readonly changed: () => void
  ) {
    this.keyboard = new SpatialSurface({
      width: 0.56,
      height: 0.3,
      pixelsPerMetre: 1600,
      drawBackground: (ctx, w, h) => fillRoundRect(ctx, 0, 0, w, h, 24, XR_THEME.surface),
    });
    this.keyboard.mesh.name = 'xr-pad-keyboard';
    this.keyboard.mesh.position.set(0, -menu.height / 2 - 0.18, 0.02);
    this.keyboard.mesh.visible = false;
    menu.object.add(this.keyboard.mesh);
  }

  get editing() {
    return this.layout !== null;
  }

  begin(fresh = false) {
    const source = this.presentation();
    if (!source?.layout || !source.saveLayout) return;
    this.source = source;
    this.sourceSignature = JSON.stringify(source.layout);
    this.createsLayout = fresh || Boolean(source.isDefault);
    const now = new Date().toISOString();
    this.layout = fresh
      ? {
          id: generateGamepadId('xr-pad'),
          name: 'New Pad',
          gridSize: { width: 8, height: 4 },
          cellSize: 80,
          components: [],
          rosConfig: { defaultTopic: '/joy', defaultMessageType: 'sensor_msgs/Joy' },
          metadata: { created: now, modified: now, version: '1.0.0' },
        }
      : copy(source.layout);
    this.poses = fresh ? (Object.create(null) as PadPoses) : readPadPoses(source.layout.id, this.scope);
    if (!fresh && source.isDefault) {
      this.layout.id = generateGamepadId(`${source.layout.name}-copy`);
      this.layout.name = `${source.layout.name} copy`;
      this.layout.metadata.created = now;
    }
    this.selected = null;
    this.error = '';
    source.setEditing?.(true);
    this.changed();
    this.menu.open(() => this.home());
  }

  cancel() {
    this.input = null;
    this.keyboard.mesh.visible = false;
    this.layout = null;
    this.selected = null;
    this.poses = {};
    this.source?.setEditing?.(false);
    this.source = null;
    this.menu.close();
    this.changed();
  }

  save() {
    if (!this.layout || !this.source) return;
    if (this.input) {
      try {
        this.input.commit(this.input.text);
        this.input = null;
        this.keyboard.mesh.visible = false;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Invalid value';
        this.drawKeyboard();
        return;
      }
    }
    if (this.presentation() !== this.source || JSON.stringify(this.source.layout) !== this.sourceSignature) {
      this.error = 'Layout changed. Cancel and reopen the editor.';
      this.menu.open(() => this.home());
      return;
    }
    this.poses = this.snapshot();
    const layout = {
      ...this.layout,
      // Another open designer may have saved a copy with this id while our draft was open.
      id: this.createsLayout && getGamepadLayout(this.layout.id) ? generateGamepadId(this.layout.name) : this.layout.id,
      metadata: { ...this.layout.metadata, modified: new Date().toISOString() },
    };
    const key = padPoseKey(layout.id, this.scope);
    let previous: string | null = null;
    try {
      previous = localStorage.getItem(key);
      localStorage.setItem(key, JSON.stringify(this.poses));
      if (!this.source.saveLayout?.(layout)) {
        previous === null ? localStorage.removeItem(key) : localStorage.setItem(key, previous);
        this.error = 'Could not save. Your draft is still open.';
        this.menu.open(() => this.home());
        return;
      }
    } catch {
      // If the library commit failed after writing placements, restore their previous version.
      try {
        previous === null ? localStorage.removeItem(key) : localStorage.setItem(key, previous);
      } catch {
        /* storage unavailable */
      }
      this.error = 'Storage is full or unavailable. Your draft is still open.';
      this.menu.open(() => this.home());
      return;
    }
    this.cancel();
  }

  private mutate(fn: (layout: CustomGamepadLayout) => CustomGamepadLayout) {
    if (!this.layout) return;
    this.poses = this.snapshot();
    this.layout = fn(this.layout);
    this.error = '';
    this.changed();
    this.menu.refresh();
  }

  select(id: string) {
    if (!this.layout || this.input) return;
    this.selected = id;
    this.menu.open(() => this.componentPage());
  }

  private text(label: string, value: string, commit: (text: string) => void) {
    this.input = { label, text: value, commit };
    this.error = '';
    this.drawKeyboard();
  }

  private drawKeyboard() {
    const input = this.input;
    this.keyboard.mesh.visible = Boolean(input);
    if (!input) return;
    const w = this.keyboard.pixelWidth,
      h = this.keyboard.pixelHeight;
    const items: SurfaceItem[] = [
      {
        id: 'input',
        x: 12,
        y: 10,
        w: w - 24,
        h: 90,
        draw: ctx => {
          drawText(ctx, input.label, 16, 30, w - 32, { size: 24, color: XR_THEME.textMuted });
          drawText(ctx, this.error || input.text.slice(-70) || ' ', 16, 67, w - 32, {
            size: 26,
            color: this.error ? XR_THEME.danger : XR_THEME.text,
          });
        },
      },
    ];
    const rows = this.symbols ? ['1234567890', '[]{}:/._-,', '"=+!?@()%\\'] : ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
    const button = (id: string, label: string, x: number, y: number, width: number, action: () => void) => {
      items.push({
        id,
        x,
        y,
        w: width - 6,
        h: 72,
        draw: (ctx, item, state) => {
          fillRoundRect(ctx, item.x, item.y, item.w, item.h, 9, state.hover ? XR_THEME.itemHover : XR_THEME.item);
          drawText(ctx, label, item.x + item.w / 2, item.y + item.h / 2, item.w - 6, { size: 27, align: 'center' });
        },
        onPress: () => {
          action();
          this.drawKeyboard();
        },
      });
    };
    rows.forEach((row, r) =>
      [...row].forEach((char, col) => {
        const shown = this.shift ? char.toUpperCase() : char;
        button(`key-${char}`, shown, 12 + (col * (w - 24)) / row.length, 112 + r * 79, (w - 24) / row.length, () => {
          if (input.text.length < 8192) input.text += shown;
          this.error = '';
        });
      })
    );
    const actions: [string, string, () => void][] = [
      [
        'symbols',
        this.symbols ? 'ABC' : '123',
        () => {
          this.symbols = !this.symbols;
        },
      ],
      [
        'shift',
        'Shift',
        () => {
          this.shift = !this.shift;
        },
      ],
      [
        'space',
        'Space',
        () => {
          input.text += ' ';
        },
      ],
      [
        'backspace',
        '⌫',
        () => {
          input.text = input.text.slice(0, -1);
        },
      ],
      [
        'clear',
        'Clear',
        () => {
          input.text = '';
        },
      ],
      [
        'cancel-input',
        'Cancel',
        () => {
          this.input = null;
        },
      ],
      [
        'apply-input',
        'Apply',
        () => {
          try {
            input.commit(input.text);
            this.input = null;
            this.error = '';
            this.menu.refresh();
          } catch (error) {
            this.error = error instanceof Error ? error.message : 'Invalid value';
          }
        },
      ],
    ];
    actions.forEach(([id, label, action], index) =>
      button(id, label, 12 + (index * (w - 24)) / actions.length, h - 84, (w - 24) / actions.length, action)
    );
    this.keyboard.setItems(items);
  }

  designerPage(): MenuPage {
    return this.home();
  }

  sourceChanged() {
    this.error = 'Layout changed elsewhere. Cancel and reopen before saving.';
    this.menu.open(() => this.home());
  }

  private home(): MenuPage {
    const layout = this.layout!;
    const extent = occupiedExtent(layout.components);
    const gridRow = (axis: 'width' | 'height'): MenuRow => ({
      kind: 'stepper',
      label: `2D grid ${axis}`,
      value: String(layout.gridSize[axis]),
      canDecrement: layout.gridSize[axis] > extent[axis],
      canIncrement: layout.gridSize[axis] < 24,
      onDecrement: () =>
        this.mutate(l => ({ ...l, gridSize: { ...l.gridSize, [axis]: Math.max(extent[axis], l.gridSize[axis] - 1) } })),
      onIncrement: () => this.mutate(l => ({ ...l, gridSize: { ...l.gridSize, [axis]: l.gridSize[axis] + 1 } })),
    });
    return {
      title: 'Pad designer',
      rows: [
        {
          kind: 'value',
          label: 'Editing · commands disabled',
          value: this.error || 'Grip to move / resize · drop on green grid cells',
        },
        {
          kind: 'button',
          label: 'Name',
          detail: layout.name,
          onPress: () =>
            this.text('Pad name', layout.name, name => {
              if (!name.trim()) throw new Error('Enter a name');
              this.mutate(l => ({ ...l, name: name.trim() }));
            }),
        },
        {
          kind: 'button',
          label: 'Add component',
          trailing: 'chevron',
          onPress: () => this.menu.push(() => this.palette()),
        },
        {
          kind: 'button',
          label: 'Components',
          detail: `${layout.components.length} objects`,
          onPress: () =>
            this.menu.push(() => ({
              title: 'Components',
              rows: this.layout!.components.map(c => ({
                kind: 'button',
                label: c.label || c.type,
                onPress: () => this.select(c.id),
              })),
            })),
        },
        gridRow('width'),
        gridRow('height'),
        { kind: 'button', label: 'Save Pad', onPress: () => this.save() },
        { kind: 'button', label: 'Cancel changes', onPress: () => this.cancel() },
      ],
    };
  }

  palette(): MenuPage {
    return {
      title: 'Add component',
      rows: componentLibrary.map(item => ({
        kind: 'button',
        label: item.name,
        detail: item.description,
        onPress: () => {
          const layout = this.layout!;
          const position = fitNewComponent(
            item.defaultSize,
            layout.gridSize,
            layout.components.map(c => c.position)
          );
          if (!position) {
            this.error = 'Grid is full. Increase its size or remove a component.';
            this.menu.open(() => this.home());
            return;
          }
          const poses = this.snapshot();
          const spatialPosition = fitNewComponent(
            position,
            layout.gridSize,
            layout.components.map(
              c => padGridDestination(layout, c, poses[c.id] ?? defaultControlPose(layout, c.position)).rect
            )
          );
          if (!spatialPosition) {
            this.error = 'XR grid has no room. Move a control or increase the grid size.';
            this.menu.open(() => this.home());
            return;
          }
          const component = createComponent(
            item.type,
            {
              ...position,
              width: spatialPosition.width,
              height: spatialPosition.height,
            },
            `${item.type}-${crypto.randomUUID()}`
          )!;
          this.mutate(l => {
            this.poses[component.id] = defaultControlPose(l, spatialPosition);
            return { ...l, components: [...l.components, component] };
          });
          this.select(component.id);
        },
      })),
    };
  }

  private updateComponent(update: (component: GamepadComponentConfig) => GamepadComponentConfig) {
    const layout = this.layout!;
    const component = update(layout.components.find(c => c.id === this.selected)!);
    const next = { ...layout, components: layout.components.map(c => (c.id === component.id ? component : c)) };
    const poses = this.snapshot();
    const pose = snapPadPose(next, component, poses[component.id], poses);
    if (!pose) {
      this.error = 'No room for that size in the XR grid. Move a control first.';
      this.menu.open(() => this.home());
      return;
    }
    this.mutate(() => {
      this.poses[component.id] = pose;
      return next;
    });
  }

  private componentPage(): MenuPage {
    const c = this.layout!.components.find(component => component.id === this.selected);
    if (!c) return this.home();
    const sizeRow = (axis: 'width' | 'height'): MenuRow => {
      const next = (delta: number) =>
        resizeWithin(
          c.position,
          axis === 'width' ? 'e' : 's',
          axis === 'width' ? delta : 0,
          axis === 'height' ? delta : 0,
          this.layout!.gridSize,
          this.layout!.components.filter(other => other.id !== c.id).map(other => other.position)
        );
      return {
        kind: 'stepper',
        label: `Block ${axis}`,
        value: `${c.position[axis]} cells`,
        canDecrement: c.position[axis] > 1,
        canIncrement: next(1)[axis] > c.position[axis],
        onDecrement: () => this.updateComponent(value => ({ ...value, position: next(-1) })),
        onIncrement: () => this.updateComponent(value => ({ ...value, position: next(1) })),
      };
    };
    return {
      title: c.label || c.type,
      rows: [
        {
          kind: 'button',
          label: 'Label',
          detail: c.label || c.type,
          onPress: () =>
            this.text('Component label', c.label || '', label => this.updateComponent(v => ({ ...v, label }))),
        },
        { kind: 'button', label: 'ROS source / command', onPress: () => this.menu.push(() => this.actionPage()) },
        { kind: 'button', label: 'Control settings', onPress: () => this.menu.push(() => this.optionsPage()) },
        ...(c.type === 'button' || c.type === 'toggle'
          ? [
              {
                kind: 'button' as const,
                label: 'Event operations',
                onPress: () => this.menu.push(() => this.eventsPage()),
              },
            ]
          : []),
        ...(c.type === 'physical-gamepad'
          ? [
              {
                kind: 'button' as const,
                label: 'Button bindings',
                onPress: () => this.menu.push(() => this.bindingsPage()),
              },
            ]
          : []),
        sizeRow('width'),
        sizeRow('height'),
        {
          kind: 'button',
          label: 'Color',
          detail: c.style?.color || XR_THEME.accent,
          onPress: () =>
            this.menu.push(() => ({
              title: 'Color',
              rows: [XR_THEME.accent, XR_THEME.success, XR_THEME.danger, '#d9b65d', '#ad8be8', XR_THEME.text].map(
                color => ({
                  kind: 'button',
                  label: color,
                  onPress: () => {
                    this.updateComponent(v => ({ ...v, style: { ...v.style, color } }));
                    this.menu.pop();
                  },
                })
              ),
            })),
        },
        {
          kind: 'button',
          label: 'Reset spatial placement',
          onPress: () => {
            this.poses = this.snapshot();
            const reset = snapPadPose(this.layout!, c, defaultControlPose(this.layout!, c.position), this.poses);
            if (!reset) {
              this.error = 'Original grid position is occupied. Move that control first.';
              this.menu.open(() => this.home());
              return;
            }
            this.poses[c.id] = reset;
            this.changed();
          },
        },
        {
          kind: 'button',
          label: 'Remove component',
          danger: true,
          onPress: () => {
            this.mutate(l => ({ ...l, components: l.components.filter(v => v.id !== c.id) }));
            delete this.poses[c.id];
            this.selected = null;
            this.menu.open(() => this.home());
          },
        },
        { kind: 'button', label: 'Back to designer', onPress: () => this.menu.open(() => this.home()) },
      ],
    };
  }

  private actionPage(): MenuPage {
    const c = this.layout!.components.find(v => v.id === this.selected)!;
    const action = c.action as ROSTopicConfig | undefined;
    return {
      title: 'ROS source / command',
      rows: (['topic', 'messageType', 'field'] as const).map(key => ({
        kind: 'button',
        label: key === 'messageType' ? 'Message type' : friendly(key),
        detail: action?.[key] || 'Unset',
        onPress: () =>
          this.text(friendly(key), action?.[key] || '', text =>
            this.updateComponent(v => ({
              ...v,
              action: {
                topic: action?.topic || '',
                messageType: action?.messageType || '',
                field: action?.field,
                [key]: text.trim(),
              },
            }))
          ),
      })),
    };
  }

  private optionsPage(): MenuPage {
    const c = this.layout!.components.find(v => v.id === this.selected)!;
    const defaults =
      OPTION_DEFAULTS[c.type] ??
      (['gauge', 'level', 'readout', 'state', 'text'].includes(c.type) ? VALUE_DEFAULTS : {});
    const options = { ...defaults, ...c.config };
    return {
      title: 'Control settings',
      rows: Object.entries(options)
        .filter(([key]) => key !== 'physicalGamepadBindings')
        .map(([key, value]): MenuRow => {
          const change = (next: unknown) => this.updateComponent(v => ({ ...v, config: { ...v.config, [key]: next } }));
          if (typeof value === 'boolean') return { kind: 'toggle', label: friendly(key), value, onChange: change };
          const choices: Record<string, string[]> = {
            orientation: ['horizontal', 'vertical'],
            physicalGamepadProfile: ['auto', 'xbox', 'playstation', 'logitech'],
            cameraTransport: ['ros', 'proxy'],
            heartbeatMode: ['boolean', 'pulse'],
            poseStampedReferenceMode: ['frame', 'tf', 'odometry'],
          };
          if (choices[key])
            return {
              kind: 'button',
              label: friendly(key),
              detail: String(value),
              onPress: () =>
                this.menu.push(() => ({
                  title: friendly(key),
                  rows: choices[key].map(choice => ({
                    kind: 'button',
                    label: choice,
                    trailing: choice === value ? 'check' : undefined,
                    onPress: () => {
                      change(choice);
                      this.menu.pop();
                    },
                  })),
                })),
            };
          return {
            kind: 'button',
            label: friendly(key),
            detail: typeof value === 'string' ? value || 'Unset' : JSON.stringify(value),
            onPress: () =>
              this.text(friendly(key), typeof value === 'string' ? value : JSON.stringify(value), text => {
                const next = typeof value === 'string' ? text : JSON.parse(text);
                if (typeof value === 'number' && (typeof next !== 'number' || !Number.isFinite(next)))
                  throw new Error('Enter a finite number');
                if (Array.isArray(value) && !Array.isArray(next)) throw new Error('Enter an array');
                if (key === 'axes' && !next.every((axis: unknown) => typeof axis === 'string'))
                  throw new Error('Axes must be strings');
                if (key === 'axisScales' && !next.every(Number.isFinite))
                  throw new Error('Scales must be finite numbers');
                if (
                  value &&
                  typeof value === 'object' &&
                  !Array.isArray(value) &&
                  (!next || typeof next !== 'object' || Array.isArray(next))
                )
                  throw new Error('Enter an object');
                if ((key === 'physicalGamepadIndex' || key === 'buttonIndex') && (!Number.isInteger(next) || next < 0))
                  throw new Error('Use a non-negative integer');
                if (key === 'physicalGamepadDeadzone' && (next < 0 || next >= 1))
                  throw new Error('Use a value from 0 to less than 1');
                if (key === 'physicalGamepadPublishHz' && (next < 1 || next > 60)) throw new Error('Use 1 to 60 Hz');
                if (key === 'step' && next <= 0) throw new Error('Step must be positive');
                if (key === 'min' && typeof options.max === 'number' && next >= options.max)
                  throw new Error('Minimum must be below maximum');
                if (key === 'max' && typeof options.min === 'number' && next <= options.min)
                  throw new Error('Maximum must be above minimum');
                change(next);
              }),
          };
        }),
      emptyText: 'No additional settings',
    };
  }

  private eventsPage(): MenuPage {
    const c = this.layout!.components.find(v => v.id === this.selected)!;
    const events = c.type === 'toggle' ? (['on', 'off'] as const) : (['press', 'release'] as const);
    return {
      title: 'Event operations',
      rows: events.map(event => ({
        kind: 'button',
        label: friendly(event),
        detail: c.eventOperations?.[event]?.name || 'Default command',
        onPress: () => this.menu.push(() => this.operationPage(event)),
      })),
    };
  }

  private bindingsPage(): MenuPage {
    const c = this.layout!.components.find(v => v.id === this.selected)!;
    const profile = c.config?.physicalGamepadProfile === 'auto' ? 'xbox' : (c.config?.physicalGamepadProfile ?? 'xbox');
    return {
      title: 'Gamepad bindings',
      rows: PHYSICAL_GAMEPAD_CONTROLS.map(({ id }) => ({
        kind: 'button',
        label: getPhysicalGamepadControlLabel(id, profile),
        detail: id,
        onPress: () =>
          this.menu.push(() => ({
            title: getPhysicalGamepadControlLabel(id, profile),
            rows: (['press', 'release'] as const).map(event => ({
              kind: 'button',
              label: friendly(event),
              detail: c.config?.physicalGamepadBindings?.[id]?.[event]?.name || 'Unbound',
              onPress: () => this.menu.push(() => this.operationPage(event, id)),
            })),
          })),
      })),
    };
  }

  private operationPage(event: 'on' | 'off' | 'press' | 'release', controlId?: PhysicalGamepadControlId): MenuPage {
    const c = this.layout!.components.find(v => v.id === this.selected)!;
    const bindingEvent = event as 'press' | 'release';
    const op = controlId ? c.config?.physicalGamepadBindings?.[controlId]?.[bindingEvent] : c.eventOperations?.[event];
    const change = (value: RosOperation | undefined) =>
      this.updateComponent(v =>
        controlId
          ? {
              ...v,
              config: {
                ...v.config,
                physicalGamepadBindings: {
                  ...v.config?.physicalGamepadBindings,
                  [controlId]: { ...v.config?.physicalGamepadBindings?.[controlId], [bindingEvent]: value },
                },
              },
            }
          : { ...v, eventOperations: { ...v.eventOperations, [event]: value } }
      );
    const current: RosOperation = op ?? { kind: 'topic', name: '', messageType: '', payload: {} };
    return {
      title: `${friendly(event)} operation`,
      rows: [
        {
          kind: 'button',
          label: 'Kind',
          detail: op?.kind || 'Default',
          onPress: () =>
            this.menu.push(() => ({
              title: 'Operation kind',
              rows: (['topic', 'service', 'action'] as const).map(kind => ({
                kind: 'button',
                label: friendly(kind),
                onPress: () => {
                  change({ ...current, kind });
                  this.menu.pop();
                },
              })),
            })),
        },
        ...(['name', 'messageType'] as const).map(key => ({
          kind: 'button' as const,
          label: friendly(key),
          detail: current[key],
          onPress: () => this.text(friendly(key), current[key], text => change({ ...current, [key]: text.trim() })),
        })),
        {
          kind: 'button',
          label: 'Message payload',
          detail: JSON.stringify(current.payload || {}),
          onPress: () =>
            this.text('Message payload', JSON.stringify(current.payload || {}), text => {
              const payload: unknown = JSON.parse(text);
              if (!payload || typeof payload !== 'object' || Array.isArray(payload))
                throw new Error('Enter a JSON object');
              change({ ...current, payload: payload as Record<string, unknown> });
            }),
        },
        {
          kind: 'button',
          label: controlId ? 'Clear binding' : 'Use default command',
          onPress: () => change(undefined),
        },
      ],
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.source?.setEditing?.(false);
    this.layout = null;
    this.keyboard.dispose();
  }
}
