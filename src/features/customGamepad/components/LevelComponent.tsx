import React from 'react';
import type { Ros } from 'roslib';
import type { GamepadComponentConfig } from '../types';
import { formatValue, fractionOf } from '../padValues';
import { useNumericReading } from '../useTopicSubscription';
import { thresholdZones } from './GaugeComponent';
import PadValueFrame from './PadValueFrame';

interface LevelComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

/** A bar runs along the component's longer side unless its settings say otherwise. */
export const levelOrientation = (config: Pick<GamepadComponentConfig, 'config' | 'position'>): 'horizontal' | 'vertical' =>
  config.config?.orientation ?? (config.position.height > config.position.width ? 'vertical' : 'horizontal');

const LevelComponent: React.FC<LevelComponentProps> = ({ config, ros, isEditing = false }) => {
  const settings = config.config ?? {};
  const reading = useNumericReading(config, ros, isEditing);
  const orientation = levelOrientation(config);
  const unit = settings.unit?.trim() ?? '';
  const label = config.label?.trim();
  const along = orientation === 'horizontal' ? 'left' : 'bottom';
  const size = orientation === 'horizontal' ? 'width' : 'height';
  const marks = [settings.warnAt, settings.alarmAt]
    .filter((value): value is number => Number.isFinite(value))
    .map(value => fractionOf(value, reading.range))
    .filter(fraction => fraction > 0 && fraction < 1);
  const value = (
    <span className="pad-level-reading">
      <strong>{reading.text}</strong>
      {unit && <small>{unit}</small>}
    </span>
  );

  return (
    <PadValueFrame
      kind="level"
      className={orientation}
      label={label}
      aside={orientation === 'horizontal' ? value : undefined}
      level={reading.level}
      notice={reading.notice}
      staleFor={reading.staleFor}
      data-testid="level-component"
      role="meter"
      aria-label={label || 'Level'}
      aria-valuemin={reading.range.min}
      aria-valuemax={reading.range.max}
      aria-valuenow={reading.value ?? undefined}
      aria-valuetext={`${reading.text}${unit ? ` ${unit}` : ''}`}
    >
      {orientation === 'vertical' && value}
      <div className="pad-level-track" aria-hidden="true">
        {thresholdZones(settings, reading.range).map(zone => (
          <span
            key={zone.level}
            className={`pad-level-zone ${zone.level}`}
            style={{ [along]: `${zone.from * 100}%`, [size]: `${(zone.to - zone.from) * 100}%` }}
          />
        ))}
        {reading.value !== null && <span className="pad-level-fill" style={{ [size]: `${reading.fraction * 100}%` }} />}
        {marks.map(fraction => <span key={fraction} className="pad-level-mark" style={{ [along]: `${fraction * 100}%` }} />)}
      </div>
      <div className="pad-level-scale" aria-hidden="true">
        <span>{formatValue(reading.range.min, settings, reading.range)}</span>
        <span>{formatValue(reading.range.max, settings, reading.range)}</span>
      </div>
    </PadValueFrame>
  );
};

export default LevelComponent;
