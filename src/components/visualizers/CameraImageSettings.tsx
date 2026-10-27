import WebRtcSourceSettings from '../WebRtcSourceSettings';
import ScaleField from '../ScaleField';
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
  return (
    <div className="navigation-layer-settings panel-settings">
      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={values.visible}
          aria-label={`Show ${label}`}
          onChange={e => onChange(id, { visible: e.target.checked })}
        />
        <span>Show layer</span>
      </label>
      <div className="panel-settings-field">
        <label className="viz-topic-label" htmlFor={`camera-source-${id}`}>
          Image source
        </label>
        <select
          id={`camera-source-${id}`}
          className="topic-dropdown"
          aria-label={`Image source for ${label}`}
          value={values.imageSource}
          onChange={e =>
            onChange(id, {
              imageSource: e.target.value as CameraImageOptions['imageSource'],
              ...(e.target.value === 'webrtc' ? { videoTiming: 'latest' as const } : {}),
            })
          }
        >
          <option value="stream">Camera streamer</option>
          <option value="ros">ROS image messages</option>
          <option value="webrtc">WebRTC</option>
        </select>
      </div>
      {values.imageSource === 'stream' && (
        <>
          <div className="panel-settings-field">
            <label className="viz-topic-label" htmlFor={`camera-quality-${id}`}>
              Stream quality
            </label>
            <select
              id={`camera-quality-${id}`}
              className="topic-dropdown"
              aria-label={`Stream quality for ${label}`}
              value={values.streamQuality}
              onChange={e => onChange(id, { streamQuality: e.target.value as CameraImageOptions['streamQuality'] })}
            >
              {(['low', 'medium', 'high', 'original'] as const).map(quality => (
                <option key={quality} value={quality}>
                  {CAMERA_STREAM_PRESETS[quality].label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      {values.imageSource !== 'ros' && (
        <>
          {values.imageSource === 'stream' && (
            <label className="panel-settings-field">
              TF timing
              <select
                aria-label={`TF timing for ${label}`}
                value={values.videoTiming}
                onChange={event => onChange(id, { videoTiming: event.target.value as 'capture' | 'latest' })}
              >
                <option value="capture">Capture time (requires frame timestamps)</option>
                <option value="latest">Latest TF (not time-synchronized)</option>
              </select>
            </label>
          )}
          {(values.videoTiming === 'latest' || values.imageSource === 'webrtc') && (
            <label className="panel-settings-field">
              Optical frame override
              <input
                aria-label={`Optical frame for ${label}`}
                defaultValue={values.opticalFrame}
                placeholder="Use selected CameraInfo frame"
                onBlur={event => onChange(id, { opticalFrame: event.target.value.trim() })}
              />
            </label>
          )}
        </>
      )}
      {values.imageSource !== 'ros' && (
        <label className="panel-settings-field">
          Projection update rate
          <select
            aria-label={`Projection update rate for ${label}`}
            value={values.projectionFps}
            onChange={event => onChange(id, { projectionFps: Number(event.target.value) })}
          >
            {[0, 5, 10, 15, 30, 60].map(fps => (
              <option key={fps} value={fps}>
                {fps ? `${fps} fps` : 'Source frame rate'}
              </option>
            ))}
          </select>
        </label>
      )}
      {values.imageSource === 'webrtc' && (
        <WebRtcSourceSettings value={values} onChange={patch => onChange(id, patch)} />
      )}
      <div className="panel-settings-field">
        <label className="viz-topic-label" htmlFor={`camera-info-${id}`}>
          CameraInfo topic
        </label>
        <select
          id={`camera-info-${id}`}
          className="topic-dropdown"
          aria-label={`CameraInfo topic for ${label}`}
          value={values.cameraInfoTopic}
          onChange={e => onChange(id, { cameraInfoTopic: e.target.value })}
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
        </select>
      </div>
      <div className="panel-settings-field">
        <label className="viz-topic-label" htmlFor={`camera-geometry-${id}`}>
          Image geometry
        </label>
        <select
          id={`camera-geometry-${id}`}
          className="topic-dropdown"
          aria-label={`Image geometry for ${label}`}
          value={values.imageGeometry}
          onChange={e => onChange(id, { imageGeometry: e.target.value as 'raw' | 'rectified' })}
        >
          <option value="raw">Raw (zero distortion)</option>
          <option value="rectified">Rectified</option>
        </select>
      </div>
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
      <div className="tf-scale-control">
        <div className="control-heading-row">
          <label htmlFor={`camera-opacity-${id}`}>Image opacity</label>
          <output className="range-value" htmlFor={`camera-opacity-${id}`}>
            {Math.round(values.opacity * 100)}%
          </output>
        </div>
        <input
          id={`camera-opacity-${id}`}
          className="range-input"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={values.opacity}
          aria-label={`Image opacity for ${label}`}
          onChange={e => onChange(id, { opacity: Number(e.target.value) })}
        />
      </div>
      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={values.showFrustum}
          aria-label={`Show frustum for ${label}`}
          onChange={e => onChange(id, { showFrustum: e.target.checked })}
        />
        <span>Show frustum</span>
      </label>
      {(values.imageSource === 'ros' || (values.imageSource === 'stream' && values.videoTiming !== 'latest')) && (
        <>
          <div className="panel-settings-field">
            <label className="viz-topic-label" htmlFor={`camera-sync-${id}`}>
              Calibration timing
            </label>
            <select
              id={`camera-sync-${id}`}
              className="topic-dropdown"
              value={values.calibrationSync}
              aria-label={`Calibration timing for ${label}`}
              onChange={e => onChange(id, { calibrationSync: e.target.value as 'exact' | 'latest' })}
            >
              <option value="exact">Match image timestamp</option>
              <option value="latest">Latest (static calibration)</option>
            </select>
          </div>
          {values.calibrationSync === 'exact' && (
            <div className="control-heading-row">
              <label htmlFor={`camera-tolerance-${id}`}>Tolerance (ms)</label>
              <input
                id={`camera-tolerance-${id}`}
                className="scale-field-number"
                type="number"
                min="0"
                max="1000"
                step="1"
                value={values.toleranceMs}
                aria-label={`Calibration tolerance in milliseconds for ${label}`}
                onChange={e => {
                  if (Number.isFinite(e.target.valueAsNumber)) onChange(id, { toleranceMs: e.target.valueAsNumber });
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
