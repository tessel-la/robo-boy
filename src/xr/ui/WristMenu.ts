import * as THREE from 'three';
import type { XrInputManager } from '../XrInputManager';
import { SpatialMenu, type MenuPage } from './SpatialMenu';
import { SpatialToolbar } from './SpatialToolbar';

export interface WristMenuCatalogEntry {
  id: string;
  name: string;
  description?: string;
}

export interface WristMenuPanel {
  id: string;
  title: string;
}

export interface WristMenuOptions {
  input: Pick<XrInputManager, 'getWristPose'>;
  /** Group the menu is added to; the wrist pose (a world matrix) is converted into its space. */
  parent: THREE.Object3D;
  /** The hand the menu hangs from. The other hand does the pointing. */
  handedness?: 'left' | 'right';
  getCatalog: () => readonly WristMenuCatalogEntry[];
  getPanels: () => readonly WristMenuPanel[];
  onAdd: (panelType: string) => void;
  onRemove: (panelId: string) => void;
  /** Bring an open panel to where the user is looking. */
  onSummon: (panelId: string) => void;
}

const SHOW_ANGLE = THREE.MathUtils.degToRad(42);
const HIDE_ANGLE = THREE.MathUtils.degToRad(62);
const MIN_DISTANCE = 0.15;
const MAX_DISTANCE = 0.75;
/** Raised over the wrist so the arm does not sit in front of the list. */
const HOVER_HEIGHT = 0.17;
const MENU_SCALE = 0.6;
const FOLLOW_RATE = 14;

const toHead = new THREE.Vector3();

/**
 * Whether the small menu launcher should be showing: the wrist is raised into view.
 *
 * This deliberately uses only where the wrist is relative to where the head is looking rather than
 * the wrist's own orientation. Controller grips and tracked-hand grips disagree about which way is
 * "palm up", and a gesture that only works on one of them is worse than one that works on both.
 * Separate show and hide angles give hysteresis, so a menu on the edge of the gesture does not flicker
 * while someone is reaching for the launcher. This never opens the full menu.
 */
export const shouldShowWristLauncher = (
  head: THREE.Vector3,
  headForward: THREE.Vector3,
  wrist: THREE.Vector3,
  wasVisible: boolean
): boolean => {
  toHead.subVectors(wrist, head);
  const distance = toHead.length();
  if (distance < MIN_DISTANCE || distance > MAX_DISTANCE) return false;
  const angle = toHead.divideScalar(distance).angleTo(headForward);
  return angle <= (wasVisible ? HIDE_ANGLE : SHOW_ANGLE);
};

type WristTab = 'add' | 'open';

/**
 * The spatial menu that hangs from the user's wrist: browse the panel catalogue and add a panel, or
 * review, summon and remove the ones already open.
 *
 * It owns no workspace state. It reads the catalogue and the open panels through callbacks on every
 * refresh and reports intent back through `onAdd` / `onRemove` / `onSummon`, so it is reusable by any
 * spatial workspace that can answer those questions.
 */
export class WristMenu {
  readonly object = new THREE.Group();
  private readonly menu: SpatialMenu;
  private readonly launcher = new SpatialToolbar(0.3);
  private readonly options: WristMenuOptions;
  private tab: WristTab = 'add';
  private opened = false;
  private launcherVisible = false;
  private snap = true;
  private readonly target = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly wrist = new THREE.Vector3();

  constructor(options: WristMenuOptions) {
    this.options = options;
    this.menu = new SpatialMenu({
      width: 0.56,
      pageSize: 5,
      tabs: true,
      onClose: () => {
        this.opened = false;
        this.snap = true;
      },
    });
    this.launcher.setButtons([
      { id: 'wrist-menu-toggle', icon: 'layers', label: 'Panels', onPress: () => this.toggle() },
    ]);
    this.object.name = 'xr-wrist-menu';
    this.menu.surface.mesh.name = 'xr-wrist-menu-content';
    this.launcher.surface.mesh.name = 'xr-wrist-menu-launcher';
    this.object.add(this.menu.object, this.launcher.surface.mesh);
    this.object.scale.setScalar(MENU_SCALE);
    this.object.visible = false;
    // The hand the menu hangs from must not point at it, or it would be selecting its own wrist.
    this.object.userData.xrExcludeHandedness = options.handedness ?? 'left';
    options.parent.add(this.object);
  }

  get isVisible(): boolean {
    return this.opened && this.object.visible;
  }

  /** Only an explicit launcher press or controller button changes the open state. */
  toggle(): void {
    if (this.opened) this.menu.close();
    else {
      this.opened = true;
      this.snap = true;
      this.menu.open(() => this.page());
    }
  }

  /** Re-read the catalogue and open panels, e.g. after one was added or removed. */
  refresh(): void {
    this.menu.refresh();
  }

  update(camera: THREE.Camera, delta: number): void {
    const pose = this.options.input.getWristPose(this.options.handedness ?? 'left');
    camera.getWorldPosition(this.head);
    camera.getWorldDirection(this.forward);
    if (!pose?.tracked) {
      if (this.opened) this.menu.close();
      this.launcherVisible = false;
      this.object.visible = false;
      return;
    }
    this.wrist.setFromMatrixPosition(pose.matrix);
    this.launcherVisible =
      !this.opened && shouldShowWristLauncher(this.head, this.forward, this.wrist, this.launcherVisible);
    this.launcher.surface.mesh.visible = this.launcherVisible;
    const show = this.opened || this.launcherVisible;
    if (show && !this.object.visible) this.snap = true;
    this.object.visible = show;
    if (!show) return;

    this.target.copy(this.wrist);
    this.target.y += HOVER_HEIGHT;
    this.options.parent.worldToLocal(this.target);
    if (this.snap) {
      this.object.position.copy(this.target);
      this.snap = false;
    } else {
      this.object.position.lerp(this.target, 1 - Math.exp(-delta * FOLLOW_RATE));
    }

    // Face the head, turning about the vertical only so the list never tilts with the wrist.
    const yaw = Math.atan2(this.head.x - this.wrist.x, this.head.z - this.wrist.z);
    this.object.rotation.set(0, yaw, 0);
  }

  dispose(): void {
    this.menu.dispose();
    this.launcher.dispose();
    this.object.removeFromParent();
  }

  private page(): MenuPage {
    const { getCatalog, getPanels, onAdd, onRemove, onSummon } = this.options;
    const tabs = [
      { id: 'add', label: 'Add panel', active: this.tab === 'add', onPress: () => this.setTab('add') },
      {
        id: 'open',
        label: `Open (${getPanels().length})`,
        active: this.tab === 'open',
        onPress: () => this.setTab('open'),
      },
    ];

    if (this.tab === 'add') {
      return {
        title: 'Robo Boy',
        tabs,
        emptyText: 'No panels available',
        rows: getCatalog().map(entry => ({
          kind: 'button' as const,
          label: entry.name,
          detail: entry.description,
          trailing: 'chevron' as const,
          onPress: () => onAdd(entry.id),
        })),
      };
    }
    return {
      title: 'Robo Boy',
      tabs,
      emptyText: 'Nothing open yet',
      rows: getPanels().map(panel => ({
        kind: 'button' as const,
        label: panel.title,
        detail: 'Bring to me',
        onPress: () => onSummon(panel.id),
        secondary: { icon: 'close' as const, danger: true, onPress: () => onRemove(panel.id) },
      })),
    };
  }

  private setTab(tab: WristTab): void {
    this.tab = tab;
    this.refresh();
  }
}
