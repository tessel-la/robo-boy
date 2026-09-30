import React from 'react';
import type { Ros } from 'roslib';
import type { GamepadComponentConfig } from '../types';
import { useNumericReading } from '../useTopicSubscription';
import PadValueFrame from './PadValueFrame';

interface ReadoutComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

/** One number, as large as the component allows, with its unit. */
const ReadoutComponent: React.FC<ReadoutComponentProps> = ({ config, ros, isEditing = false }) => {
  const reading = useNumericReading(config, ros, isEditing);
  const unit = config.config?.unit?.trim() ?? '';
  const label = config.label?.trim();

  return (
    <PadValueFrame
      kind="readout"
      label={label}
      level={reading.level}
      notice={reading.notice}
      staleFor={reading.staleFor}
      data-testid="readout-component"
      role="group"
      aria-label={`${label || 'Readout'}: ${reading.text}${unit ? ` ${unit}` : ''}`}
    >
      <span className="pad-readout-value">
        <strong>{reading.text}</strong>
        {unit && <small>{unit}</small>}
      </span>
    </PadValueFrame>
  );
};

export default ReadoutComponent;
