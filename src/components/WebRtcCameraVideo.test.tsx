import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { Ros } from 'roslib';
import WebRtcCameraVideo from './WebRtcCameraVideo';
import { subscribeToWebRtcVideo } from '../utils/images/webrtcStreams';
vi.mock('../utils/images/webrtcStreams', () => ({ subscribeToWebRtcVideo: vi.fn(() => vi.fn()) }));
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
it('needs only a WHEP URL and cleans up its native stream subscription', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const stop = vi.fn(),
    stream = {} as MediaStream;
  vi.mocked(subscribeToWebRtcVideo).mockImplementationOnce((_ros, _url, receive) => {
    receive({ stream, error: null });
    return stop;
  });
  const view = render(<WebRtcCameraVideo ros={{} as Ros} url="https://camera.example/whep" />);
  const video = screen.getByLabelText('WebRTC camera video') as HTMLVideoElement;
  expect(video.srcObject).toBe(stream);
  view.unmount();
  expect(stop).toHaveBeenCalledOnce();
  expect(video.srcObject).toBeNull();
});
it('shows missing endpoint and signaling errors without switching transports', () => {
  const view = render(<WebRtcCameraVideo ros={{} as Ros} url="" />);
  expect(screen.getByRole('status')).toHaveTextContent('Choose a WebRTC stream');
  expect(subscribeToWebRtcVideo).not.toHaveBeenCalled();
  vi.mocked(subscribeToWebRtcVideo).mockImplementationOnce(() => {
    throw new Error('Unsupported URL');
  });
  view.rerender(<WebRtcCameraVideo ros={{} as Ros} url="bad" />);
  expect(screen.getByRole('status')).toHaveTextContent('Unsupported URL');
});
it('leaves native controls available when autoplay is blocked', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('blocked'));
  vi.mocked(subscribeToWebRtcVideo).mockImplementationOnce((_ros, _url, receive) => {
    receive({ stream: {} as MediaStream, error: null });
    return vi.fn();
  });
  render(<WebRtcCameraVideo ros={{} as Ros} url="https://camera.example/whep" />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Select Play'));
  expect(screen.getByLabelText('WebRTC camera video')).toHaveAttribute('controls');
});
