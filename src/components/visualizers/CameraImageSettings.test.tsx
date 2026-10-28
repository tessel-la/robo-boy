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

it('preserves image-plane defaults and requires explicit mesh target/timing choices', () => {
  expect(normalizeCameraImageOptions({}).renderMode).toBe('plane');
  expect(normalizeCameraImageOptions({ renderMode: 'surfaces' }).surfaceTargets).toEqual([]);
  const onChange = vi.fn();
  render(<CameraImageSettings id="c" topic="/image" options={{ renderMode: 'surfaces' }} topics={[]}
    surfaceLayers={[{ id: 'robot', type: 'urdf', topic: '/description' }]} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText('Project onto urdf /description'));
  expect(onChange).toHaveBeenCalledWith('c', { surfaceTargets: ['robot'] });
  fireEvent.change(screen.getByLabelText('Surface geometry timing for Camera image on /image'), { target: { value: 'image' } });
  expect(onChange).toHaveBeenLastCalledWith('c', { surfaceTiming: 'image' });
});

it('opens the same streamer camera from compressed-topic layers while preserving explicit ROS selections', async () => {
  const { cameraPanelTopic } = await import('../../utils/images/cameraImageOptions');
  expect(cameraPanelTopic('/front/image_raw/compressed', 'stream')).toBe('/front/image_raw');
  expect(cameraPanelTopic('/front/image_raw/compressed', 'ros')).toBe('/front/image_raw/compressed');
  expect(cameraPanelTopic('/front/image_raw/compressed', 'webrtc')).toBe('/front/image_raw/compressed');
});
