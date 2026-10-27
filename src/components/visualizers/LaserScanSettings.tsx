import * as THREE from 'three';
import { LaserScanOptions } from './LaserScanViz';
import ScaleField from '../ScaleField';
import { ColorField, NumberField } from '../SettingsFields';

export interface LaserScanSettingsOptions extends LaserScanOptions {}

// The viewer draws scan points at a fixed screen size, so their size is in pixels.
const DEFAULTS = { pointSize: 1, pointColor: '#0000ff', minRange: 0, maxRange: 100 };

const colorString = (color: string | THREE.Color | undefined) =>
  typeof color === 'string' ? color : color instanceof THREE.Color ? `#${color.getHexString()}` : DEFAULTS.pointColor;

export default function LaserScanSettings({
  id,
  topic,
  options,
  onChange,
}: {
  id: string;
  topic: string;
  options?: LaserScanSettingsOptions;
  onChange: (id: string, patch: LaserScanSettingsOptions) => void;
}) {
  const label = `Laser scan on ${topic}`;
  const minRange = options?.minRange ?? DEFAULTS.minRange;
  const maxRange = options?.maxRange ?? DEFAULTS.maxRange;
  return (
    <div className="layer-settings">
      <div className="viz-settings-group">
        <ScaleField
          id={`laserscan-size-${id}`}
          label="Point size"
          ariaLabel={`Point size in pixels for ${label}`}
          unit="px"
          min={0.5}
          max={10}
          precision={1}
          value={options?.pointSize ?? DEFAULTS.pointSize}
          onChange={pointSize => onChange(id, { pointSize })}
        />
        <ColorField
          id={`laserscan-color-${id}`}
          label="Color"
          ariaLabel={`Color for ${label}`}
          value={colorString(options?.pointColor)}
          onChange={pointColor => onChange(id, { pointColor })}
        />
      </div>
      <div className="viz-settings-group">
        <NumberField
          id={`laserscan-min-${id}`}
          label="Min range"
          ariaLabel={`Minimum range in metres for ${label}`}
          unit="m"
          min={0}
          max={maxRange}
          step={0.1}
          value={minRange}
          onChange={value => onChange(id, { minRange: value })}
        />
        <NumberField
          id={`laserscan-max-${id}`}
          label="Max range"
          ariaLabel={`Maximum range in metres for ${label}`}
          unit="m"
          min={minRange}
          max={1000}
          step={0.1}
          value={maxRange}
          onChange={value => onChange(id, { maxRange: value })}
        />
      </div>
    </div>
  );
}
