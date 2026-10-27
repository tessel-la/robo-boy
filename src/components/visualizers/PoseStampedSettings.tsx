import { PoseStampedOptions } from '../../hooks/usePoseStampedClient';
import ScaleField from '../ScaleField';
import { ColorField, SelectField, ToggleRow } from '../SettingsFields';

export interface PoseStampedSettingsOptions extends PoseStampedOptions {
  // Saved by earlier versions, whose settings could switch a value back to its default. The pose
  // client still honours them, so the form shows the value in effect and every edit switches it on.
  scaleEnabled?: boolean;
  colorEnabled?: boolean;
  arrowDimensionsEnabled?: boolean;
  trailEnabled?: boolean;
}

const DEFAULTS = { scale: 1, color: '#00ff00', arrowLength: 1, arrowWidth: 0.1, axesSize: 0.5, maxTrailLength: 50 };

export default function PoseStampedSettings({
  id,
  topic,
  options = {},
  onChange,
}: {
  id: string;
  topic: string;
  options?: PoseStampedSettingsOptions;
  onChange: (id: string, patch: PoseStampedSettingsOptions) => void;
}) {
  const label = `Pose on ${topic}`;
  const sized = options.arrowDimensionsEnabled !== false;
  const scale = options.scaleEnabled !== false ? options.scale ?? DEFAULTS.scale : DEFAULTS.scale;
  const color = options.colorEnabled !== false && typeof options.color === 'string' ? options.color : DEFAULTS.color;
  const showTrail = options.trailEnabled === true && options.showTrail !== false;
  const shape = options.visualizationType ?? 'arrow';
  return (
    <div className="layer-settings">
      <SelectField
        id={`pose-shape-${id}`}
        label="Shape"
        ariaLabel={`Shape for ${label}`}
        value={shape}
        onChange={visualizationType => onChange(id, { visualizationType: visualizationType as 'arrow' | 'axes' })}
      >
        <option value="arrow">Arrow</option>
        <option value="axes">Axes</option>
      </SelectField>
      <div className="viz-settings-group">
        <ScaleField
          id={`pose-scale-${id}`}
          label="Scale"
          ariaLabel={`Scale for ${label}`}
          unit="×"
          min={0.1}
          max={5}
          value={scale}
          onChange={value => onChange(id, { scale: value, scaleEnabled: true })}
        />
        {shape === 'arrow' ? (
          <>
            <ScaleField
              id={`pose-length-${id}`}
              label="Arrow length"
              ariaLabel={`Arrow length in metres for ${label}`}
              min={0.05}
              max={3}
              value={sized ? options.arrowLength ?? DEFAULTS.arrowLength : DEFAULTS.arrowLength}
              onChange={arrowLength => onChange(id, { arrowLength, arrowDimensionsEnabled: true })}
            />
            <ScaleField
              id={`pose-width-${id}`}
              label="Arrow width"
              ariaLabel={`Arrow width in metres for ${label}`}
              min={0.005}
              max={0.5}
              precision={3}
              value={sized ? options.arrowWidth ?? DEFAULTS.arrowWidth : DEFAULTS.arrowWidth}
              onChange={arrowWidth => onChange(id, { arrowWidth, arrowDimensionsEnabled: true })}
            />
          </>
        ) : (
          <ScaleField
            id={`pose-axes-${id}`}
            label="Axes length"
            ariaLabel={`Axes length in metres for ${label}`}
            min={0.05}
            max={2}
            value={sized ? options.axesSize ?? DEFAULTS.axesSize : DEFAULTS.axesSize}
            onChange={axesSize => onChange(id, { axesSize, arrowDimensionsEnabled: true })}
          />
        )}
        <ColorField
          id={`pose-color-${id}`}
          label="Color"
          ariaLabel={`Color for ${label}`}
          value={color}
          onChange={value => onChange(id, { color: value, colorEnabled: true })}
        />
      </div>
      <ToggleRow
        label="Show trail"
        ariaLabel={`Show trail for ${label}`}
        checked={showTrail}
        onChange={checked => onChange(id, { trailEnabled: checked, showTrail: checked })}
      />
      <div className="viz-settings-group">
        <ScaleField
          id={`pose-trail-${id}`}
          label="Trail length"
          ariaLabel={`Trail length in poses for ${label}`}
          unit="poses"
          min={5}
          max={500}
          precision={0}
          disabled={!showTrail}
          value={options.maxTrailLength ?? DEFAULTS.maxTrailLength}
          onChange={value => onChange(id, { maxTrailLength: Math.round(value) })}
        />
      </div>
    </div>
  );
}
