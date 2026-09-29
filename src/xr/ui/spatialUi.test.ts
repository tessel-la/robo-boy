import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { stubCanvasContext } from './canvasStub';
import type { XrInputTarget } from '../XrInputManager';
import { SpatialMenu, type MenuPage } from './SpatialMenu';
import { SpatialSurface } from './SpatialSurface';
import { SpatialToolbar } from './SpatialToolbar';
import { SurfaceInteraction } from './SurfaceInteraction';

beforeAll(stubCanvasContext);

const noDraw = () => undefined;

/** A hit on a surface at the centre of one of its items. */
const hitItem = (surface: SpatialSurface, id: string): XrInputTarget => {
  const item = surface.getItem(id);
  if (!item) throw new Error(`no item ${id}`);
  return {
    object: surface.mesh,
    uv: new THREE.Vector2(
      (item.x + item.w / 2) / surface.pixelWidth,
      1 - (item.y + item.h / 2) / surface.pixelHeight
    ),
  } as unknown as XrInputTarget;
};

const press = (surface: SpatialSurface, id: string) => new SurfaceInteraction().activate(hitItem(surface, id));

describe('SpatialSurface', () => {
  it('resolves uv to the topmost pressable item and ignores decorative ones', () => {
    const surface = new SpatialSurface({ width: 0.2, height: 0.1, pixelsPerMetre: 1000 });
    const low = vi.fn();
    const high = vi.fn();
    surface.setItems([
      { id: 'deco', x: 0, y: 0, w: 200, h: 100, draw: noDraw },
      { id: 'low', x: 0, y: 0, w: 100, h: 100, draw: noDraw, onPress: low },
      { id: 'high', x: 50, y: 0, w: 100, h: 100, draw: noDraw, onPress: high },
    ]);
    expect(surface.itemAt(new THREE.Vector2(0.1, 0.5))?.id).toBe('low');
    expect(surface.itemAt(new THREE.Vector2(0.3, 0.5))?.id).toBe('high');
    expect(surface.itemAt(new THREE.Vector2(0.95, 0.5))).toBeNull();
    expect(surface.itemAt(null)).toBeNull();
    surface.dispose();
  });

  it('flips v so uv origin is bottom-left', () => {
    const surface = new SpatialSurface({ width: 0.2, height: 0.1, pixelsPerMetre: 1000 });
    surface.setItems([{ id: 'top', x: 0, y: 0, w: 200, h: 20, draw: noDraw, onPress: noDraw }]);
    expect(surface.itemAt(new THREE.Vector2(0.5, 0.95))?.id).toBe('top');
    expect(surface.itemAt(new THREE.Vector2(0.5, 0.05))).toBeNull();
    surface.dispose();
  });

  it('redraws for hover only when the highlighted item changes, per pointer', () => {
    const surface = new SpatialSurface({ width: 0.2, height: 0.1, pixelsPerMetre: 1000 });
    surface.setItems([{ id: 'a', x: 0, y: 0, w: 10, h: 10, draw: noDraw, onPress: noDraw }]);
    const redraw = vi.spyOn(surface, 'redraw');
    surface.setHover('p1', 'a');
    surface.setHover('p1', 'a');
    expect(redraw).toHaveBeenCalledTimes(1);
    surface.clearHover('p1');
    expect(redraw).toHaveBeenCalledTimes(2);
    surface.dispose();
  });
});

describe('SurfaceInteraction', () => {
  const build = () => {
    const surface = new SpatialSurface({ width: 0.2, height: 0.1, pixelsPerMetre: 1000 });
    const onPress = vi.fn();
    const onOff = vi.fn();
    surface.setItems([
      { id: 'on', x: 0, y: 0, w: 100, h: 100, draw: noDraw, onPress },
      { id: 'off', x: 100, y: 0, w: 100, h: 100, draw: noDraw, onPress: onOff, disabled: true },
    ]);
    return { surface, onPress, onOff, interaction: new SurfaceInteraction() };
  };

  it('identifies controls, and treats margins and disabled controls as no target', () => {
    const { surface, interaction } = build();
    expect(interaction.getActivationTarget(hitItem(surface, 'on'))).toBe(`${surface.uid}:on`);
    expect(interaction.getActivationTarget(hitItem(surface, 'off'))).toBeNull();
    expect(
      interaction.getActivationTarget({ object: surface.mesh, uv: null } as unknown as XrInputTarget)
    ).toBeNull();
    expect(
      interaction.getActivationTarget({ object: new THREE.Mesh(), uv: null } as unknown as XrInputTarget)
    ).toBeNull();
  });

  it('activates enabled items, swallows disabled ones, and ignores non-surfaces', () => {
    const { surface, onPress, onOff, interaction } = build();
    expect(interaction.activate(hitItem(surface, 'on'))).toBe(true);
    expect(onPress).toHaveBeenCalledOnce();
    expect(interaction.activate(hitItem(surface, 'off'))).toBe(true);
    expect(onOff).not.toHaveBeenCalled();
    expect(interaction.activate({ object: new THREE.Mesh() } as unknown as XrInputTarget)).toBe(false);
  });

  it('clears the previous surface highlight when a pointer moves on or off', () => {
    const { surface, interaction } = build();
    const other = new SpatialSurface({ width: 0.2, height: 0.1, pixelsPerMetre: 1000 });
    other.setItems([{ id: 'x', x: 0, y: 0, w: 100, h: 100, draw: noDraw, onPress: noDraw }]);
    const clear = vi.spyOn(surface, 'clearHover');
    interaction.hover('p', hitItem(surface, 'on'));
    interaction.hover('p', hitItem(other, 'x'));
    expect(clear).toHaveBeenCalledWith('p');
    const clearOther = vi.spyOn(other, 'clearHover');
    interaction.hover('p', null);
    expect(clearOther).toHaveBeenCalledWith('p');
    interaction.hover('q', hitItem(surface, 'on'));
    interaction.dispose();
    expect(clear).toHaveBeenCalledWith('q');
  });
});

describe('SpatialToolbar', () => {
  it('lays out one pressable item per button and honours disabled', () => {
    const toolbar = new SpatialToolbar(0.9);
    const a = vi.fn();
    const b = vi.fn();
    toolbar.setButtons([
      { id: 'a', icon: 'fit', label: 'A', onPress: a },
      { id: 'b', icon: 'fit', label: 'B', onPress: b, disabled: true },
    ]);
    const interaction = new SurfaceInteraction();
    interaction.activate(hitItem(toolbar.surface, 'a'));
    interaction.activate(hitItem(toolbar.surface, 'b'));
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    const first = toolbar.surface.getItem('a')!;
    const second = toolbar.surface.getItem('b')!;
    expect(first.x + first.w).toBeLessThan(second.x);
    toolbar.dispose();
  });
});

describe('SpatialMenu', () => {
  const rows = (count: number, onPress = vi.fn()) =>
    Array.from({ length: count }, (_, index) => ({
      kind: 'button' as const,
      label: `Row ${index}`,
      onPress: () => onPress(index),
    }));

  it('is closed until opened and reports close through the callback once', () => {
    const onClose = vi.fn();
    const menu = new SpatialMenu({ onClose });
    expect(menu.isOpen).toBe(false);
    menu.open(() => ({ title: 'Root', rows: [] }));
    expect(menu.isOpen).toBe(true);
    press(menu.surface, 'close');
    menu.close();
    expect(menu.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    menu.dispose();
  });

  it('pages rows and disables the ends of the pager', () => {
    const onPress = vi.fn();
    const menu = new SpatialMenu({ pageSize: 2 });
    menu.open(() => ({ title: 'T', rows: rows(5, onPress) }));
    expect(menu.surface.getItem('prev')?.disabled).toBe(true);
    expect(menu.surface.getItem('next')?.disabled).toBe(false);
    press(menu.surface, 'row-1');
    expect(onPress).toHaveBeenLastCalledWith(1);
    press(menu.surface, 'next');
    press(menu.surface, 'row-0');
    expect(onPress).toHaveBeenLastCalledWith(2);
    press(menu.surface, 'next');
    expect(menu.surface.getItem('next')?.disabled).toBe(true);
    press(menu.surface, 'row-0');
    expect(onPress).toHaveBeenLastCalledWith(4);
    expect(menu.surface.getItem('row-1')).toBeNull();
    menu.dispose();
  });

  it('shows the empty text and no pager for an empty page', () => {
    const menu = new SpatialMenu({ pageSize: 2 });
    menu.open(() => ({ title: 'T', rows: [], emptyText: 'Nothing' }));
    expect(menu.surface.getItem('empty')).not.toBeNull();
    expect(menu.surface.getItem('prev')).toBeNull();
    menu.dispose();
  });

  it('navigates with push and back, keeping the root at the bottom of the stack', () => {
    const menu = new SpatialMenu();
    menu.open(() => ({ title: 'Root', rows: [] }));
    expect(menu.surface.getItem('back')).toBeNull();
    menu.push(() => ({ title: 'Child', rows: [] }));
    expect(menu.surface.getItem('back')).not.toBeNull();
    press(menu.surface, 'back');
    expect(menu.surface.getItem('back')).toBeNull();
    menu.pop();
    expect(menu.isOpen).toBe(true);
    menu.dispose();
  });

  it('re-reads the page factory on refresh and clamps a stale page index', () => {
    let count = 5;
    const menu = new SpatialMenu({ pageSize: 2 });
    menu.open(() => ({ title: 'T', rows: rows(count) }));
    press(menu.surface, 'next');
    press(menu.surface, 'next');
    count = 1;
    menu.refresh();
    expect(menu.surface.getItem('row-0')).not.toBeNull();
    expect(menu.surface.getItem('prev')).toBeNull();
    menu.dispose();
  });

  it('draws tabs only when reserved and routes their presses', () => {
    const onTab = vi.fn();
    const page = (): MenuPage => ({
      title: 'T',
      rows: [],
      tabs: [{ id: 'one', label: 'One', active: true, onPress: onTab }],
    });
    const plain = new SpatialMenu();
    plain.open(page);
    expect(plain.surface.getItem('tab-one')).toBeNull();
    const tabbed = new SpatialMenu({ tabs: true });
    tabbed.open(page);
    press(tabbed.surface, 'tab-one');
    expect(onTab).toHaveBeenCalledOnce();
    expect(tabbed.height).toBeGreaterThan(plain.height);
    plain.dispose();
    tabbed.dispose();
  });

  it('gives toggles, steppers and secondary targets independent actions', () => {
    const onChange = vi.fn();
    const dec = vi.fn();
    const inc = vi.fn();
    const remove = vi.fn();
    const main = vi.fn();
    const menu = new SpatialMenu({ pageSize: 4 });
    menu.open(() => ({
      title: 'T',
      rows: [
        { kind: 'toggle', label: 'Tog', value: false, onChange },
        { kind: 'stepper', label: 'Step', value: '1', onDecrement: dec, onIncrement: inc, canDecrement: false },
        { kind: 'button', label: 'Btn', onPress: main, secondary: { icon: 'close', onPress: remove } },
      ],
    }));
    const ids = ['row-0', 'row-1', 'row-2'];
    const all: string[] = [];
    for (let uvx = 0.02; uvx < 1; uvx += 0.02) {
      for (const row of ids) {
        const base = menu.surface.getItem(row);
        if (!base) continue;
        const hit = {
          object: menu.surface.mesh,
          uv: new THREE.Vector2(uvx, 1 - (base.y + base.h / 2) / menu.surface.pixelHeight),
        } as unknown as XrInputTarget;
        const found = menu.surface.itemAt(hit.uv);
        if (found && !all.includes(found.id)) {
          all.push(found.id);
          new SurfaceInteraction().activate(hit);
        }
      }
    }
    expect(onChange).toHaveBeenCalledWith(true);
    expect(inc).toHaveBeenCalledOnce();
    expect(dec).not.toHaveBeenCalled();
    expect(main).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    menu.dispose();
  });
});
