import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { ComponentProps } from 'react';
import CameraInspector from './CameraInspector';
import type { CameraImageClient, CameraInspection } from '../../utils/ros3d/visualizers/CameraImage';
import { parseCameraInfo } from '../../utils/images/cameraCalibration';
import { shareImageFrame } from '../../utils/images/sharedImageFrame';
import { cameraFramePng, downloadCameraBlob } from '../../utils/images/cameraSnapshot';
import { requestCameraCapture } from '../../utils/images/cameraCapture';
import { subscribeToCameraInfo } from '../../utils/images/cameraStreams';
import { focusCamera } from '../../utils/images/cameraInteraction';

const replay = vi.hoisted(() => ({ active: false }));
vi.mock('../../features/recordReplay/ReplaySession', () => ({ isReplayRos: () => replay.active }));
vi.mock('../../utils/images/cameraSnapshot', () => ({ cameraFramePng: vi.fn(), downloadCameraBlob: vi.fn() }));
vi.mock('../../utils/images/cameraCapture', () => ({ requestCameraCapture: vi.fn() }));
vi.mock('../../utils/images/cameraStreams', () => ({ subscribeToCameraInfo: vi.fn() }));
vi.mock('../../utils/images/cameraInteraction', () => ({ focusCamera: vi.fn() }));

const header = { frame_id: 'optical', stamp: { sec: 12, nanosec: 5 } };
const calibration = parseCameraInfo({ header, width: 4, height: 2, k: [2, 0, 2, 0, 2, 1, 0, 0, 1], d: [] });
type Props = ComponentProps<typeof CameraInspector>;
function fixture(overrides: Partial<Props> = {}) {
  const frame = shareImageFrame({
    image: { width: 2, height: 1, data: new Uint8ClampedArray(8) },
    encoding: 'rgb8',
    header,
    sourceSize: { width: 4, height: 2 },
  }).frame;
  let snapshot: CameraInspection = {
    frozen: false,
    status: null,
    displayed: {
      frame,
      calibration,
      corners: [],
      position: new THREE.Vector3(1, 2, 3),
      rotation: new THREE.Quaternion(),
      fixedFrame: 'map',
    },
  };
  const listeners = new Set<() => void>();
  const unsubscribe = vi.fn();
  const publish = (patch: Partial<CameraInspection>) => {
    snapshot = { ...snapshot, ...patch };
    act(() => {
      for (const listener of listeners) listener();
    });
  };
  const client = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
    setFrozen: vi.fn((frozen: boolean) => publish({ frozen })),
  } as unknown as CameraImageClient;
  const props: Props = {
    client,
    viewer: {} as Props['viewer'],
    ros: {} as Props['ros'],
    topic: '/front/image/compressed',
    options: { imageSource: 'stream', streamQuality: 'high', cameraInfoTopic: '/front/camera_info' },
    onChange: vi.fn(),
    onClose: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
  return { props, frame, client, publish, unsubscribe };
}
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
beforeEach(() => {
  vi.mocked(cameraFramePng).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  replay.active = false;
});

describe('camera inspection and navigation', () => {
  it('subscribes to displayed state, freezes independently, focuses the calibrated view and restores close focus', () => {
    const f = fixture();
    const view = render(<CameraInspector {...f.props} />);
    expect(screen.getByRole('button', { name: 'Close camera inspector' })).toHaveFocus();
    expect(screen.getByText('12000000005 ns')).toBeVisible();
    expect(screen.getByText('4 × 2')).toBeVisible();
    click('Freeze projection');
    expect(f.client.setFrozen).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: 'Resume projection' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Frozen projection/)).toBeVisible();
    click('Resume projection');
    expect(f.client.setFrozen).toHaveBeenLastCalledWith(false);
    click('Focus camera');
    expect(focusCamera).toHaveBeenLastCalledWith(f.props.viewer, f.client, false);
    click('Look through camera');
    expect(focusCamera).toHaveBeenLastCalledWith(f.props.viewer, f.client, true);
    fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' });
    expect(f.props.onClose).toHaveBeenCalledOnce();
    click('Close camera inspector');
    expect(f.props.onClose).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
  });

  it('routes to related panels with an explicit source/profile and deduplicated recording topics', () => {
    const { props } = fixture();
    render(<CameraInspector {...props} />);
    click('Open in Camera');
    expect(props.onOpen).toHaveBeenLastCalledWith({
      panel: 'camera',
      topic: '/front/image',
      messageType: 'sensor_msgs/Image',
      cameraOptions: props.options,
    });
    click('Inspect image topic');
    expect(props.onOpen).toHaveBeenLastCalledWith({
      panel: 'dataExplorer',
      topic: props.topic,
      messageType: 'sensor_msgs/Image',
    });
    click('Inspect CameraInfo');
    expect(props.onOpen).toHaveBeenLastCalledWith({
      panel: 'dataExplorer',
      topic: '/front/camera_info',
      messageType: 'sensor_msgs/CameraInfo',
    });
    click('Open TF tree');
    expect(props.onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ panel: 'tfTree' }));
    click('Record ROS camera topics');
    expect(props.onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        panel: 'recordReplay',
        topics: [props.topic, '/front/camera_info', '/tf', '/tf_static'],
      })
    );
  });

  it('inspects calibration without video and requires explicit image selection before opening Camera', () => {
    const stop = vi.fn();
    let receive: Parameters<typeof subscribeToCameraInfo>[2];
    vi.mocked(subscribeToCameraInfo).mockImplementation((_ros, _topic, listener) => {
      receive = listener;
      return stop;
    });
    const { props } = fixture({
      client: undefined,
      viewer: null,
      topic: '',
      calibrationTopic: '/front/camera_info',
      imageTopics: [{ name: '/front/image', type: 'sensor_msgs/msg/Image' }],
    });
    const view = render(<CameraInspector {...props} />);
    expect(screen.getByText('Waiting for camera data.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open in Camera' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save displayed image' })).toBeDisabled();
    act(() => receive!({ samples: [calibration], error: null }));
    expect(screen.getByText('Calibration only')).toBeVisible();
    expect(screen.getByText('optical')).toBeVisible();
    expect(screen.getByText(/Calibration available/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Image topic'), { target: { value: '/front/image' } });
    click('Open in Camera');
    expect(props.onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        topic: '/front/image',
        cameraOptions: expect.objectContaining({ cameraInfoTopic: '/front/camera_info' }),
      })
    );
    view.unmount();
    expect(stop).toHaveBeenCalledOnce();
  });
});

describe('snapshot export and capture', () => {
  it('exports the displayed pixels and original acquisition metadata without URLs or capture payloads', async () => {
    const f = fixture();
    f.frame.acquisitionHeader = header;
    f.frame.header = { frame_id: 'optical', stamp: { sec: 0, nanosec: 0 } };
    f.props.options = {
      ...f.props.options,
      videoTiming: 'latest',
      whepUrl: 'https://private.example/camera',
      capture: {
        kind: 'service',
        name: '/capture',
        messageType: 'camera/srv/Capture',
        imageType: 'sensor_msgs/Image',
        imagePath: 'image',
        request: '{"private":"payload"}',
      },
    };
    render(<CameraInspector {...f.props} />);
    fireEvent.click(screen.getByLabelText('Save metadata JSON alongside PNG'));
    click('Save displayed image');
    await screen.findByText('Displayed camera image saved.');
    expect(cameraFramePng).toHaveBeenCalledWith(f.frame);
    expect(downloadCameraBlob).toHaveBeenCalledTimes(2);
    const [metadataBlob, name] = vi.mocked(downloadCameraBlob).mock.calls[1];
    expect(name).toMatch(/\.json$/);
    const json = await readBlob(metadataBlob);
    const details = JSON.parse(json);
    expect(details).toMatchObject({
      width: 2,
      height: 1,
      sourceSize: { width: 4, height: 2 },
      header,
      acquisitionStamp: '12000000005',
      fixedFrame: 'map',
      pose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
      timing: 'Latest TF; not time-synchronized',
    });
    expect(details.calibration.stamp).toBe('12000000005');
    expect(json).not.toMatch(/private|payload|whepUrl/);
  });

  it('allows recorded-frame export while disabling live capture and new live recording', async () => {
    replay.active = true;
    const f = fixture({
      options: {
        imageSource: 'webrtc',
        capture: {
          kind: 'action',
          name: '/capture',
          messageType: 'camera/action/Capture',
          request: '{}',
          imagePath: 'image',
          imageType: 'sensor_msgs/Image',
        },
      },
    });
    render(<CameraInspector {...f.props} />);
    expect(screen.getByText('Recording', { exact: true })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Request capture and save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record ROS camera topics' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Save metadata JSON alongside PNG'));
    click('Save displayed image');
    await screen.findByText('Displayed camera image saved.');
    const details = JSON.parse(await readBlob(vi.mocked(downloadCameraBlob).mock.calls[1][0]));
    expect(details).toMatchObject({ source: 'recording', timing: 'Image acquisition timestamp' });
    expect(requestCameraCapture).not.toHaveBeenCalled();
  });

  it('persists explicit capture bindings, saves a captured frame and releases its lease', async () => {
    const f = fixture();
    const release = vi.fn();
    vi.mocked(requestCameraCapture).mockResolvedValue({ frame: f.frame, release });
    const view = render(<CameraInspector {...f.props} />);
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'action' } });
    expect(f.props.onChange).toHaveBeenLastCalledWith({ capture: expect.objectContaining({ kind: 'action' }) });
    const capture = {
      kind: 'action' as const,
      name: '/capture',
      messageType: 'camera/action/Capture',
      request: '{}',
      imagePath: 'image',
      imageType: 'sensor_msgs/Image' as const,
    };
    view.rerender(<CameraInspector {...f.props} options={{ ...f.props.options, capture }} />);
    for (const [label, value, key] of [
      ['Service/action name', '/snap', 'name'],
      ['Interface type', 'camera/action/Snap', 'messageType'],
      ['Request JSON', '{"exposure":5}', 'request'],
      ['Result image field', 'result.image', 'imagePath'],
      ['Output topic (optional)', '/captured', 'outputTopic'],
      ['Timeout (seconds)', '25', 'timeoutSec'],
      ['Image type', 'sensor_msgs/CompressedImage', 'imageType'],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      expect(f.props.onChange).toHaveBeenLastCalledWith({
        capture: expect.objectContaining({ [key]: key === 'timeoutSec' ? 25 : value }),
      });
    }
    view.rerender(
      <CameraInspector
        {...f.props}
        options={{ ...f.props.options, capture: { ...capture, outputTopic: '/captured' } }}
      />
    );
    fireEvent.change(screen.getByLabelText('Result timestamp field'), { target: { value: 'result.stamp' } });
    expect(f.props.onChange).toHaveBeenLastCalledWith({
      capture: expect.objectContaining({ resultStampPath: 'result.stamp' }),
    });
    fireEvent.click(screen.getByLabelText('Save metadata JSON alongside PNG'));
    click('Request capture and save');
    await screen.findByText('Captured image saved.');
    expect(requestCameraCapture).toHaveBeenCalledWith(
      f.props.ros,
      expect.objectContaining({ kind: 'action', name: '/capture', outputTopic: '/captured' }),
      expect.any(AbortSignal)
    );
    expect(release).toHaveBeenCalledOnce();
    const details = JSON.parse(await readBlob(vi.mocked(downloadCameraBlob).mock.calls[1][0]));
    expect(details).toMatchObject({ source: 'action', timing: 'Camera acquisition' });
    expect(details).not.toHaveProperty('pose');
    expect(details).not.toHaveProperty('calibration');
  });

  it('reports failed encoding and releases capture frames without downloading a broken image', async () => {
    const capture = {
      kind: 'service' as const,
      name: '/capture',
      messageType: 'camera/srv/Capture',
      request: '{}',
      imagePath: 'image',
      imageType: 'sensor_msgs/Image' as const,
    };
    const f = fixture({ options: { capture } });
    const release = vi.fn();
    vi.mocked(requestCameraCapture).mockResolvedValue({ frame: f.frame, release });
    vi.mocked(cameraFramePng).mockRejectedValue(new Error('Encoder unavailable'));
    render(<CameraInspector {...f.props} />);
    click('Request capture and save');
    expect(await screen.findByRole('alert')).toHaveTextContent('Encoder unavailable');
    expect(release).toHaveBeenCalledOnce();
    expect(downloadCameraBlob).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Request capture and save' })).toBeEnabled();
  });

  it('cancels an outstanding capture and prevents late results from downloading after cancellation or unmount', async () => {
    const capture = {
      kind: 'service' as const,
      name: '/capture',
      messageType: 'camera/srv/Capture',
      request: '{}',
      imagePath: 'image',
      imageType: 'sensor_msgs/Image' as const,
    };
    const f = fixture({ options: { capture } });
    const release = vi.fn();
    let finish!: (value: { frame: typeof f.frame; release: () => void }) => void;
    vi.mocked(requestCameraCapture).mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const view = render(<CameraInspector {...f.props} />);
    click('Request capture and save');
    const signal = vi.mocked(requestCameraCapture).mock.calls[0][2];
    expect(screen.getByRole('button', { name: 'Request capture and save' })).toBeDisabled();
    click('Cancel wait');
    expect(signal.aborted).toBe(true);
    expect(screen.getByText(/admitted service may still finish/)).toBeVisible();
    await act(async () => {
      finish({ frame: f.frame, release });
    });
    expect(downloadCameraBlob).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    click('Request capture and save');
    const nextSignal = vi.mocked(requestCameraCapture).mock.calls[1][2];
    view.unmount();
    expect(nextSignal.aborted).toBe(true);
    await act(async () => {
      finish({ frame: f.frame, release });
    });
    expect(downloadCameraBlob).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('reports a frame disappearing before save and disables controls without a connected source', async () => {
    const f = fixture();
    const view = render(<CameraInspector {...f.props} />);
    // The external store can change between the rendered button state and its click handler.
    vi.spyOn(f.client, 'getSnapshot').mockReturnValue({ frozen: false, status: 'Waiting' });
    click('Save displayed image');
    expect(await screen.findByRole('alert')).toHaveTextContent('No camera frame is available');
    expect(downloadCameraBlob).not.toHaveBeenCalled();
    view.rerender(<CameraInspector {...f.props} client={undefined} ros={null} viewer={null} onOpen={undefined} />);
    expect(screen.getByRole('button', { name: 'Request capture and save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open TF tree' })).toBeDisabled();
    await waitFor(() => expect(f.unsubscribe).toHaveBeenCalledOnce());
  });
});
