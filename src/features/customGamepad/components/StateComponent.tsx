import React from 'react';
import type { Ros } from 'roslib';
import type { GamepadComponentConfig, ROSTopicConfig } from '../types';
import { describeRawValue, matchState, valuePathOf } from '../padValues';
import { DATA_BINDINGS, describeMismatch } from '../dataComponents';
import { staleText, statusMessage, useFieldValue } from '../useTopicSubscription';
import PadValueFrame from './PadValueFrame';

interface StateComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

/**
 * What a value means: a mode, a status code or a flag, named and coloured by the component's state list. A value the
 * list does not name is shown as it is.
 */
const StateComponent: React.FC<StateComponentProps> = ({ config, ros, isEditing = false }) => {
  const mappings = config.config?.stateMappings ?? [];
  const { status, latest, isStale } = useFieldValue(config, ros, isEditing);
  const raw = status === 'preview' ? (mappings[0]?.value ?? 'state') : latest?.raw;
  const match = matchState(raw, mappings);
  const text = match?.label.trim() || describeRawValue(raw);
  const label = config.label?.trim();
  const notice = statusMessage(status, config.action as ROSTopicConfig | undefined)
    ?? (latest ? describeMismatch(latest.raw, valuePathOf(config), DATA_BINDINGS.state.fieldKinds) : undefined);

  return (
    <PadValueFrame
      kind="state"
      label={label}
      tone={match?.tone ?? 'neutral'}
      notice={notice}
      staleFor={staleText(isStale, latest)}
      data-testid="state-component"
      role="group"
      aria-label={`${label || 'State'}: ${text}`}
    >
      <span className="pad-state-value" title={match && raw !== undefined ? `Value: ${describeRawValue(raw)}` : undefined}>
        <i aria-hidden="true" />
        <strong>{text}</strong>
      </span>
    </PadValueFrame>
  );
};

export default StateComponent;
