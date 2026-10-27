import { normalizeJointStateOptions, type JointStateOptions } from '../../utils/jointStates';
import type { RosTopicInfo } from '../../utils/urdfTopics';

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
    <div className="panel-settings joint-state-settings">
      {(['visible', 'showVelocity', 'showEffort'] as const).map((key, i) => (
        <label key={key} className="settings-toggle-row">
          <input
            type="checkbox"
            checked={values[key]}
            aria-label={`${['Show', 'Show velocity for', 'Show effort for'][i]} ${label}`}
            onChange={event => onChange(id, { [key]: event.target.checked })}
          />{' '}
          {['Show overlay', 'Show velocity', 'Show effort'][i]}
        </label>
      ))}
      <div className="panel-settings-field">
        <label htmlFor={`joint-description-${id}`}>Robot description (limits)</label>
        <select
          id={`joint-description-${id}`}
          className="topic-dropdown"
          value={descriptionTopic}
          onChange={event => onChange(id, { robotDescriptionTopic: event.target.value })}
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
        </select>
      </div>
      <div className="panel-settings-field">
        <label htmlFor={`joint-unit-${id}`}>Angle units</label>
        <select
          id={`joint-unit-${id}`}
          className="topic-dropdown"
          value={values.angleUnit}
          onChange={event => onChange(id, { angleUnit: event.target.value as 'rad' | 'deg' })}
        >
          <option value="rad">Radians</option>
          <option value="deg">Degrees</option>
        </select>
      </div>
      <label className="panel-settings-field" htmlFor={`joint-filter-${id}`}>
        Filter joint names
        <input
          id={`joint-filter-${id}`}
          type="text"
          className="topic-dropdown"
          maxLength={128}
          placeholder="All joints"
          value={values.filter}
          onChange={event => onChange(id, { filter: event.target.value })}
        />
      </label>
      <div className="tf-scale-control">
        <div className="control-heading-row">
          <label htmlFor={`joint-opacity-${id}`}>Background opacity</label>
          <output className="range-value" htmlFor={`joint-opacity-${id}`}>
            {Math.round(values.backgroundOpacity * 100)}%
          </output>
        </div>
        <input
          id={`joint-opacity-${id}`}
          className="range-input"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={values.backgroundOpacity}
          onChange={event => onChange(id, { backgroundOpacity: Number(event.target.value) })}
        />
      </div>
      <button type="button" className="panel-settings-action" onClick={() => onChange(id, { frame: undefined })}>
        Reset overlay position and size
      </button>
    </div>
  );
}
