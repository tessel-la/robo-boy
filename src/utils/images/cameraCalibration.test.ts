import { expect, it } from 'vitest';
import { cameraPlaneCorners, matchCameraInfo, parseCameraInfo } from './cameraCalibration';
import { cameraInfoTopicFor, normalizeCameraImageOptions } from './cameraImageOptions';

const header = (sec = 2, frame_id = 'optical') => ({ frame_id, stamp: { sec, nanosec: 0 } });
const info = () => ({
  header: header(),
  width: 640,
  height: 480,
  k: [400, 0, 300, 0, 400, 200, 0, 0, 1],
  p: [500, 0, 320, -50, 0, 500, 240, 0, 0, 0, 1, 0],
  r: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  d: [0, 0, 0, 0, 0],
});

it('projects ROS optical rays, adjusting full-sensor calibration for ROI and binning', () => {
  const c = parseCameraInfo({
    ...info(),
    binning_x: 2,
    binning_y: 2,
    roi: { x_offset: 100, y_offset: 40, width: 400, height: 240 },
  });
  const corners = cameraPlaneCorners(c, 200, 120, 'raw', 2);
  expect(corners).toEqual([
    [-1, -0.8, 2],
    [1, -0.8, 2],
    [1, 0.4, 2],
    [-1, 0.4, 2],
  ]);
  expect(() => cameraPlaneCorners(c, 640, 480, 'raw', 1)).toThrow('dimensions');
});

it('uses rectified intrinsics and inverse R without applying stereo baseline twice', () => {
  const c = parseCameraInfo(info());
  expect(cameraPlaneCorners(c, 640, 480, 'rectified', 1)[0]).toEqual([-0.64, -0.48, 1]);
  c.r = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  expect(cameraPlaneCorners(c, 640, 480, 'rectified', 1)[0]).toEqual([-0.48, 0.64, 1]);
  expect(cameraPlaneCorners(c, 640, 480, 'raw', 1)[0]).toEqual([-0.75, -0.5, 1]);
});

it('rejects uncalibrated/malformed intrinsics and unsupported raw distortion instead of guessing', () => {
  expect(() => parseCameraInfo({ ...info(), k: new Array(9).fill(0) })).toThrow('uncalibrated');
  expect(() => parseCameraInfo({ ...info(), header: header(2, '') })).toThrow('frame');
  expect(() => parseCameraInfo({ ...info(), binning_x: -1 })).toThrow('binning');
  expect(() => parseCameraInfo({ ...info(), roi: { x_offset: 600, width: 100, height: 480 } })).toThrow('ROI');
  const distorted = parseCameraInfo({ ...info(), d: [0.1, 0, 0, 0, 0] });
  expect(() => cameraPlaneCorners(distorted, 640, 480, 'raw', 1)).toThrow('image_rect');
  expect(cameraPlaneCorners(distorted, 640, 480, 'rectified', 1)).toHaveLength(4);
  expect(() => cameraPlaneCorners({ ...distorted, r: new Array(9).fill(0) }, 640, 480, 'rectified', 1)).toThrow(
    'rotation'
  );
  expect(() =>
    cameraPlaneCorners(parseCameraInfo({ ...info(), distortion_model: 'equidistant' }), 640, 480, 'raw', 1)
  ).toThrow('Distorted');
});

it('matches timestamps explicitly, permits timeless calibration and requires the same optical frame', () => {
  const samples = [parseCameraInfo(info()), parseCameraInfo({ ...info(), header: header(3) })];
  expect(matchCameraInfo(samples, header(), 'exact', 0)).toBe(samples[0]);
  expect(() => matchCameraInfo(samples, header(4), 'exact', 0)).toThrow('timestamp');
  expect(matchCameraInfo(samples, { ...header(), stamp: { sec: 2, nanosec: 20_000_000 } }, 'exact', 25)).toBe(
    samples[0]
  );
  expect(matchCameraInfo(samples, header(4), 'latest', 0)).toBe(samples[1]);
  expect(matchCameraInfo(samples, header(0), 'exact', 0)).toBe(samples[1]);
  expect(() => matchCameraInfo(samples, header(2, 'different'), 'latest', 0)).toThrow('optical frame');
  const timeless = parseCameraInfo({ ...info(), header: header(0) });
  expect(matchCameraInfo([timeless], header(99), 'exact', 0)).toBe(timeless);
});

it('supports ROS 1 matrix names and selects calibration only in the image namespace', () => {
  const { k, p, r, d, ...rest } = info();
  expect(parseCameraInfo({ ...rest, K: k, P: p, R: r, D: d }).k).toEqual(k);
  const topics = [{ name: '/front/camera_info', type: 'sensor_msgs/msg/CameraInfo' }];
  expect(cameraInfoTopicFor('/front/image_rect/compressed', topics)).toBe('/front/camera_info');
  expect(cameraInfoTopicFor('/rear/image_raw', topics)).toBe('');
  expect(normalizeCameraImageOptions({}, '/front/image_rect/compressed').imageGeometry).toBe('rectified');
  expect(normalizeCameraImageOptions({ opacity: 0, distance: NaN, visible: false })).toMatchObject({
    opacity: 0,
    distance: 1,
    visible: false,
  });
});
