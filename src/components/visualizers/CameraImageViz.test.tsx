import { afterEach, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import CameraImageViz from './CameraImageViz';
import { subscribeToProjectionImages } from '../../utils/images/cameraProjectionSource';
const instances = vi.hoisted(() => [] as any[]);
const replay = vi.hoisted(() => ({ active: false }));
vi.mock('../../runtime/runtimeConfig', () => ({ useRuntimeConfig: () => ({ videoStreamBaseUrl: '/video_stream' }) }));
vi.mock('../../features/recordReplay/ReplaySession', () => ({ isReplayRos: () => replay.active }));
vi.mock('../../utils/images/cameraProjectionSource', () => ({ subscribeToProjectionImages: vi.fn() }));
vi.mock('../../utils/ros3d/visualizers/CameraImage', () => ({
  CameraImageClient: class {
    updateOptions = vi.fn();
    dispose = vi.fn();
    object = { uuid: 'camera-owner', visible: true };
    getSnapshot = () => ({ displayed: { frame: { header: { stamp: { sec: 0, nanosec: 0 } } } } });
    constructor(public config: any) {
      instances.push(this);
    }
  },
}));
afterEach(() => {
  instances.length = 0;
  replay.active = false;
  vi.clearAllMocks();
});

it('shares its selected source, combines timing status and cleans up camera ownership', () => {
  const p = props();
  const resetProjection = vi.fn(),
    onClient = vi.fn();
  Object.assign(p.viewer.current, { resetProjection });
  const view = render(
    <CameraImageViz
      {...p}
      onClient={onClient}
      options={{ imageSource: 'webrtc', renderMode: 'plane', whepUrl: 'https://robot.example/whep' }}
    />
  );
  expect(onClient).toHaveBeenCalledWith('camera', instances[0]);
  instances[0].config.onStatus('Waiting for TF');
  expect(p.onStatus).toHaveBeenLastCalledWith('camera', expect.stringMatching(/Latest TF.*Waiting for TF/));
  const stopImages = vi.fn(),
    listener = vi.fn();
  vi.mocked(subscribeToProjectionImages).mockReturnValue(stopImages);
  expect(instances[0].config.subscribeImages(listener)).toBe(stopImages);
  expect(subscribeToProjectionImages).toHaveBeenCalledWith(
    expect.objectContaining({
      source: 'webrtc',
      whepUrl: 'https://robot.example/whep',
      topic: '/image',
      baseUrl: '/video_stream',
      ros: p.ros,
    }),
    listener
  );
  view.rerender(
    <CameraImageViz
      {...p}
      onClient={onClient}
      options={{ imageSource: 'webrtc', renderMode: 'plane', opacity: 0.5, whepUrl: 'https://robot.example/whep' }}
    />
  );
  expect(instances).toHaveLength(1);
  view.unmount();
  expect(resetProjection).toHaveBeenCalledWith('camera-owner');
  expect(onClient).toHaveBeenLastCalledWith('camera', null);
  expect(instances[0].dispose).toHaveBeenCalledOnce();
});

it('waits for both viewer and TF readiness before creating camera resources', () => {
  const p = props();
  const view = render(<CameraImageViz {...p} ready={false} options={{}} />);
  expect(instances).toHaveLength(0);
  view.rerender(<CameraImageViz {...p} ready options={{}} />);
  expect(instances).toHaveLength(1);
  view.unmount();
});
const props = () => ({
  ros: {} as any,
  viewer: { current: { scene: {}, requestRender() {}, renderer: { capabilities: { maxTextureSize: 4096 } } } } as any,
  provider: { current: {} } as any,
  topic: '/image',
  messageType: 'sensor_msgs/Image',
  id: 'camera',
  onStatus: vi.fn(),
});
it('labels latest video timing and changes projection rate without resubscribing for appearance changes', () => {
  const p = props(),
    view = render(<CameraImageViz {...p} options={{ videoTiming: 'latest' }} />);
  instances[0].config.onStatus(null);
  expect(p.onStatus).toHaveBeenCalledWith('camera', 'Latest TF; video is not time-synchronized.');
  view.rerender(<CameraImageViz {...p} options={{ videoTiming: 'latest', opacity: 0.5 }} />);
  expect(instances).toHaveLength(1);
  expect(instances[0].updateOptions).toHaveBeenLastCalledWith({ videoTiming: 'latest', opacity: 0.5 });
  view.rerender(<CameraImageViz {...p} options={{ videoTiming: 'latest', projectionFps: 30 }} />);
  expect(instances).toHaveLength(2);
  expect(instances[0].dispose).toHaveBeenCalledOnce();
  view.unmount();
  expect(instances[1].dispose).toHaveBeenCalledOnce();
});
it('does not label replay or explicit ROS as unsynchronized video', () => {
  const p = props();
  replay.active = true;
  const view = render(<CameraImageViz {...p} options={{ imageSource: 'webrtc' }} />);
  instances[0].config.onStatus('Waiting for TF');
  expect(p.onStatus).toHaveBeenLastCalledWith('camera', 'Waiting for TF');
  view.unmount();
  replay.active = false;
  const other = render(<CameraImageViz {...p} options={{ imageSource: 'ros', videoTiming: 'latest' }} />);
  instances[1].config.onStatus(null);
  expect(p.onStatus).toHaveBeenLastCalledWith('camera', null);
  other.unmount();
});
