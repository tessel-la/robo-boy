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
