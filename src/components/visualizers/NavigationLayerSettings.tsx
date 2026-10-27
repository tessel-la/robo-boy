import { normalizeNavigationOptions, type NavigationDisplayOptions } from '../../utils/navigationOptions';
import { GRID_UPDATE_TYPES } from '../../utils/occupancyGridData';
import ScaleField from '../ScaleField';

export default function NavigationLayerSettings({
  id,
  type,
  topic,
  options,
  onChange,
  topics = [],
}: {
  id: string;
  type: 'path' | 'occupancygrid';
  topic: string;
  options?: NavigationDisplayOptions;
  topics?: { name: string; type: string }[];
  onChange: (id: string, patch: NavigationDisplayOptions) => void;
}) {
  const values = normalizeNavigationOptions(options, type === 'occupancygrid');
  const label = `${type === 'path' ? 'Path' : 'Occupancy grid'} on ${topic}`;
  return (
    <div className="navigation-layer-settings panel-settings">
      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={values.visible}
          aria-label={`Show ${label}`}
          onChange={event => onChange(id, { visible: event.target.checked })}
        />{' '}
        Show layer
      </label>
      {type === 'path' && (
        <>
          <div className="control-heading-row">
            <label htmlFor={`path-color-${id}`}>Color</label>
            <input
              type="color"
              id={`path-color-${id}`}
              aria-label={`Color for ${label}`}
              value={values.color}
              onChange={event => onChange(id, { color: event.target.value })}
            />
          </div>
          <ScaleField
            id={`path-width-${id}`}
            label="Line width"
            ariaLabel={`Line width in metres for ${label}`}
            min={0.001}
            max={1}
            precision={3}
            value={values.lineWidth}
            onChange={lineWidth => onChange(id, { lineWidth })}
          />
        </>
      )}
      {type === 'occupancygrid' && (
        <>
          <label className="panel-settings-field">
            <span>Color scheme</span>
            <select
              aria-label={`Color scheme for ${label}`}
              value={values.palette}
              onChange={event => onChange(id, { palette: event.target.value as 'occupancy' | 'costmap' })}
            >
              <option value="occupancy">Occupancy</option>
              <option value="costmap">Costmap (RViz)</option>
            </select>
          </label>
          <label className="panel-settings-field">
            <span>Updates topic</span>
            <select
              aria-label={`Updates topic for ${label}`}
              value={values.updatesTopic}
              onChange={event => onChange(id, { updatesTopic: event.target.value })}
            >
              <option value="">Full maps only</option>
              {values.updatesTopic &&
                !topics.some(item => item.name === values.updatesTopic && GRID_UPDATE_TYPES.includes(item.type)) && (
                  <option value={values.updatesTopic}>{values.updatesTopic} (current)</option>
                )}
              {topics
                .filter(item => item.name !== topic && GRID_UPDATE_TYPES.includes(item.type))
                .map(item => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="panel-settings-status">
            {values.palette === 'costmap'
              ? 'Free 0 (transparent), inflated 1–98, inscribed 99 (cyan), lethal 100 (magenta), unknown −1 (gray). '
              : ''}
            {values.updatesTopic
              ? 'Updates require a full map first. Invalid updates or reconnects wait for a new full map. ROS 2 messages cannot reveal every missed update.'
              : 'Select this map’s matching OccupancyGridUpdate topic to apply incremental changes.'}
          </p>
        </>
      )}
      <div className="tf-scale-control">
        <div className="control-heading-row">
          <label htmlFor={`navigation-opacity-${id}`}>Opacity</label>
          <output htmlFor={`navigation-opacity-${id}`} className="range-value">
            {Math.round(values.opacity * 100)}%
          </output>
        </div>
        <input
          type="range"
          id={`navigation-opacity-${id}`}
          min="0"
          max="1"
          step="0.05"
          className="range-input"
          aria-label={`Opacity for ${label}`}
          value={values.opacity}
          onChange={event => onChange(id, { opacity: Number(event.target.value) })}
        />
      </div>
    </div>
  );
}
