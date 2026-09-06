import React, { useMemo, useState } from 'react';
import type { Ros } from 'roslib';
import type { RosOperation } from '../../../utils/rosOperations';
import { getPhysicalGamepadControlLabel, PHYSICAL_GAMEPAD_CONTROLS } from '../physicalGamepad';
import type { PhysicalGamepadBinding, PhysicalGamepadControlId, PhysicalGamepadProfile } from '../types';
import RosEventOperationsEditor from './RosEventOperationsEditor';

interface Props {
  profile: PhysicalGamepadProfile;
  preferredIndex?: number;
  deadzone: number;
  bindings: Partial<Record<PhysicalGamepadControlId, PhysicalGamepadBinding>>;
  ros: Ros | null;
  onProfileChange: (value: PhysicalGamepadProfile) => void;
  onPreferredIndexChange: (value: number | undefined) => void;
  onDeadzoneChange: (value: number) => void;
  onBindingsChange: (value: Partial<Record<PhysicalGamepadControlId, PhysicalGamepadBinding>>) => void;
}

const PhysicalGamepadSettings: React.FC<Props> = ({
  profile,
  preferredIndex,
  deadzone,
  bindings,
  ros,
  onProfileChange,
  onPreferredIndexChange,
  onDeadzoneChange,
  onBindingsChange,
}) => {
  const [selectedControl, setSelectedControl] = useState<PhysicalGamepadControlId>('face-bottom');
  const labelsProfile = profile === 'auto' ? 'xbox' : profile;
  const selectedLabel = getPhysicalGamepadControlLabel(selectedControl, labelsProfile);
  const configuredCount = useMemo(
    () => Object.values(bindings).filter(binding => binding?.press || binding?.release).length,
    [bindings]
  );

  const updateSelectedBinding = (operations: Partial<Record<'press' | 'release', RosOperation>>) => {
    const next = { ...bindings };
    if (!operations.press && !operations.release) delete next[selectedControl];
    else next[selectedControl] = operations;
    onBindingsChange(next);
  };

  return (
    <div className="physical-gamepad-settings">
      <h4>Physical Controller</h4>
      <div className="settings-row">
        <div className="setting-group">
          <label htmlFor="physical-gamepad-profile">Button labels and layout</label>
          <select
            id="physical-gamepad-profile"
            value={profile}
            onChange={event => onProfileChange(event.target.value as PhysicalGamepadProfile)}
          >
            <option value="auto">Auto detect</option>
            <option value="xbox">Xbox / XInput</option>
            <option value="playstation">PlayStation</option>
            <option value="logitech">Logitech</option>
          </select>
        </div>
        <div className="setting-group">
          <label htmlFor="physical-gamepad-index">Controller index</label>
          <input
            id="physical-gamepad-index"
            type="number"
            min="0"
            placeholder="Auto (first connected)"
            value={preferredIndex ?? ''}
            onChange={event =>
              onPreferredIndexChange(event.target.value === '' ? undefined : Number(event.target.value))
            }
          />
        </div>
      </div>
      <div className="setting-group">
        <label htmlFor="physical-gamepad-deadzone">Stick deadzone: {deadzone.toFixed(2)}</label>
        <input
          id="physical-gamepad-deadzone"
          type="range"
          min="0"
          max="0.5"
          step="0.01"
          value={deadzone}
          onChange={event => onDeadzoneChange(Number(event.target.value))}
        />
      </div>

      <h4>
        Button Operations <span className="physical-binding-count">{configuredCount}/17 configured</span>
      </h4>
      <p className="settings-help">
        Select any standard controller button, then assign independent press and release topic, service, or action
        operations.
      </p>
      <div className="physical-control-picker" role="list" aria-label="Physical controller buttons">
        {PHYSICAL_GAMEPAD_CONTROLS.map(({ id }) => {
          const configured = Boolean(bindings[id]?.press || bindings[id]?.release);
          return (
            <button
              key={id}
              type="button"
              className={`${selectedControl === id ? 'selected' : ''} ${configured ? 'configured' : ''}`}
              onClick={() => setSelectedControl(id)}
            >
              {getPhysicalGamepadControlLabel(id, labelsProfile)}
            </button>
          );
        })}
      </div>
      <fieldset className="physical-control-binding">
        <legend>{selectedLabel}</legend>
        <RosEventOperationsEditor
          events={['press', 'release']}
          value={bindings[selectedControl] || {}}
          ros={ros}
          onChange={updateSelectedBinding}
        />
      </fieldset>
    </div>
  );
};

export default PhysicalGamepadSettings;
