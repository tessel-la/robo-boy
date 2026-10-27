import { normalizeNavigationOptions, type NavigationDisplayOptions } from '../../utils/navigationOptions';
import ScaleField from '../ScaleField';
import { ColorField, PercentField, ToggleRow } from '../SettingsFields';

export default function NavigationLayerSettings({
  id,
  type,
  topic,
  options,
  onChange,
}: {
  id: string;
  type: 'path' | 'occupancygrid';
  topic: string;
  options?: NavigationDisplayOptions;
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
