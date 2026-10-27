import ScaleField from '../ScaleField';
import WebRtcSourceSettings from '../WebRtcSourceSettings';
import { NumberField, PercentField, SelectField, TextField, ToggleRow } from '../SettingsFields';
import { CAMERA_STREAM_PRESETS } from '../../utils/cameraStreamQuality';
import { CAMERA_INFO_TYPES } from '../../utils/images/cameraCalibration';
import {
  cameraInfoTopicFor,
  normalizeCameraImageOptions,
  type CameraImageOptions,
} from '../../utils/images/cameraImageOptions';

export default function CameraImageSettings({
  id,
  topic,
  options,
  topics,
  onChange,
}: {
  id: string;
  topic: string;
  options?: CameraImageOptions;
  topics: { name: string; type: string }[];
  onChange: (id: string, options: CameraImageOptions) => void;
}) {
  const values = normalizeCameraImageOptions(
    { ...options, cameraInfoTopic: options?.cameraInfoTopic ?? cameraInfoTopicFor(topic, topics) },
    topic
  );
  const infoTopics = topics.filter(item => CAMERA_INFO_TYPES.includes(item.type));
  const label = `Camera image on ${topic}`;
  const isVideo = values.imageSource !== 'ros';
  const usesLatestTf = values.imageSource === 'webrtc' || (values.imageSource === 'stream' && values.videoTiming === 'latest');
  return (
    <div className="layer-settings">
      <ToggleRow
        label="Show layer"
        ariaLabel={`Show ${label}`}
        checked={values.visible}
        onChange={visible => onChange(id, { visible })}
      />
      <SelectField
        id={`camera-source-${id}`}
        label="Image source"
        ariaLabel={`Image source for ${label}`}
        value={values.imageSource}
        onChange={imageSource =>
          onChange(id, {
            imageSource: imageSource as CameraImageOptions['imageSource'],
            ...(imageSource === 'webrtc' ? { videoTiming: 'latest' as const } : {}),
          })
        }
      >
        <option value="stream">Camera streamer</option>
        <option value="ros">ROS image messages</option>
        <option value="webrtc">WebRTC</option>
      </SelectField>
      {values.imageSource === 'stream' && (
        <>
          <SelectField
            id={`camera-quality-${id}`}
            label="Stream quality"
            ariaLabel={`Stream quality for ${label}`}
            value={values.streamQuality}
            onChange={quality => onChange(id, { streamQuality: quality as CameraImageOptions['streamQuality'] })}
          >
            {(['low', 'medium', 'high', 'original'] as const).map(quality => (
              <option key={quality} value={quality}>
                {CAMERA_STREAM_PRESETS[quality].label}
              </option>
            ))}
          </SelectField>
          <SelectField
            id={`camera-timing-${id}`}
            label="TF timing"
            ariaLabel={`TF timing for ${label}`}
            value={values.videoTiming}
            onChange={videoTiming => onChange(id, { videoTiming: videoTiming as 'capture' | 'latest' })}
          >
            <option value="capture">Capture time (requires frame timestamps)</option>
            <option value="latest">Latest TF (not time-synchronized)</option>
          </SelectField>
        </>
      )}
      {values.imageSource === 'webrtc' && (
        <WebRtcSourceSettings value={values} onChange={patch => onChange(id, patch)} />
      )}
      {usesLatestTf && (
        <TextField
          id={`camera-optical-frame-${id}`}
          label="Optical frame override"
          ariaLabel={`Optical frame for ${label}`}
          value={values.opticalFrame}
          placeholder="Use selected CameraInfo frame"
          onChange={opticalFrame => onChange(id, { opticalFrame })}
        />
      )}
      {isVideo && (
        <SelectField
          id={`camera-projection-rate-${id}`}
          label="Projection update rate"
          ariaLabel={`Projection update rate for ${label}`}
          value={String(values.projectionFps)}
          onChange={fps => onChange(id, { projectionFps: Number(fps) })}
        >
          {[0, 5, 10, 15, 30, 60].map(fps => (
            <option key={fps} value={fps}>
              {fps ? `${fps} fps` : 'Source frame rate'}
            </option>
          ))}
        </SelectField>
      )}
      <SelectField
        id={`camera-info-${id}`}
        label="CameraInfo topic"
        ariaLabel={`CameraInfo topic for ${label}`}
        value={values.cameraInfoTopic}
        onChange={cameraInfoTopic => onChange(id, { cameraInfoTopic })}
      >
        <option value="">Select matching calibration</option>
        {values.cameraInfoTopic && !infoTopics.some(item => item.name === values.cameraInfoTopic) && (
          <option value={values.cameraInfoTopic}>{values.cameraInfoTopic} (current)</option>
        )}
        {infoTopics.map(item => (
          <option key={item.name} value={item.name}>
            {item.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        id={`camera-geometry-${id}`}
        label="Image geometry"
        ariaLabel={`Image geometry for ${label}`}
        value={values.imageGeometry}
        onChange={imageGeometry => onChange(id, { imageGeometry: imageGeometry as 'raw' | 'rectified' })}
      >
        <option value="raw">Raw (zero distortion)</option>
        <option value="rectified">Rectified</option>
      </SelectField>
      <div className="viz-settings-group">
        <ScaleField
          id={`camera-distance-${id}`}
          label="Image plane distance"
          ariaLabel={`Image plane distance in metres for ${label}`}
          value={values.distance}
          min={0.01}
          max={100}
          precision={2}
          onChange={distance => onChange(id, { distance })}
        />
        <PercentField
          id={`camera-opacity-${id}`}
          label="Image opacity"
          ariaLabel={`Image opacity for ${label}`}
          value={values.opacity}
          onChange={opacity => onChange(id, { opacity })}
        />
      </div>
      <ToggleRow
        label="Show frustum"
        ariaLabel={`Show frustum for ${label}`}
        checked={values.showFrustum}
        onChange={showFrustum => onChange(id, { showFrustum })}
      />
      {!usesLatestTf && (
        <>
          <SelectField
            id={`camera-sync-${id}`}
            label="Calibration timing"
            ariaLabel={`Calibration timing for ${label}`}
            value={values.calibrationSync}
            onChange={calibrationSync => onChange(id, { calibrationSync: calibrationSync as 'exact' | 'latest' })}
          >
            <option value="exact">Match image timestamp</option>
            <option value="latest">Latest (static calibration)</option>
          </SelectField>
          {values.calibrationSync === 'exact' && (
            <div className="viz-settings-group">
              <NumberField
                id={`camera-tolerance-${id}`}
                label="Tolerance"
                ariaLabel={`Calibration tolerance in milliseconds for ${label}`}
                value={values.toleranceMs}
                unit="ms"
                min={0}
                max={1000}
                onChange={toleranceMs => onChange(id, { toleranceMs })}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
