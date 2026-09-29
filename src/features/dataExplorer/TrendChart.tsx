/** Rounds up to 1, 2 or 5 times a power of ten, so the scale label reads cleanly. */
export function niceCeiling(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find(factor => factor * power >= value) ?? 10;
  return step * power;
}

interface Props {
  points: { time: number; value: number }[];
  label: string;
  format: (value: number) => string;
}

/**
 * A small history chart for the inspector. The scale starts at zero, so a steady rate sits at its
 * real height instead of hugging the top edge, and the labels give the scale and the time span.
 */
export default function TrendChart({ points, label, format }: Props) {
  if (points.length < 2) return <p className="de-muted de-trend-empty">Collecting history…</p>;
  const values = points.map(point => point.value);
  const top = niceCeiling(Math.max(...values) * 1.15);
  const first = points[0].time;
  const span = Math.max(1, points[points.length - 1].time - first);
  const coords = points.map(point => [((point.time - first) * 100) / span, 40 - (point.value * 38) / top]);
  const line = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const latest = values[values.length - 1];
  return (
    <figure className="de-trend">
      <div className="de-trend-plot">
        <span className="de-trend-scale">{format(top)}</span>
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${label}: now ${format(latest)}`}>
          <line x1="0" x2="100" y1="21" y2="21" className="de-trend-grid" />
          <polygon points={`0,40 ${line} 100,40`} />
          <polyline points={line} />
        </svg>
      </div>
      <figcaption>
        <span>{Math.round(span / 1000)} s ago</span>
        <span>
          now <strong>{format(latest)}</strong>
        </span>
      </figcaption>
    </figure>
  );
}
