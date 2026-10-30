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
  render(
    <CameraImageSettings
      id="c"
      topic="/image"
      options={{ renderMode: 'surfaces' }}
      topics={[]}
      surfaceLayers={[{ id: 'robot', type: 'urdf', topic: '/description' }]}
      onChange={onChange}
    />
  );
  fireEvent.click(screen.getByLabelText('Project onto urdf /description'));
  expect(onChange).toHaveBeenCalledWith('c', { surfaceTargets: ['robot'] });
  fireEvent.change(screen.getByLabelText('Surface geometry timing for Camera image on /image'), {
    target: { value: 'image' },
  });
  expect(onChange).toHaveBeenLastCalledWith('c', { surfaceTiming: 'image' });
});

it('opens the same streamer camera from compressed-topic layers while preserving explicit ROS selections', async () => {
  const { cameraPanelTopic } = await import('../../utils/images/cameraImageOptions');
  expect(cameraPanelTopic('/front/image_raw/compressed', 'stream')).toBe('/front/image_raw');
  expect(cameraPanelTopic('/front/image_raw/compressed', 'ros')).toBe('/front/image_raw/compressed');
  expect(cameraPanelTopic('/front/image_raw/compressed', 'webrtc')).toBe('/front/image_raw/compressed');
});

it('configures and removes explicit surface receivers, including unavailable saved layers', () => {
  const onChange = vi.fn();
  const props = { id: 'c', topic: '/image', topics: [], onChange };
  const view = render(<CameraImageSettings {...props} options={{}} />);
  fireEvent.change(screen.getByLabelText('Projection mode for Camera image on /image'), {
    target: { value: 'surfaces' },
  });
  expect(onChange).toHaveBeenLastCalledWith('c', { renderMode: 'surfaces' });
  view.rerender(
    <CameraImageSettings
      {...props}
      options={{ renderMode: 'surfaces', surfaceTargets: ['robot', 'missing'] }}
      surfaceLayers={[
        { id: 'robot', type: 'urdf', topic: '/description' },
        { id: 'markers', type: 'markerarray', topic: '/markers' },
      ]}
    />
  );
  fireEvent.click(screen.getByLabelText('Project onto urdf /description'));
  expect(onChange).toHaveBeenLastCalledWith('c', { surfaceTargets: ['missing'] });
  fireEvent.click(screen.getByLabelText('Unavailable layer · missing'));
  expect(onChange).toHaveBeenLastCalledWith('c', { surfaceTargets: ['robot'] });
  fireEvent.click(screen.getByLabelText('Project onto markerarray /markers'));
  expect(onChange).toHaveBeenLastCalledWith('c', { surfaceTargets: ['robot', 'missing', 'markers'] });
  const links = screen.getByLabelText('Receiving links/frames (optional)');
  fireEvent.change(links, { target: { value: ' base_link, , arm_link ' } });
  fireEvent.blur(links);
  expect(onChange).toHaveBeenLastCalledWith('c', { surfaceLinks: ['base_link', 'arm_link'] });
  fireEvent.change(screen.getByRole('slider', { name: 'Maximum projection range (m)' }), { target: { value: '0.5' } });
  expect(onChange).toHaveBeenLastCalledWith('c', { surfaceRange: expect.any(Number) });
  view.rerender(<CameraImageSettings {...props} options={{ renderMode: 'surfaces' }} />);
  expect(screen.getByText('Add a URDF or mesh-marker layer to receive the image.')).toBeInTheDocument();
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
