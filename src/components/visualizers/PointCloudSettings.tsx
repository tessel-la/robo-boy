import ScaleField from '../ScaleField';
import { ColorField } from '../SettingsFields';

export interface PointCloudSettingsOptions {
  pointSize: number;
  color: string;
  maxPoints?: number;
  // Axis-based coloring options
  colorAxis?: 'x' | 'y' | 'z' | 'none';
  minAxisValue?: number;
  maxAxisValue?: number;
  minColor?: string;
  maxColor?: string;
  // Saved by earlier versions, whose settings could switch each value off. The viewer still reads
  // them, so every edit here switches its value back on.
  pointSizeEnabled: boolean;
  colorEnabled: boolean;
  maxPointsEnabled: boolean;
}

const DEFAULTS = { pointSize: 0.05, color: '#00ff00', maxPoints: 200000 };

export default function PointCloudSettings({
  id,
  topic,
  options,
  onChange,
}: {
  id: string;
  topic: string;
  options?: Partial<PointCloudSettingsOptions>;
  onChange: (id: string, patch: Partial<PointCloudSettingsOptions>) => void;
}) {
  const label = `Point cloud on ${topic}`;
  return (
    <div className="layer-settings">
      <div className="viz-settings-group">
        <ScaleField
          id={`pointcloud-size-${id}`}
          label="Point size"
          ariaLabel={`Point size in metres for ${label}`}
          min={0.001}
          max={0.5}
          precision={3}
          value={options?.pointSize ?? DEFAULTS.pointSize}
          onChange={pointSize => onChange(id, { pointSize, pointSizeEnabled: true })}
        />
        <ScaleField
          id={`pointcloud-max-${id}`}
          label="Max points"
          ariaLabel={`Maximum points for ${label}`}
          unit=""
          min={1000}
          max={1000000}
          precision={0}
          value={options?.maxPoints ?? DEFAULTS.maxPoints}
          onChange={maxPoints => onChange(id, { maxPoints: Math.round(maxPoints), maxPointsEnabled: true })}
        />
        <ColorField
          id={`pointcloud-color-${id}`}
          label="Color"
          ariaLabel={`Color for ${label}`}
          value={options?.color ?? DEFAULTS.color}
          onChange={color => onChange(id, { color, colorEnabled: true })}
        />
      </div>
    </div>
  );
}
