/**
 * Drawing primitives shared by every spatial UI surface.
 *
 * Everything in the XR workspace that is not a rasterised DOM panel is drawn with these onto a 2D
 * canvas that becomes a texture. Keeping the palette and shapes in one place is what makes the
 * toolbar, the settings menu and the wrist menu read as one interface.
 */

export const XR_THEME = {
  surface: 'rgba(17, 22, 29, 0.92)',
  surfaceBorder: '#33404e',
  item: 'rgba(255, 255, 255, 0.07)',
  itemHover: 'rgba(79, 168, 230, 0.34)',
  itemActive: 'rgba(79, 168, 230, 0.55)',
  itemDisabled: 'rgba(255, 255, 255, 0.03)',
  text: '#e5ebf1',
  textMuted: '#8a97a6',
  textDisabled: '#4d5966',
  accent: '#4fa8e6',
  danger: '#e5675b',
  success: '#5fbf7a',
  font: 'system-ui, "Segoe UI", Roboto, sans-serif',
} as const;

export type IconName =
  | 'gear'
  | 'fit'
  | 'reset'
  | 'plus'
  | 'minus'
  | 'close'
  | 'chevronLeft'
  | 'chevronRight'
  | 'layers'
  | 'grow'
  | 'shrink'
  | 'cube'
  | 'check';

export const roundRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void => {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
};

export const fillRoundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fill: string
): void => {
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
};

export const strokeRoundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  stroke: string,
  lineWidth = 2
): void => {
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
};

/** Shorten text with an ellipsis until it fits, so a long topic name never spills off a row. */
export const fitText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string => {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end -= 1;
  return `${text.slice(0, end)}…`;
};

export interface TextStyle {
  size: number;
  color?: string;
  weight?: number | 'normal' | 'bold';
  align?: CanvasTextAlign;
}

/** Draw a single vertically centred line of text, truncated to `maxWidth`. */
export const drawText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  style: TextStyle
): void => {
  ctx.font = `${style.weight ?? 500} ${style.size}px ${XR_THEME.font}`;
  ctx.fillStyle = style.color ?? XR_THEME.text;
  ctx.textAlign = style.align ?? 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitText(ctx, text, maxWidth), x, y);
};

/** Stroked glyphs sized to `size` pixels, centred on (cx, cy). */
export const drawIcon = (
  ctx: CanvasRenderingContext2D,
  name: IconName,
  cx: number,
  cy: number,
  size: number,
  color: string = XR_THEME.text
): void => {
  const s = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.11);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  switch (name) {
    case 'gear': {
      const teeth = 8;
      for (let index = 0; index < teeth; index += 1) {
        const angle = (index / teeth) * Math.PI * 2;
        ctx.moveTo(Math.cos(angle) * s * 0.66, Math.sin(angle) * s * 0.66);
        ctx.lineTo(Math.cos(angle) * s, Math.sin(angle) * s);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.24, 0, Math.PI * 2);
      break;
    }
    case 'fit': {
      const a = s * 0.92;
      const b = s * 0.4;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        ctx.moveTo(sx * a, sy * b);
        ctx.lineTo(sx * a, sy * a);
        ctx.lineTo(sx * b, sy * a);
      }
      break;
    }
    case 'reset':
      ctx.arc(0, 0, s * 0.72, -Math.PI * 0.35, Math.PI * 1.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.72 * Math.cos(-Math.PI * 0.35) + s * 0.3, s * 0.72 * Math.sin(-Math.PI * 0.35) - s * 0.55);
      ctx.lineTo(s * 0.72 * Math.cos(-Math.PI * 0.35), s * 0.72 * Math.sin(-Math.PI * 0.35));
      ctx.lineTo(s * 0.72 * Math.cos(-Math.PI * 0.35) + s * 0.6, s * 0.72 * Math.sin(-Math.PI * 0.35) + s * 0.1);
      break;
    case 'plus':
      ctx.moveTo(-s * 0.8, 0);
      ctx.lineTo(s * 0.8, 0);
      ctx.moveTo(0, -s * 0.8);
      ctx.lineTo(0, s * 0.8);
      break;
    case 'minus':
      ctx.moveTo(-s * 0.8, 0);
      ctx.lineTo(s * 0.8, 0);
      break;
    case 'close':
      ctx.moveTo(-s * 0.7, -s * 0.7);
      ctx.lineTo(s * 0.7, s * 0.7);
      ctx.moveTo(s * 0.7, -s * 0.7);
      ctx.lineTo(-s * 0.7, s * 0.7);
      break;
    case 'chevronLeft':
      ctx.moveTo(s * 0.35, -s * 0.75);
      ctx.lineTo(-s * 0.4, 0);
      ctx.lineTo(s * 0.35, s * 0.75);
      break;
    case 'chevronRight':
      ctx.moveTo(-s * 0.35, -s * 0.75);
      ctx.lineTo(s * 0.4, 0);
      ctx.lineTo(-s * 0.35, s * 0.75);
      break;
    case 'layers':
      for (const offset of [-0.45, 0, 0.45]) {
        ctx.moveTo(0, s * (offset - 0.4));
        ctx.lineTo(s * 0.9, s * offset);
        ctx.lineTo(0, s * (offset + 0.4));
        ctx.lineTo(-s * 0.9, s * offset);
        ctx.closePath();
      }
      break;
    case 'grow':
      ctx.moveTo(-s * 0.9, s * 0.2);
      ctx.lineTo(-s * 0.9, s * 0.9);
      ctx.lineTo(-s * 0.2, s * 0.9);
      ctx.moveTo(s * 0.9, -s * 0.2);
      ctx.lineTo(s * 0.9, -s * 0.9);
      ctx.lineTo(s * 0.2, -s * 0.9);
      ctx.moveTo(-s * 0.9, s * 0.9);
      ctx.lineTo(s * 0.9, -s * 0.9);
      break;
    case 'shrink':
      ctx.moveTo(-s * 0.2, s * 0.9);
      ctx.lineTo(-s * 0.2, s * 0.2);
      ctx.lineTo(-s * 0.9, s * 0.2);
      ctx.moveTo(s * 0.2, -s * 0.9);
      ctx.lineTo(s * 0.2, -s * 0.2);
      ctx.lineTo(s * 0.9, -s * 0.2);
      ctx.moveTo(-s * 0.2, s * 0.2);
      ctx.lineTo(-s * 0.9, s * 0.9);
      ctx.moveTo(s * 0.2, -s * 0.2);
      ctx.lineTo(s * 0.9, -s * 0.9);
      break;
    case 'cube':
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.87, -s * 0.5);
      ctx.lineTo(s * 0.87, s * 0.5);
      ctx.lineTo(0, s);
      ctx.lineTo(-s * 0.87, s * 0.5);
      ctx.lineTo(-s * 0.87, -s * 0.5);
      ctx.closePath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, s);
      ctx.moveTo(0, 0);
      ctx.lineTo(s * 0.87, -s * 0.5);
      ctx.moveTo(0, 0);
      ctx.lineTo(-s * 0.87, -s * 0.5);
      break;
    case 'check':
      ctx.moveTo(-s * 0.8, 0);
      ctx.lineTo(-s * 0.25, s * 0.6);
      ctx.lineTo(s * 0.8, -s * 0.6);
      break;
  }
  ctx.stroke();
  ctx.restore();
};
