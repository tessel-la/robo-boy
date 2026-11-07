import { normalizeNavigationOptions, type NavigationDisplayOptions } from '../../utils/navigationOptions';
import { GRID_UPDATE_TYPES } from '../../utils/occupancyGridData';
import ScaleField from '../ScaleField';
import { ColorField, PercentField, SelectField, ToggleRow } from '../SettingsFields';

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
    <div className="layer-settings">
      <ToggleRow
        label="Show layer"
        ariaLabel={`Show ${label}`}
        checked={values.visible}
        onChange={visible => onChange(id, { visible })}
      />
      {type === 'occupancygrid' && (
        <>
          <SelectField
            id={`map-palette-${id}`}
            label="Color scheme"
            ariaLabel={`Color scheme for ${label}`}
            value={values.palette}
            onChange={palette => onChange(id, { palette: palette as 'occupancy' | 'costmap' })}
          >
            <option value="occupancy">Occupancy</option>
            <option value="costmap">Costmap (RViz)</option>
          </SelectField>
          <SelectField
            id={`map-updates-${id}`}
            label="Updates topic"
            ariaLabel={`Updates topic for ${label}`}
            value={values.updatesTopic}
            onChange={updatesTopic => onChange(id, { updatesTopic })}
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
          </SelectField>
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
      <div className="viz-settings-group">
        {type === 'path' && (
          <>
            <ColorField
              id={`path-color-${id}`}
              label="Color"
              ariaLabel={`Color for ${label}`}
              value={values.color}
              onChange={color => onChange(id, { color })}
            />
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
        <PercentField
          id={`navigation-opacity-${id}`}
          label="Opacity"
          ariaLabel={`Opacity for ${label}`}
          value={values.opacity}
          onChange={opacity => onChange(id, { opacity })}
        />
      </div>
    </div>
  );
}
