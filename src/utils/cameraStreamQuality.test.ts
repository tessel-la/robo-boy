import { describe, expect, it } from 'vitest';
import { isCameraStreamQuality, resolveCameraStreamParams } from './cameraStreamQuality';
import { buildCameraSnapshotUrl, buildCameraStreamUrl, getSafeCameraStreamUrl } from './cameraStreamUrl';

const hd = { width: 1920, height: 1080 };

describe('camera stream presets', () => {
  it('keeps web_video_server defaults for Original', () => {
    expect(resolveCameraStreamParams({ quality: 'original', source: hd })).toEqual({});
  });

  it('caps fixed presets at their width, in the source aspect ratio', () => {
    expect(resolveCameraStreamParams({ quality: 'low', source: hd })).toEqual({ quality: 40, width: 640, height: 360 });
    expect(resolveCameraStreamParams({ quality: 'medium', source: { width: 1280, height: 1024 } })).toEqual({
      quality: 60,
      width: 960,
      height: 768,
    });
  });

  it('fits Auto to the panel and its pixel density, snapping up to a fixed width', () => {
    expect(
      resolveCameraStreamParams({ quality: 'auto', source: hd, panel: { width: 600, height: 900 } })
    ).toMatchObject({
      width: 640,
      height: 360,
    });
    // A wide, short panel is limited by its height: 300 px tall shows 533 px of a 16:9 frame.
    expect(
      resolveCameraStreamParams({ quality: 'auto', source: hd, panel: { width: 1200, height: 300 } })
    ).toMatchObject({
      width: 640,
    });
    expect(
      resolveCameraStreamParams({
        quality: 'auto',
        source: hd,
        panel: { width: 600, height: 400 },
        devicePixelRatio: 2,
      })
    ).toMatchObject({ width: 1280, height: 720 });
  });

  it('never asks for more pixels than the camera has', () => {
    expect(resolveCameraStreamParams({ quality: 'high', source: { width: 640, height: 480 } })).toEqual({
      quality: 80,
    });
    expect(resolveCameraStreamParams({ quality: 'auto', source: hd, panel: { width: 4000, height: 3000 } })).toEqual({
      quality: 60,
    });
  });

  it('sends only the JPEG quality while the frame size is unknown', () => {
    expect(resolveCameraStreamParams({ quality: 'low', source: null })).toEqual({ quality: 40 });
  });

  it('recognises stored presets only', () => {
    expect(isCameraStreamQuality('auto')).toBe(true);
    expect(isCameraStreamQuality('ultra')).toBe(false);
    expect(isCameraStreamQuality(undefined)).toBe(false);
  });
});

describe('camera stream URLs with a JPEG quality', () => {
  it('adds and clamps the quality', () => {
    expect(buildCameraStreamUrl({ topic: '/cam/image_raw', quality: 55 })).toBe(
      '/video_stream/stream?topic=/cam/image_raw&type=mjpeg&quality=55'
    );
    expect(buildCameraStreamUrl({ topic: '/cam/image_raw', quality: 250 })).toContain('quality=100');
    expect(buildCameraSnapshotUrl({ topic: '/cam/image_raw', quality: 20, baseUrl: 'http://robot:8081' })).toBe(
      'http://robot:8081/snapshot?topic=/cam/image_raw&quality=20'
    );
  });

  it('lets a valid quality through the stream URL check and rejects anything else', () => {
    const allowed = '/video_stream/stream?topic=/cam/image_raw&type=mjpeg&width=640&height=360&quality=60';
    expect(getSafeCameraStreamUrl(allowed, '/video_stream')).toBe(allowed);
    for (const quality of ['0', '101', '5.5', 'high']) {
      expect(
        getSafeCameraStreamUrl(`/video_stream/stream?topic=/cam/image_raw&quality=${quality}`, '/video_stream')
      ).toBeNull();
    }
  });
});
