import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CameraImageSettings from './CameraImageSettings';
import { DEFAULT_NEW_CAMERA_IMAGE_OPTIONS, normalizeCameraImageOptions } from '../../utils/images/cameraImageOptions';
vi.mock('../WebRtcSourceSettings', () => ({ default: () => <div>Standard WHEP connection</div> }));
it('uses metadata-free timing for new layers while preserving saved legacy behavior', () => {
  expect(normalizeCameraImageOptions(DEFAULT_NEW_CAMERA_IMAGE_OPTIONS).videoTiming).toBe('latest');
  expect(normalizeCameraImageOptions({ imageSource: 'stream' }).videoTiming).toBe('capture');
});
it('offers an independent projection rate including uncapped source rate', () => {
  const onChange = vi.fn();
  render(
    <CameraImageSettings
      id="camera"
      topic="/image"
      options={DEFAULT_NEW_CAMERA_IMAGE_OPTIONS}
      topics={[]}
      onChange={onChange}
    />
  );
  fireEvent.change(screen.getByLabelText('Projection update rate for Camera image on /image'), {
    target: { value: '0' },
  });
  expect(onChange).toHaveBeenCalledWith('camera', { projectionFps: 0 });
});
it('offers plain WebRTC with explicit calibration and no metadata settings', () => {
  render(
    <CameraImageSettings
      id="camera"
      topic="/image"
      options={{ imageSource: 'webrtc' }}
      topics={[]}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByText('Standard WHEP connection')).toBeInTheDocument();
  expect(screen.queryByLabelText('WebRTC metadata topic')).not.toBeInTheDocument();
  expect(screen.getByLabelText('CameraInfo topic for Camera image on /image')).toBeInTheDocument();
  expect(screen.queryByLabelText('TF timing for Camera image on /image')).not.toBeInTheDocument();
});

it('switches to plain WebRTC with explicit latest TF timing', () => {
  const onChange = vi.fn();
  render(
    <CameraImageSettings
      id="camera"
      topic="/image"
      options={{ imageSource: 'stream', videoTiming: 'capture' }}
      topics={[]}
      onChange={onChange}
    />
  );
  fireEvent.change(screen.getByLabelText('Image source for Camera image on /image'), { target: { value: 'webrtc' } });
  expect(onChange).toHaveBeenCalledWith('camera', { imageSource: 'webrtc', videoTiming: 'latest' });
});

it('offers image planes and depth points, migrating saved mesh projection to the image plane', () => {
  const legacy = JSON.parse('{"renderMode":"surfaces","surfaceTargets":["robot"],"imageSource":"ros"}');
  expect(normalizeCameraImageOptions(legacy)).toMatchObject({ renderMode: 'plane', imageSource: 'ros' });
  expect(normalizeCameraImageOptions({}).renderMode).toBe('plane');
  const onChange = vi.fn();
  render(<CameraImageSettings id="c" topic="/depth/image_raw" options={legacy} topics={[]} onChange={onChange} />);
  const mode = screen.getByLabelText('Projection mode for Camera image on /depth/image_raw');
  expect(mode).toHaveValue('plane');
  expect([...mode.querySelectorAll('option')].map(option => option.value)).toEqual(['plane', 'depth']);
  expect(screen.queryByText('Receiving layers')).not.toBeInTheDocument();
  fireEvent.change(mode, { target: { value: 'depth' } });
  expect(onChange).toHaveBeenCalledWith('c', { renderMode: 'depth', imageSource: 'ros' });
});

it('opens the same streamer camera from compressed-topic layers while preserving explicit ROS selections', async () => {
  const { cameraPanelTopic } = await import('../../utils/images/cameraImageOptions');
  expect(cameraPanelTopic('/front/image_raw/compressed', 'stream')).toBe('/front/image_raw');
  expect(cameraPanelTopic('/front/image_raw/compressed', 'ros')).toBe('/front/image_raw/compressed');
  expect(cameraPanelTopic('/front/image_raw/compressed', 'webrtc')).toBe('/front/image_raw/compressed');
});

it('persists depth mode with metric controls and enforces ROS even for saved video settings', () => {
  expect(normalizeCameraImageOptions({ renderMode: 'depth', imageSource: 'webrtc' }).imageSource).toBe('ros');
  expect(normalizeCameraImageOptions({ depthMaxRange: NaN, depthPointSize: Infinity })).toMatchObject({
    depthMaxRange: 10,
    depthPointSize: 2,
  });
  const onChange = vi.fn();
  const props = { id: 'c', topic: '/depth/image_rect', topics: [], onChange };
  const view = render(<CameraImageSettings {...props} />);
  fireEvent.change(screen.getByLabelText('Projection mode for Camera image on /depth/image_rect'), {
    target: { value: 'depth' },
  });
  expect(onChange).toHaveBeenLastCalledWith('c', { renderMode: 'depth', imageSource: 'ros' });
  view.rerender(<CameraImageSettings {...props} options={{ renderMode: 'depth' }} />);
  expect(screen.getByRole('slider', { name: 'Maximum depth (m)' })).toBeVisible();
  expect(screen.getByLabelText('Point size')).toBeVisible();
  expect(screen.queryByLabelText('Image source for Camera image on /depth/image_rect')).not.toBeInTheDocument();
});

it('matches compressedDepth calibration without changing the exact ROS topic', async () => {
  const { cameraInfoTopicFor, cameraPanelTopic } = await import('../../utils/images/cameraImageOptions');
  expect(
    cameraInfoTopicFor('/depth/image_rect/compressedDepth', [
      { name: '/depth/camera_info', type: 'sensor_msgs/msg/CameraInfo' },
    ])
  ).toBe('/depth/camera_info');
  expect(cameraPanelTopic('/depth/image_rect/compressedDepth', 'ros')).toBe('/depth/image_rect/compressedDepth');
});
