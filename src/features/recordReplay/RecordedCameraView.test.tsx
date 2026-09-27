import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecordedCameraView, { pickRecordedCameraTopic } from './RecordedCameraView';
import { ReplaySession } from './ReplaySession';
import type { BagInfo, ReaderRequest, ReaderResponse, ReplayMessage } from './types';

const START = 1_000n * 1_000_000_000n;
const info = (topics: BagInfo['topics']): BagInfo => ({ name: 'walk.mcap', size: 1024, start: START, end: START + 10n * 1_000_000_000n, topics });
const CAMERA_TOPICS = [
  { name: '/cam/image_raw', type: 'sensor_msgs/msg/Image', count: 10 },
  { name: '/cam/image_raw/compressed', type: 'sensor_msgs/msg/CompressedImage', count: 10 },
  { name: '/odom', type: 'nav_msgs/msg/Odometry', count: 10 },
];

class FakeWorker {
  requests: ReaderRequest[] = [];
  onmessage: ((event: MessageEvent<ReaderResponse>) => void) | null = null;
  onerror = null;
  postMessage(request: ReaderRequest) { this.requests.push(request); }
  terminate() {}
  last<T extends ReaderRequest['op']>(op: T) { return [...this.requests].reverse().find(request => request.op === op) as Extract<ReaderRequest, { op: T }>; }
  reply(response: ReaderResponse) { act(() => this.onmessage?.({ data: response } as MessageEvent<ReaderResponse>)); }
}

let worker: FakeWorker;
let session: ReplaySession;
const context = { drawImage: vi.fn(), putImageData: vi.fn() };
const bitmap = { width: 64, height: 48, close: vi.fn() };

const openRecording = (topics: BagInfo['topics']) => {
  session.open(new File(['x'], 'walk.mcap'));
  worker.reply({ id: worker.last('open').id, op: 'opened', info: info(topics) });
  worker.reply({ id: worker.last('seek').id, op: 'messages', messages: [], done: true });
  return session.getSource().ros!;
};
/** Let the session ask for the newly subscribed topic, answer with `messages`, and draw the next frame. */
const deliver = async (messages: ReplayMessage[]) => {
  act(() => { vi.advanceTimersByTime(60); });
  worker.reply({ id: worker.last('seek').id, op: 'messages', messages, done: true });
  await act(async () => { vi.advanceTimersByTime(20); await Promise.resolve(); await Promise.resolve(); });
};

beforeEach(() => {
  vi.useFakeTimers();
  worker = new FakeWorker();
  session = new ReplaySession(() => worker as unknown as Worker);
  context.drawImage.mockClear(); context.putImageData.mockClear(); bitmap.close.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
  vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
});
afterEach(() => {
  session.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pickRecordedCameraTopic', () => {
  it('prefers the compressed twin of the panel topic, then the topic, then any camera', () => {
    expect(pickRecordedCameraTopic(CAMERA_TOPICS, '/cam/image_raw')).toBe('/cam/image_raw/compressed');
    expect(pickRecordedCameraTopic(CAMERA_TOPICS.slice(0, 1), '/cam/image_raw')).toBe('/cam/image_raw');
    expect(pickRecordedCameraTopic(CAMERA_TOPICS, '/other/image_raw')).toBe('/cam/image_raw/compressed');
    expect(pickRecordedCameraTopic(CAMERA_TOPICS.slice(2), '/cam/image_raw')).toBe('');
  });
});

describe('RecordedCameraView', () => {
  it('draws the recorded frame at the playback position instead of the live stream', async () => {
    const ros = openRecording(CAMERA_TOPICS);
    render(<RecordedCameraView ros={ros} preferredTopic="/cam/image_raw" />);
    expect(screen.getByLabelText('Recorded camera topic')).toHaveValue('/cam/image_raw/compressed');
    expect(screen.getByText('Waiting for a frame at the playback position…')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '/odom' })).not.toBeInTheDocument();

    await deliver([{ topic: '/cam/image_raw/compressed', time: START, message: { format: 'jpeg', data: Uint8Array.from([0xff, 0xd8]) } }]);
    expect(worker.last('seek').topics).toEqual(['/cam/image_raw/compressed']);
    expect(createImageBitmap).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/jpeg' }));
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(bitmap.close).toHaveBeenCalled();
    const canvas = screen.getByRole('img', { name: 'Recorded frame from /cam/image_raw/compressed' }) as HTMLCanvasElement;
    expect(canvas).toBeVisible();
    expect([canvas.width, canvas.height]).toEqual([64, 48]);
    expect(screen.getByText('Recording')).toBeInTheDocument();
  });

  it('draws raw images and switches topics from the selector', async () => {
    const ros = openRecording(CAMERA_TOPICS);
    render(<RecordedCameraView ros={ros} preferredTopic="/cam/image_raw" />);
    fireEvent.change(screen.getByLabelText('Recorded camera topic'), { target: { value: '/cam/image_raw' } });
    await deliver([{ topic: '/cam/image_raw', time: START, message: { width: 2, height: 1, encoding: 'rgb8', step: 6, data: Uint8Array.from([1, 2, 3, 4, 5, 6]) } }]);
    const [image] = context.putImageData.mock.calls[0];
    expect(Array.from((image as { data: Uint8ClampedArray }).data)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    expect(screen.getByRole('img', { name: 'Recorded frame from /cam/image_raw' })).toBeVisible();
  });

  it('explains frames it cannot show and recordings without a camera', async () => {
    const ros = openRecording(CAMERA_TOPICS.slice(0, 1));
    const { unmount } = render(<RecordedCameraView ros={ros} preferredTopic="/cam/image_raw" />);
    await deliver([{ topic: '/cam/image_raw', time: START, message: { width: 1, height: 1, encoding: 'bayer_rggb8', step: 1, data: new Uint8Array(1) } }]);
    expect(screen.getByText('Replay cannot show bayer_rggb8 images yet.')).toBeInTheDocument();
    unmount();

    render(<RecordedCameraView ros={openRecording(CAMERA_TOPICS.slice(2))} preferredTopic="/cam/image_raw" />);
    expect(screen.getByText('This recording has no camera topics.')).toBeInTheDocument();
  });
});
