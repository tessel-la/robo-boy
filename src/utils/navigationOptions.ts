/** Appearance saved with each Path or Occupancy grid layer. Color/width apply only to paths. */
export interface NavigationDisplayOptions {
  visible?: boolean;
  opacity?: number;
  color?: string;
  lineWidth?: number;
  /** Map-only options; absent values preserve full-map occupancy rendering. */
  palette?: 'occupancy' | 'costmap';
  updatesTopic?: string;
}

export function normalizeNavigationOptions(options: NavigationDisplayOptions = {}, map = false) {
  const finite = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    palette: options.palette === 'costmap' ? ('costmap' as const) : ('occupancy' as const),
    updatesTopic: typeof options.updatesTopic === 'string' ? options.updatesTopic.trim() : '',
    visible: options.visible !== false,
    opacity: finite(options.opacity, map ? 0.7 : 1, 0, 1),
    color: typeof options.color === 'string' && /^#[0-9a-f]{6}$/i.test(options.color) ? options.color : '#22c55e',
    lineWidth: finite(options.lineWidth, 0.03, 0.001, 1),
  };
}
