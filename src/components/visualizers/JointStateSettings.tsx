import { normalizeJointStateOptions, type JointStateOptions } from '../../utils/jointStates';
import type { RosTopicInfo } from '../../utils/urdfTopics';
import { PercentField, SelectField, ToggleRow } from '../SettingsFields';

export default function JointStateSettings({
  id,
  topic,
  options,
  descriptionTopic,
  topics,
  onChange,
}: {
  id: string;
  topic: string;
  options?: JointStateOptions;
  descriptionTopic: string;
  topics: RosTopicInfo[];
  onChange: (id: string, patch: JointStateOptions) => void;
}) {
  const values = normalizeJointStateOptions(options);
  const descriptions = topics.filter(item => ['std_msgs/String', 'std_msgs/msg/String'].includes(item.type));
  const label = `Joint states on ${topic}`;
  return (
    <div className="layer-settings">
      <ToggleRow
        label="Show overlay"
        ariaLabel={`Show ${label}`}
        checked={values.visible}
        onChange={visible => onChange(id, { visible })}
      />
      <SelectField
        id={`joint-description-${id}`}
        label="Robot description (limits)"
        value={descriptionTopic}
        onChange={robotDescriptionTopic => onChange(id, { robotDescriptionTopic })}
      >
        <option value="">None</option>
        {descriptionTopic && !descriptions.some(item => item.name === descriptionTopic) && (
          <option value={descriptionTopic}>{descriptionTopic} (current)</option>
        )}
        {descriptions.map(item => (
          <option key={item.name} value={item.name}>
            {item.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        id={`joint-unit-${id}`}
        label="Angle units"
        value={values.angleUnit}
        onChange={angleUnit => onChange(id, { angleUnit: angleUnit as 'rad' | 'deg' })}
      >
        <option value="rad">Radians</option>
        <option value="deg">Degrees</option>
      </SelectField>
      <div className="settings-field">
        <label className="viz-topic-label" htmlFor={`joint-filter-${id}`}>
          Filter joint names
        </label>
        <input
          id={`joint-filter-${id}`}
          type="text"
          className="settings-text-input"
          maxLength={128}
          placeholder="All joints"
          value={values.filter}
          onChange={event => onChange(id, { filter: event.target.value })}
        />
      </div>
      <ToggleRow
        label="Show velocity"
        ariaLabel={`Show velocity for ${label}`}
        checked={values.showVelocity}
        onChange={showVelocity => onChange(id, { showVelocity })}
      />
      <ToggleRow
        label="Show effort"
        ariaLabel={`Show effort for ${label}`}
        checked={values.showEffort}
        onChange={showEffort => onChange(id, { showEffort })}
      />
      <div className="viz-settings-group">
        <PercentField
          id={`joint-opacity-${id}`}
          label="Background opacity"
          value={values.backgroundOpacity}
          onChange={backgroundOpacity => onChange(id, { backgroundOpacity })}
        />
      </div>
      <button type="button" className="panel-settings-action" onClick={() => onChange(id, { frame: undefined })}>
        Reset overlay position and size
      </button>
    </div>
  );
}
