import { SpatialSurface, type SurfaceItem } from './SpatialSurface';
import { XR_THEME, drawText, fillRoundRect } from './canvasKit';

/** Shared immersive text input. The caller owns validation and committing the value. */
export class SpatialKeyboard {
  readonly surface = new SpatialSurface({
    width: 0.56,
    height: 0.3,
    pixelsPerMetre: 1600,
    drawBackground: (ctx, w, h) => fillRoundRect(ctx, 0, 0, w, h, 24, XR_THEME.surface),
  });
  private input: { label: string; text: string; secret?: boolean; commit: (text: string) => void } | null = null;
  private symbols = false;
  private shift = false;
  private error = '';
  constructor(private readonly onApplied?: () => void) {
    this.surface.mesh.visible = false;
  }
  open(label: string, text: string, commit: (text: string) => void, secret = false) {
    this.input = { label, text, commit, secret };
    this.error = '';
    this.drawKeyboard();
  }
  get isOpen() {
    return this.input !== null;
  }
  close() {
    this.input = null;
    this.surface.mesh.visible = false;
  }
  apply(): boolean {
    if (!this.input) return true;
    try {
      this.input.commit(this.input.text);
      this.close();
      this.onApplied?.();
      return true;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : 'Invalid value';
      this.drawKeyboard();
      return false;
    }
  }
  dispose() {
    this.close();
    this.surface.dispose();
  }
  private drawKeyboard() {
    const input = this.input;
    this.surface.mesh.visible = Boolean(input);
    if (!input) return;
    const w = this.surface.pixelWidth,
      h = this.surface.pixelHeight;
    const items: SurfaceItem[] = [
      {
        id: 'input',
        x: 12,
        y: 10,
        w: w - 24,
        h: 90,
        draw: ctx => {
          drawText(ctx, input.label, 16, 30, w - 32, { size: 24, color: XR_THEME.textMuted });
          drawText(
            ctx,
            this.error || (input.secret ? '•'.repeat(Math.min(input.text.length, 50)) : input.text.slice(-70)) || ' ',
            16,
            67,
            w - 32,
            {
              size: 26,
              color: this.error ? XR_THEME.danger : XR_THEME.text,
            }
          );
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
          if (input.text.length < 8192) input.text += ' ';
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
          this.apply();
        },
      ],
    ];
    actions.forEach(([id, label, action], index) =>
      button(id, label, 12 + (index * (w - 24)) / actions.length, h - 84, (w - 24) / actions.length, action)
    );
    this.surface.setItems(items);
  }
}
