import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Ros } from 'roslib';
import { FiCamera, FiDownload, FiEye, FiMaximize, FiPause, FiPlay, FiX } from 'react-icons/fi';
import type { CameraImageClient, CameraInspection } from '../../utils/ros3d/visualizers/CameraImage';
import { cameraFramePng, downloadCameraBlob } from '../../utils/images/cameraSnapshot';
import { requestCameraCapture } from '../../utils/images/cameraCapture';
import {
  cameraPanelTopic,
  normalizeCameraImageOptions,
  type CameraImageOptions,
  type CameraCaptureOptions,
} from '../../utils/images/cameraImageOptions';
import { isReplayRos } from '../../features/recordReplay/ReplaySession';
import { rosStamp } from '../../utils/rosTime';
import { subscribeToCameraInfo } from '../../utils/images/cameraStreams';
import type { CameraCalibration } from '../../utils/images/cameraCalibration';
import type { Viewer } from '../../utils/ros3d';
import { focusCamera } from '../../utils/images/cameraInteraction';
import type { WorkspaceOpenRequest } from '../workspaceOpenRequest';
import './CameraInspector.css';

const empty: CameraInspection = { frozen: false, status: null };
const emptySubscribe = () => () => {};
const emptySnapshot = () => empty;
const captureDefaults: CameraCaptureOptions = {
  kind: 'service',
  name: '',
  messageType: '',
  request: '{}',
  imagePath: 'image',
  imageType: 'sensor_msgs/Image',
  timeoutSec: 15,
};
const json = (value: unknown) =>
  JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), 2);
export default function CameraInspector({
  client,
  viewer,
  ros,
  topic: configuredTopic,
  options: configuredOptions,
  calibrationTopic,
  imageTopics = [],
  status,
  onChange,
  onClose,
  onOpen,
}: {
  client?: CameraImageClient;
  viewer: Viewer | null;
  ros: Ros | null;
  topic: string;
  calibrationTopic?: string;
  imageTopics?: { name: string; type: string }[];
  options: CameraImageOptions;
  status?: string | null;
  onChange: (patch: CameraImageOptions) => void;
  onClose: () => void;
  onOpen?: (request: WorkspaceOpenRequest) => void;
}) {
  const [selectedTopic, setSelectedTopic] = useState('');
  const topic = configuredTopic || selectedTopic;
  const options = calibrationTopic ? { ...configuredOptions, cameraInfoTopic: calibrationTopic } : configuredOptions;
  const [standaloneCalibration, setStandaloneCalibration] = useState<CameraCalibration>();
  useEffect(() => {
    if (client || !ros || !calibrationTopic) return;
    return subscribeToCameraInfo(ros, calibrationTopic, event =>
      setStandaloneCalibration(event.samples[event.samples.length - 1])
    );
  }, [client, ros, calibrationTopic]);
  const snapshot = useSyncExternalStore(client?.subscribe ?? emptySubscribe, client?.getSnapshot ?? emptySnapshot);
  const displayed = snapshot.displayed;
  const calibration = displayed?.calibration ?? snapshot.calibration ?? standaloneCalibration;
  const normalized = normalizeCameraImageOptions(options, topic);
  const replay = ros ? isReplayRos(ros) : false;
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [metadata, setMetadata] = useState(false);
  const capture = { ...captureDefaults, ...options.capture };
  const task = useRef<AbortController>();
  const mounted = useRef(true);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mounted.current = true;
    close.current?.focus();
    return () => {
      mounted.current = false;
      task.current?.abort();
    };
  }, []);
  const updateCapture = (patch: Partial<CameraCaptureOptions>) => onChange({ capture: { ...capture, ...patch } });
  const save = async (trigger: boolean) => {
    if (task.current) return;
    const abort = new AbortController();
    task.current = abort;
    setBusy(true);
    setError('');
    setNotice('');
    let release: (() => void) | undefined;
    try {
      const acquired = trigger && ros ? await requestCameraCapture(ros, capture, abort.signal) : undefined;
      release = acquired?.release;
      const current = client?.getSnapshot().displayed;
      const frame = acquired?.frame ?? current?.frame;
      if (!frame) throw new Error('No camera frame is available.');
      const details = {
        version: 1,
        topic,
        source: trigger ? capture.kind : replay ? 'recording' : normalized.imageSource,
        width: frame.image.width,
        height: frame.image.height,
        sourceSize: frame.sourceSize ?? { width: frame.image.width, height: frame.image.height },
        imageGeometry: trigger ? undefined : normalized.imageGeometry,
        header: frame.acquisitionHeader ?? frame.header,
        acquisitionStamp:
          (rosStamp((frame.acquisitionHeader ?? frame.header)?.stamp) ?? 0n) > 0n
            ? rosStamp((frame.acquisitionHeader ?? frame.header)?.stamp)!.toString()
            : null,
        calibration: trigger ? undefined : current?.calibration,
        fixedFrame: trigger ? undefined : current?.fixedFrame,
        pose: trigger ? undefined : { position: current?.position.toArray(), rotation: current?.rotation.toArray() },
        frozen: !trigger && client?.getSnapshot().frozen,
        status: trigger ? undefined : client?.getSnapshot().status,
        timing: trigger
          ? 'Camera acquisition'
          : (rosStamp(frame.header?.stamp) ?? 0n) > 0n
            ? 'Image acquisition timestamp'
            : 'Latest TF; not time-synchronized',
      };
      const name = `${topic.replace(/[^\w-]/g, '_').slice(0, 80) || 'camera'}-${Date.now()}`;
      const blob = await cameraFramePng(frame);
      if (abort.signal.aborted) return;
      downloadCameraBlob(blob, `${name}.png`);
      if (metadata) downloadCameraBlob(new Blob([json(details)], { type: 'application/json' }), `${name}.json`);
      setNotice(trigger ? 'Captured image saved.' : 'Displayed camera image saved.');
    } catch (reason) {
      if (!abort.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason || 'Camera snapshot failed.'));
    } finally {
      release?.();
      if (task.current === abort) {
        task.current = undefined;
        if (mounted.current) setBusy(false);
      }
    }
  };
  const open = (panel: WorkspaceOpenRequest['panel'], selectedTopic = topic, messageType = 'sensor_msgs/Image') =>
    onOpen?.({
      panel,
      topic: panel === 'camera' ? cameraPanelTopic(selectedTopic, normalized.imageSource) : selectedTopic,
      messageType,
      ...(panel === 'camera' ? { cameraOptions: options } : {}),
      ...(panel === 'recordReplay'
        ? { topics: [...new Set([topic, normalized.cameraInfoTopic, '/tf', '/tf_static'].filter(Boolean))] }
        : {}),
    });
  return (
    <section
      className="camera-inspector panel-settings"
      aria-label={`Camera inspector for ${configuredTopic || calibrationTopic}`}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <strong>
          <FiCamera aria-hidden="true" /> Camera
        </strong>
        <button
          ref={close}
          type="button"
          className="panel-settings-action"
          onClick={onClose}
          aria-label="Close camera inspector"
        >
          <FiX />
        </button>
      </header>
      <div className="camera-inspector-body">
        <p className="camera-inspector-topic">{configuredTopic || calibrationTopic}</p>
        {calibrationTopic && (
          <label className="panel-settings-field">
            Image topic
            <select value={selectedTopic} onChange={event => setSelectedTopic(event.target.value)}>
              <option value="">Select the corresponding image topic</option>
              {imageTopics.map(item => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p role="status" className="panel-settings-status">
          {snapshot.frozen ? 'Frozen projection. ' : ''}
          {status ||
            snapshot.status ||
            (displayed
              ? 'Image available.'
              : calibration
                ? 'Calibration available. Select an image topic to open Camera.'
                : 'Waiting for camera data.')}
        </p>
        <dl>
          <dt>Source</dt>
          <dd>
            {calibrationTopic && !topic
              ? 'Calibration only'
              : replay
                ? 'Recording'
                : normalized.imageSource === 'stream'
                  ? 'Camera streamer'
                  : normalized.imageSource === 'webrtc'
                    ? 'WebRTC'
                    : 'ROS images'}
          </dd>
          <dt>Optical frame</dt>
          <dd>{calibration?.frame || normalized.opticalFrame || 'Unavailable'}</dd>
          <dt>Calibration size</dt>
          <dd>{calibration ? `${calibration.width} × ${calibration.height}` : 'Unavailable'}</dd>
          <dt>Distortion model</dt>
          <dd>{calibration ? calibration.distortionModel || 'Pinhole / unspecified' : 'Unavailable'}</dd>
          <dt>Image size</dt>
          <dd>{displayed ? `${displayed.frame.image.width} × ${displayed.frame.image.height}` : 'Unavailable'}</dd>
          <dt>Acquisition stamp</dt>
          <dd>
            {displayed && (rosStamp((displayed.frame.acquisitionHeader ?? displayed.frame.header)?.stamp) ?? 0n) > 0n
              ? `${rosStamp((displayed.frame.acquisitionHeader ?? displayed.frame.header)?.stamp)} ns`
              : 'Unavailable'}
          </dd>
          <dt>Fixed frame</dt>
          <dd>{displayed?.fixedFrame || 'Unavailable'}</dd>
        </dl>
        <div className="camera-inspector-actions">
          <button className="panel-settings-action" disabled={!onOpen || !topic} onClick={() => open('camera')}>
            <FiEye /> Open in Camera
          </button>
          <button className="panel-settings-action" disabled={!displayed || busy} onClick={() => void save(false)}>
            <FiDownload /> Save displayed image
          </button>
          <button
            className="panel-settings-action"
            disabled={!displayed}
            aria-pressed={snapshot.frozen}
            onClick={() => client?.setFrozen(!snapshot.frozen)}
          >
            {snapshot.frozen ? <FiPlay /> : <FiPause />}
            {snapshot.frozen ? 'Resume projection' : 'Freeze projection'}
          </button>
          <button
            className="panel-settings-action"
            disabled={!displayed || !viewer}
            onClick={() => viewer && client && focusCamera(viewer, client, false)}
          >
            <FiMaximize /> Focus camera
          </button>
          <button
            className="panel-settings-action"
            disabled={!displayed || !viewer}
            onClick={() => viewer && client && focusCamera(viewer, client, true)}
          >
            <FiEye /> Look through camera
          </button>
        </div>
        <details>
          <summary>Related panels</summary>
          <div className="camera-inspector-actions">
            <button className="panel-settings-action" disabled={!onOpen || !topic} onClick={() => open('dataExplorer')}>
              Inspect image topic
            </button>
            <button
              className="panel-settings-action"
              disabled={!onOpen || !normalized.cameraInfoTopic}
              onClick={() => open('dataExplorer', normalized.cameraInfoTopic, 'sensor_msgs/CameraInfo')}
            >
              Inspect CameraInfo
            </button>
            <button className="panel-settings-action" disabled={!onOpen} onClick={() => open('tfTree')}>
              Open TF tree
            </button>
            <button
              className="panel-settings-action"
              disabled={!onOpen || replay || !topic}
              onClick={() => open('recordReplay')}
            >
              Record ROS camera topics
            </button>
          </div>
        </details>
        <label className="settings-toggle-row">
          <input type="checkbox" checked={metadata} onChange={event => setMetadata(event.target.checked)} />
          Save metadata JSON alongside PNG
        </label>
        <details>
          <summary>Calibration and pose</summary>
          <pre>
            {calibration
              ? json({ calibration, position: displayed?.position.toArray(), rotation: displayed?.rotation.toArray() })
              : 'Calibration unavailable.'}
          </pre>
        </details>
        <details>
          <summary>On-demand capture</summary>
          <div className="camera-capture-fields">
            <p className="panel-settings-status">
              Runs only when you request capture. Robot gateway permissions apply. Configure the driver's
              response/result; topic output requires a matching acquisition stamp.
            </p>
            <label className="panel-settings-field">
              Command
              <select
                value={capture.kind}
                onChange={e => updateCapture({ kind: e.target.value as 'service' | 'action' })}
              >
                <option value="service">Service</option>
                <option value="action">Action</option>
              </select>
            </label>
            <label className="panel-settings-field">
              Service/action name
              <input
                value={capture.name}
                placeholder="/camera/capture"
                onChange={e => updateCapture({ name: e.target.value })}
              />
            </label>
            <label className="panel-settings-field">
              Interface type
              <input
                value={capture.messageType}
                placeholder="my_camera/srv/Capture"
                onChange={e => updateCapture({ messageType: e.target.value })}
              />
            </label>
            <label className="panel-settings-field">
              Request JSON
              <textarea
                value={capture.request}
                maxLength={16384}
                onChange={e => updateCapture({ request: e.target.value })}
              />
            </label>
            <label className="panel-settings-field">
              Image type
              <select
                value={capture.imageType}
                onChange={e => updateCapture({ imageType: e.target.value as CameraCaptureOptions['imageType'] })}
              >
                <option value="sensor_msgs/Image">Image</option>
                <option value="sensor_msgs/CompressedImage">CompressedImage</option>
              </select>
            </label>
            <label className="panel-settings-field">
              Output topic (optional)
              <input value={capture.outputTopic || ''} onChange={e => updateCapture({ outputTopic: e.target.value })} />
            </label>
            {capture.outputTopic ? (
              <label className="panel-settings-field">
                Result timestamp field
                <input
                  value={capture.resultStampPath || ''}
                  placeholder="header.stamp"
                  onChange={e => updateCapture({ resultStampPath: e.target.value })}
                />
              </label>
            ) : (
              <label className="panel-settings-field">
                Result image field
                <input
                  value={capture.imagePath}
                  placeholder="image (empty = entire result)"
                  onChange={e => updateCapture({ imagePath: e.target.value })}
                />
              </label>
            )}
            <label className="panel-settings-field">
              Timeout (seconds)
              <input
                type="number"
                min={1}
                max={120}
                value={capture.timeoutSec ?? 15}
                onChange={e => updateCapture({ timeoutSec: e.target.valueAsNumber })}
              />
            </label>
            <button
              className="panel-settings-action"
              disabled={!ros || replay || busy || !capture.name || !capture.messageType}
              onClick={() => void save(true)}
            >
              Request capture and save
            </button>
            {replay && <p className="panel-settings-status">Live capture is disabled while inspecting a recording.</p>}
          </div>
        </details>
        {busy && (
          <button
            className="panel-settings-action"
            onClick={() => {
              task.current?.abort();
              setNotice('Capture wait cancelled. An admitted service may still finish on the robot.');
            }}
          >
            Cancel wait
          </button>
        )}
        {notice && (
          <p role="status" className="panel-settings-status">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="camera-inspector-error">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
