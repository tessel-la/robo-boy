import { normalizeMeshOpacity, type MeshDisplayOptions } from '../../utils/meshOpacity';
import type { NavigationDisplayOptions } from '../../utils/navigationOptions';
import type { CameraImageOptions } from '../../utils/images/cameraImageOptions';
import { jointDescriptionTopic, type JointStateOptions } from '../../utils/jointStates';
import type { VisualizationConfig } from '../VisualizationPanel';
import { PercentField } from '../SettingsFields';
import CameraImageSettings from './CameraImageSettings';
import JointStateSettings from './JointStateSettings';
import LaserScanSettings, { type LaserScanSettingsOptions } from './LaserScanSettings';
import NavigationLayerSettings from './NavigationLayerSettings';
import PointCloudSettings, { type PointCloudSettingsOptions } from './PointCloudSettings';
import PoseStampedSettings, { type PoseStampedSettingsOptions } from './PoseStampedSettings';

export type LayerOptionsPatch = NonNullable<VisualizationConfig['options']>;

const CONFIGURABLE = new Set<VisualizationConfig['type']>([
  'pointcloud',
  'laserscan',
  'posestamped',
  'path',
  'occupancygrid',
  'cameraimage',
  'urdf',
  'markerarray',
  'jointstate',
]);

/** Whether a layer type has settings of its own, behind its configure button. */
export const hasLayerSettings = (type: VisualizationConfig['type']) => CONFIGURABLE.has(type);

/** The settings of one 3D layer. Each change applies at once and is saved with the panel. */
export default function LayerSettings({
  viz,
  typeLabel,
  topics,
  onChange,
}: {
  viz: VisualizationConfig;
  typeLabel: string;
  topics: { name: string; type: string }[];
  onChange: (id: string, patch: LayerOptionsPatch) => void;
}) {
  switch (viz.type) {
    case 'pointcloud':
      return (
        <PointCloudSettings
          id={viz.id}
          topic={viz.topic}
          options={viz.options as Partial<PointCloudSettingsOptions>}
          onChange={onChange}
        />
      );
    case 'laserscan':
      return (
        <LaserScanSettings
          id={viz.id}
          topic={viz.topic}
          options={viz.options as LaserScanSettingsOptions}
          onChange={onChange}
        />
      );
    case 'posestamped':
      return (
        <PoseStampedSettings
          id={viz.id}
          topic={viz.topic}
          options={viz.options as PoseStampedSettingsOptions}
          onChange={onChange}
        />
      );
    case 'path':
    case 'occupancygrid':
      return (
        <NavigationLayerSettings
          id={viz.id}
          type={viz.type}
          topic={viz.topic}
          options={viz.options as NavigationDisplayOptions}
          topics={topics}
          onChange={onChange}
        />
      );
    case 'cameraimage':
      return (
        <CameraImageSettings
          id={viz.id}
          topic={viz.topic}
          options={viz.options as CameraImageOptions}
          topics={topics}
          onChange={onChange}
        />
      );
    case 'jointstate': {
      const options = viz.options as JointStateOptions | undefined;
      return (
        <JointStateSettings
          id={viz.id}
          topic={viz.topic}
          options={options}
          topics={topics}
          descriptionTopic={options?.robotDescriptionTopic ?? jointDescriptionTopic(viz.topic, topics)}
          onChange={onChange}
        />
      );
    }
    case 'urdf':
    case 'markerarray':
      return (
        <div className="layer-settings">
          <div className="viz-settings-group">
            <PercentField
              id={`mesh-opacity-${viz.id}`}
              label="Mesh opacity"
              ariaLabel={`Mesh opacity for ${typeLabel} on ${viz.topic}`}
              value={normalizeMeshOpacity((viz.options as MeshDisplayOptions)?.opacity)}
              onChange={opacity => onChange(viz.id, { opacity })}
            />
          </div>
        </div>
      );
    default:
      return null;
  }
}
