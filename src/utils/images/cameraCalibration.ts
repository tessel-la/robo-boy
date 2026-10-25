import { rosStamp } from '../tfHistory';

export const CAMERA_INFO_TYPES = ['sensor_msgs/CameraInfo', 'sensor_msgs/msg/CameraInfo'];
export type ImageGeometry = 'raw' | 'rectified';
export interface CameraCalibration {
  frame: string;
  stamp: bigint;
  width: number;
  height: number;
  k: number[];
  p: number[];
  r: number[];
  d: number[];
  distortionModel: string;
  binningX: number;
  binningY: number;
  roi: { x: number; y: number; width: number; height: number; rectify: boolean };
}
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const frameName = (frame: unknown) => (typeof frame === 'string' ? frame.trim().replace(/^\/+/, '') : '');
const uint = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
function matrix(value: unknown, length: number, fallback?: number[]): number[] {
  if (value === undefined && fallback) return fallback;
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || (value as ArrayLike<number>).length !== length)
    throw new Error('CameraInfo matrix layout is invalid.');
  const result = Array.from(value as ArrayLike<number>);
  if (!result.every(Number.isFinite)) throw new Error('CameraInfo matrix contains invalid values.');
  return result;
}

/** ROS CameraInfo uses full-sensor intrinsics; ROI is applied before binning (image_geometry). */
export function parseCameraInfo(message: any): CameraCalibration {
  const frame = frameName(message?.header?.frame_id),
    stamp = rosStamp(message?.header?.stamp);
  if (!frame || stamp === null) throw new Error('CameraInfo frame or timestamp is invalid.');
  const width = message.width,
    height = message.height;
  if (!uint(width) || !uint(height) || !width || !height || width > 32768 || height > 32768)
    throw new Error('CameraInfo dimensions are invalid.');
  const k = matrix(message.k ?? message.K, 9);
  if (k[0] <= 0 || k[4] <= 0) throw new Error('CameraInfo is uncalibrated (focal lengths must be positive).');
  const r = matrix(message.r ?? message.R, 9, identity);
  const p = matrix(message.p ?? message.P, 12, new Array(12).fill(0));
  const distortion = message.d ?? message.D ?? [];
  if ((!Array.isArray(distortion) && !ArrayBuffer.isView(distortion)) || (distortion as ArrayLike<number>).length > 14)
    throw new Error('CameraInfo distortion layout is invalid.');
  const d = Array.from(distortion as ArrayLike<number>);
  if (!d.every(Number.isFinite)) throw new Error('CameraInfo distortion contains invalid values.');
  const distortionModel = message.distortion_model ?? '';
  if (typeof distortionModel !== 'string' || distortionModel.length > 128)
    throw new Error('CameraInfo distortion model is invalid.');
  const bx = message.binning_x ?? 0,
    by = message.binning_y ?? 0;
  if (!uint(bx) || !uint(by)) throw new Error('CameraInfo binning is invalid.');
  const roi = message.roi ?? {};
  const x = roi.x_offset ?? 0,
    y = roi.y_offset ?? 0,
    w = roi.width ?? 0,
    h = roi.height ?? 0;
  if (![x, y, w, h].every(uint)) throw new Error('CameraInfo ROI is invalid.');
  const full = x === 0 && y === 0 && w === 0 && h === 0;
  if (!full && (!w || !h || x + w > width || y + h > height))
    throw new Error('CameraInfo ROI is outside the calibrated image.');
  return {
    frame,
    stamp,
    width,
    height,
    k,
    r,
    p,
    d,
    distortionModel,
    binningX: bx || 1,
    binningY: by || 1,
    roi: { x, y, width: full ? width : w, height: full ? height : h, rectify: roi.do_rectify === true },
  };
}

/** A pinhole plane uses ROS optical coordinates: +X right, +Y down, +Z forward. */
export function pinholeCorners(
  width: number,
  height: number,
  fx: number,
  fy: number,
  cx: number,
  cy: number,
  distance: number
) {
  if (![width, height, fx, fy, cx, cy, distance].every(Number.isFinite) || fx <= 0 || fy <= 0 || distance <= 0)
    throw new Error('Camera projection is invalid.');
  return [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([u, v]) => [((u - cx) / fx) * distance, ((v - cy) / fy) * distance, distance]);
}

export function cameraPlaneCorners(
  calibration: CameraCalibration,
  width: number,
  height: number,
  mode: ImageGeometry,
  distance: number
) {
  const c = calibration;
  if (width !== Math.floor(c.roi.width / c.binningX) || height !== Math.floor(c.roi.height / c.binningY))
    throw new Error('Image dimensions do not match CameraInfo ROI/binning.');
  const distorted =
    c.d.some(value => value !== 0) || !['', 'plumb_bob', 'rational_polynomial'].includes(c.distortionModel);
  if (mode === 'raw' && distorted)
    throw new Error('Distorted raw images are unsupported. Select an image_rect topic and Rectified geometry.');
  if (mode === 'rectified' && c.roi.rectify && distorted)
    throw new Error('Rectified ROI with do_rectify is unsupported. Use full-frame rectified calibration.');
  const m = mode === 'raw' ? c.k : c.p;
  const stride = mode === 'raw' ? 3 : 4;
  if (
    m[0] <= 0 ||
    m[stride + 1] <= 0 ||
    m[1] !== 0 ||
    m[stride] !== 0 ||
    m[2 * stride] !== 0 ||
    m[2 * stride + 1] !== 0 ||
    m[2 * stride + 2] !== 1 ||
    (stride === 4 && m[11] !== 0)
  )
    throw new Error('CameraInfo pinhole matrix is invalid or unsupported.');
  const corners = pinholeCorners(
    width,
    height,
    m[0] / c.binningX,
    m[stride + 1] / c.binningY,
    (m[2] - c.roi.x) / c.binningX,
    (m[stride + 2] - c.roi.y) / c.binningY,
    distance
  );
  if (mode === 'rectified') {
    // P's Tx/Ty describe stereo baseline. TF already locates this camera's optical center;
    // use P's intrinsics and undo R to express rays in that optical frame, without a second baseline.
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let dot = 0;
        for (let k = 0; k < 3; k++) dot += c.r[i * 3 + k] * c.r[j * 3 + k];
        if (Math.abs(dot - (i === j ? 1 : 0)) > 1e-5) throw new Error('CameraInfo rectification rotation is invalid.');
      }
    const r = c.r;
    const determinant =
      r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6]);
    if (Math.abs(determinant - 1) > 1e-5) throw new Error('CameraInfo rectification rotation is invalid.');
    return corners.map(v => [0, 1, 2].map(i => c.r[i] * v[0] + c.r[3 + i] * v[1] + c.r[6 + i] * v[2]));
  }
  return corners;
}

export function matchCameraInfo(
  samples: readonly CameraCalibration[],
  header: DecodedHeader | undefined,
  sync: 'exact' | 'latest',
  toleranceMs: number
) {
  const frame = frameName(header?.frame_id),
    stamp = rosStamp(header?.stamp);
  if (!frame || stamp === null) throw new Error('Image frame or timestamp is invalid.');
  const matching = samples.filter(sample => sample.frame === frame);
  if (!matching.length)
    throw new Error(
      samples.length ? 'CameraInfo optical frame does not match the image frame.' : 'Waiting for CameraInfo.'
    );
  if (sync === 'latest' || stamp === 0n) return matching[matching.length - 1];
  const tolerance = BigInt(Math.round(toleranceMs * 1e6));
  let best: CameraCalibration | undefined,
    delta = tolerance + 1n;
  for (const sample of matching) {
    if (sample.stamp === 0n) continue;
    const d = sample.stamp > stamp ? sample.stamp - stamp : stamp - sample.stamp;
    if (d <= tolerance && d < delta) {
      best = sample;
      delta = d;
    }
  }
  const timeless = [...matching].reverse().find(sample => sample.stamp === 0n);
  if (!best && !timeless)
    throw new Error(
      'Waiting for CameraInfo at the image timestamp. Adjust tolerance or select Latest for static calibration.'
    );
  return (best ?? timeless)!;
}
type DecodedHeader = { frame_id?: string; stamp?: unknown };
