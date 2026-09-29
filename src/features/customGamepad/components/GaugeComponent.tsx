import React from 'react';
import type { Ros } from 'roslib';
import type { GamepadComponentConfig } from '../types';
import { formatValue, fractionOf } from '../padValues';
import { useNumericReading } from '../useTopicSubscription';
import PadValueFrame from './PadValueFrame';

interface GaugeComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

// A 240° dial, drawn in a fixed box that the SVG scales to whatever room the grid gives it. Angles are clockwise
// from twelve o'clock.
const START = -120;
const SWEEP = 240;
const CX = 60;
const CY = 58;
const R = 44;
const ZONE_R = R + 8;

const point = (degrees: number, radius: number) => {
  const radians = (degrees * Math.PI) / 180;
  return { x: CX + radius * Math.sin(radians), y: CY - radius * Math.cos(radians) };
};

/** The arc between two fractions of the dial. */
export function dialArc(from: number, to: number, radius = R): string {
  const a = START + SWEEP * Math.max(0, Math.min(1, from));
  const b = START + SWEEP * Math.max(0, Math.min(1, to));
  if (b - a < 0.05) return '';
  const start = point(a, radius);
  const end = point(b, radius);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${b - a > 180 ? 1 : 0} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

/** The dial's warning and alarm bands, as fractions of its range. */
export function thresholdZones(
  config: NonNullable<GamepadComponentConfig['config']>,
  range: { min: number; max: number }
): Array<{ level: 'warning' | 'alarm'; from: number; to: number }> {
  const at = (value: number | undefined) => (Number.isFinite(value) ? fractionOf(value as number, range) : undefined);
  const warn = at(config.warnAt);
  const alarm = at(config.alarmAt);
  const zones: Array<{ level: 'warning' | 'alarm'; from: number; to: number }> = [];
  if (config.alertBelow) {
    if (alarm !== undefined) zones.push({ level: 'alarm', from: 0, to: alarm });
    if (warn !== undefined) zones.push({ level: 'warning', from: alarm ?? 0, to: warn });
  } else {
    if (warn !== undefined) zones.push({ level: 'warning', from: warn, to: alarm ?? 1 });
    if (alarm !== undefined) zones.push({ level: 'alarm', from: alarm, to: 1 });
  }
  return zones.filter(zone => zone.to > zone.from);
}

const GaugeComponent: React.FC<GaugeComponentProps> = ({ config, ros, isEditing = false }) => {
  const settings = config.config ?? {};
  const reading = useNumericReading(config, ros, isEditing);
  const unit = settings.unit?.trim() ?? '';
  const knob = point(START + SWEEP * reading.fraction, R);
  const minEnd = point(START, R);
  const maxEnd = point(START + SWEEP, R);
  // Long values shrink to stay inside the dial.
  const valueSize = Math.min(22, 76 / Math.max(1, reading.text.length * 0.62));
  const label = config.label?.trim();

  return (
    <PadValueFrame
      kind="gauge"
      label={label}
      level={reading.level}
      notice={reading.notice}
      staleFor={reading.staleFor}
      data-testid="gauge-component"
      role="meter"
      aria-label={label || 'Gauge'}
      aria-valuemin={reading.range.min}
      aria-valuemax={reading.range.max}
      aria-valuenow={reading.value ?? undefined}
      aria-valuetext={`${reading.text}${unit ? ` ${unit}` : ''}`}
    >
      <svg className="pad-gauge-dial" viewBox="0 0 120 102" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {thresholdZones(settings, reading.range).map(zone => (
          <path key={zone.level} className={`pad-gauge-zone ${zone.level}`} d={dialArc(zone.from, zone.to, ZONE_R)} />
        ))}
        <path className="pad-gauge-track" d={dialArc(0, 1)} />
        {reading.value !== null && <path className="pad-gauge-fill" d={dialArc(0, reading.fraction)} />}
        {reading.value !== null && <circle className="pad-gauge-knob" cx={knob.x} cy={knob.y} r={5} />}
        <text className="pad-gauge-value" x={CX} y={CY + 2} fontSize={valueSize}>{reading.text}</text>
        {unit && <text className="pad-gauge-unit" x={CX} y={CY + 20}>{unit}</text>}
        <text className="pad-gauge-bound" x={minEnd.x} y={minEnd.y + 14}>{formatValue(reading.range.min, settings, reading.range)}</text>
        <text className="pad-gauge-bound" x={maxEnd.x} y={maxEnd.y + 14}>{formatValue(reading.range.max, settings, reading.range)}</text>
      </svg>
    </PadValueFrame>
  );
};

export default GaugeComponent;
