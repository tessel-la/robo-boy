import * as THREE from 'three';
import { subscribeXrTheme } from '../../ui/xrTheme';
import type { GamepadComponentConfig } from '../../../features/customGamepad/types';
import { SpatialSurface } from '../../ui/SpatialSurface';
import { XR_THEME, drawText } from '../../ui/canvasKit';
import type { XrInputTarget } from '../../XrInputManager';

const NATIVE = new Set(['button', 'joystick', 'dpad', 'toggle', 'slider', 'physical-gamepad']);

/** A tangible control, with a stationary hit region while its cap/lever moves under the ray. */
export class PadControl {
  readonly object = new THREE.Group();
  readonly native: boolean;
  readonly face: THREE.Mesh;
  private readonly owned: Array<THREE.BufferGeometry | THREE.Material> = [];
  private readonly label: SpatialSurface;
  private readonly moving = new Map<string, THREE.Object3D>();
  private readonly faces = new Map<THREE.Object3D, string>();
  private readonly accent: THREE.MeshStandardMaterial;
  private hardwareStatus = '';
  private disposed = false;
  private readonly stopTheme: () => void;

  constructor(
    readonly config: GamepadComponentConfig,
    readonly width: number,
    readonly height: number,
    texture: THREE.Texture
  ) {
    this.native = NATIVE.has(config.type);
    this.object.name = `xr-pad-control:${config.id}`;
    this.object.userData.componentId = config.id;
    this.accent = this.material(XR_THEME.accent);
    const customAccent = config.style?.color && /^(#[\da-f]{3}|#[\da-f]{6})$/i.test(config.style.color)
      ? config.style.color : null;
    if (customAccent) this.accent.color.set(customAccent);
    const base = this.material(XR_THEME.surface);
    this.box(width, height, 0.022, base, 0, 0, 0);
    const areaHeight = height * 0.72;
    const size = Math.min(width * 0.76, areaHeight);
    const dark = this.material(XR_THEME.raised);
    this.stopTheme = subscribeXrTheme(() => {
      base.color.set(XR_THEME.surface);
      dark.color.set(XR_THEME.raised);
      if (!customAccent) this.accent.color.set(XR_THEME.accent);
    });
    this.face = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.owned.push(this.face.geometry, this.face.material as THREE.Material);
    this.face.position.z = 0.014;
    this.face.name = `xr-pad-hit:${config.id}`;
    this.object.add(this.face);
    this.faces.set(this.face, 'main');

    if (config.type === 'joystick') {
      this.disc(size * 0.47, 0.016, dark, 0, 0.01, 0.028);
      const stick = new THREE.Group();
      this.object.add(stick);
      stick.position.set(0, 0.01, 0.032);
      this.moving.set('main', stick);
      this.disc(size * 0.07, size * 0.26, dark, 0, 0, size * 0.1, stick);
      this.disc(size * 0.19, 0.018, this.accent, 0, 0, size * 0.24, stick);
    } else if (config.type === 'dpad') {
      for (const [direction, x, y] of [
        ['up', 0, 1],
        ['down', 0, -1],
        ['left', -1, 0],
        ['right', 1, 0],
      ] as const) {
        const cap = this.box(
          size * 0.28,
          size * 0.28,
          0.025,
          this.accent,
          x * size * 0.3,
          0.01 + y * size * 0.3,
          0.034
        );
        this.moving.set(direction, cap);
        const hit = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.3, size * 0.3), this.face.material);
        this.owned.push(hit.geometry);
        hit.position.copy(cap.position);
        hit.position.z += 0.018;
        hit.name = `xr-pad-hit:${config.id}:${direction}`;
        this.object.add(hit);
        this.faces.set(hit, direction);
      }
    } else if (config.type === 'button') {
      const cap = this.disc(size * 0.4, 0.03, this.accent, 0, 0.01, 0.038);
      this.moving.set('main', cap);
    } else if (config.type === 'toggle') {
      this.box(size * 0.95, size * 0.4, 0.015, dark, 0, 0.01, 0.027);
      this.moving.set('main', this.box(size * 0.35, size * 0.35, 0.025, this.accent, -size * 0.28, 0.01, 0.047));
    } else if (config.type === 'slider') {
      const vertical = config.config?.orientation === 'vertical';
      this.box(
        vertical ? size * 0.08 : width * 0.8,
        vertical ? areaHeight * 0.85 : size * 0.08,
        0.014,
        dark,
        0,
        0.01,
        0.027
      );
      this.moving.set('main', this.box(size * 0.25, size * 0.25, 0.03, this.accent, 0, 0.01, 0.047));
    } else if (config.type === 'physical-gamepad') {
      // Hardware remains owned by the mounted physical-gamepad component, including bindings and deadman cleanup.
      this.box(width * 0.8, areaHeight * 0.6, 0.045, dark, 0, 0.01, 0.04);
      for (const x of [-1, 1]) {
        this.disc(size * 0.24, 0.04, dark, x * width * 0.3, -areaHeight * 0.2, 0.04);
        this.disc(size * 0.09, 0.028, this.accent, x * width * 0.2, 0.01, 0.077);
      }
      for (const [x, y] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ])
        this.disc(
          size * 0.035,
          0.014,
          this.accent,
          width * 0.27 + x * size * 0.09,
          areaHeight * 0.12 + y * size * 0.09,
          0.073
        );
    } else {
      (this.face.material as THREE.MeshBasicMaterial).map = texture;
      this.face.position.z = 0.025;
    }

    this.label = new SpatialSurface({
      width: width * 0.94,
      height: Math.min(height * 0.18, 0.045),
      pixelsPerMetre: 1800,
    });
    this.label.mesh.userData.xrPickable = false;
    this.label.mesh.position.set(0, -height * 0.39, 0.024);
    this.object.add(this.label.mesh);
    this.label.setItems([
      {
        id: 'label',
        x: 0,
        y: 0,
        w: this.label.pixelWidth,
        h: this.label.pixelHeight,
        draw: ctx =>
          drawText(
            ctx,
            config.label || config.type,
            this.label.pixelWidth / 2,
            this.label.pixelHeight / 2,
            this.label.pixelWidth - 8,
            { size: 25, align: 'center', weight: 600 }
          ),
      },
    ]);
    if (!this.native) this.setStatus('Loading…');
  }

  private material(color: string) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.12 });
    this.owned.push(material);
    return material;
  }

  private box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) {
    const shape = new THREE.Shape();
    const r = Math.min(w, h, d * 3) * 0.14;
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: d,
      bevelEnabled: true,
      bevelSize: r / 3,
      bevelThickness: r / 3,
      bevelSegments: 2,
      steps: 1,
      curveSegments: 4,
    });
    this.owned.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z - d / 2);
    mesh.userData.xrPickable = false;
    this.object.add(mesh);
    return mesh;
  }

  private disc(
    radius: number,
    depth: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent = this.object
  ) {
    const geometry = new THREE.CylinderGeometry(radius, radius, depth, 24);
    this.owned.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.userData.xrPickable = false;
    parent.add(mesh);
    return mesh;
  }

  part(target: XrInputTarget): string | null {
    return this.faces.get(target.object) ?? null;
  }

  point(target: XrInputTarget) {
    const point = this.object.worldToLocal(target.point.clone());
    return {
      x: THREE.MathUtils.clamp(point.x / this.width + 0.5, 0, 1),
      y: THREE.MathUtils.clamp(0.5 - point.y / this.height, 0, 1),
    };
  }

  feedback(part: string, held: boolean, x = 0.5, y = 0.5) {
    const moving = this.moving.get(part);
    if (!moving) return;
    if (this.config.type === 'joystick') {
      moving.rotation.set(held ? (y - 0.5) * 0.8 : 0, held ? (x - 0.5) * 0.8 : 0, 0);
    } else if (this.config.type === 'slider') {
      const vertical = this.config.config?.orientation === 'vertical';
      moving.position.x = vertical ? 0 : (x - 0.5) * this.width * 0.8;
      moving.position.y = 0.01 + (vertical ? (0.5 - y) * this.height * 0.6 : 0);
    } else if (this.config.type === 'button' || this.config.type === 'dpad') {
      moving.position.z = (this.config.type === 'button' ? 0.038 : 0.0215) - (held ? 0.012 : 0);
    }
  }

  sync(element: HTMLElement | null, selected: boolean) {
    this.accent.emissive.set(selected ? XR_THEME.accent : '#000000');
    this.accent.emissiveIntensity = selected ? 0.28 : 0;
    if (this.config.type === 'button' && this.config.config?.momentary === false) {
      this.feedback('main', Boolean(element?.querySelector('.button-component.active')));
    }
    if (this.config.type === 'toggle') {
      const on = Boolean(element?.querySelector('.toggle-switch.on'));
      const moving = this.moving.get('main')!;
      moving.position.x = (on ? 1 : -1) * Math.min(this.width * 0.76, this.height * 0.72) * 0.28;
    }
    if (this.config.type === 'slider' && element) {
      const input = element.querySelector<HTMLInputElement>('input[type="range"]');
      if (input) {
        const value = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min) || 1);
        this.feedback('main', false, value, 1 - value);
      }
    }
    if (this.config.type === 'physical-gamepad') {
      const status =
        element?.querySelector('.physical-gamepad-warning[role="alert"]')?.textContent?.trim() ||
        element?.querySelector('.physical-gamepad-status')?.textContent?.trim() ||
        'Waiting for hardware';
      if (status !== this.hardwareStatus) {
        this.hardwareStatus = status;
        this.label.setItems([
          {
            id: 'hardware-status',
            x: 0,
            y: 0,
            w: this.label.pixelWidth,
            h: this.label.pixelHeight,
            draw: ctx =>
              drawText(ctx, status, this.label.pixelWidth / 2, this.label.pixelHeight / 2, this.label.pixelWidth - 8, {
                size: 24,
                align: 'center',
              }),
          },
        ]);
      }
    }
  }

  setCrop(x: number, y: number, w: number, h: number) {
    this.label.mesh.visible = false;
    (this.face.material as THREE.MeshBasicMaterial).opacity = 1;
    const uv = this.face.geometry.getAttribute('uv');
    // PlaneGeometry vertex order: top-left, top-right, bottom-left, bottom-right.
    uv.setXY(0, x, 1 - y);
    uv.setXY(1, x + w, 1 - y);
    uv.setXY(2, x, 1 - y - h);
    uv.setXY(3, x + w, 1 - y - h);
    uv.needsUpdate = true;
  }

  setStatus(status: string) {
    if (this.native) return;
    this.label.mesh.visible = true;
    this.label.mesh.position.y = 0;
    (this.face.material as THREE.MeshBasicMaterial).opacity = 0;
    this.label.setItems([
      {
        id: 'status',
        x: 0,
        y: 0,
        w: this.label.pixelWidth,
        h: this.label.pixelHeight,
        draw: ctx =>
          drawText(
            ctx,
            `${this.config.label || this.config.type} · ${status}`,
            this.label.pixelWidth / 2,
            this.label.pixelHeight / 2,
            this.label.pixelWidth - 8,
            { size: 23, align: 'center' }
          ),
      },
    ]);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTheme();
    this.label.dispose();
    for (const resource of this.owned) resource.dispose();
    this.object.removeFromParent();
  }
}
