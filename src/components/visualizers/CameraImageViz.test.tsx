import { afterEach, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import CameraImageViz from './CameraImageViz';
const instances = vi.hoisted(() => [] as any[]);
const replay = vi.hoisted(() => ({ active: false }));
vi.mock('../../runtime/runtimeConfig', () => ({ useRuntimeConfig: () => ({ videoStreamBaseUrl: '/video_stream' }) }));
vi.mock('../../features/recordReplay/ReplaySession', () => ({ isReplayRos: () => replay.active }));
vi.mock('../../utils/ros3d/visualizers/CameraImage', () => ({
  CameraImageClient: class {
    updateOptions = vi.fn();
    dispose = vi.fn();
    constructor(public config: any) {
      instances.push(this);
    }
  },
}));
afterEach(() => {
  instances.length = 0;
  replay.active = false;
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
