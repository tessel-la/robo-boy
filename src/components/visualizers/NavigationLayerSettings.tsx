import { normalizeNavigationOptions, type NavigationDisplayOptions } from '../../utils/navigationOptions';
import ScaleField from '../ScaleField';

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
    <div className="navigation-layer-settings">
      <label className="checkbox-label">
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
