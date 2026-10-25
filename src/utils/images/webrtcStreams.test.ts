import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { readSignalingText, subscribeToWebRtcFrames, subscribeToWebRtcVideo } from './webrtcStreams';

const state = vi.hoisted(() => ({ topics: [] as any[] }));
vi.mock('roslib', () => ({
  Topic: class {
    callback?: (m: unknown) => void;
    unsubscribe = vi.fn();
    constructor(public config: unknown) {
      state.topics.push(this);
    }
    subscribe(callback: (m: unknown) => void) {
      this.callback = callback;
    }
  },
}));
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
class Peer extends EventTarget {
  static all: Peer[] = [];
  iceGatheringState = 'complete';
  connectionState = 'new';
  ontrack?: (event: any) => void;
  onconnectionstatechange?: () => void;
  localDescription?: object;
  close = vi.fn();
  addTransceiver = vi.fn();
  constructor() {
    super();
    Peer.all.push(this);
  }
  async createOffer() {
    return { type: 'offer', sdp: 'offer' };
  }
  async setLocalDescription(value: object) {
    this.localDescription = value;
  }
  async setRemoteDescription() {
    this.ontrack?.({ track: { kind: 'video' }, streams: [{ id: 'native' }] });
  }
}
let fetchMock: ReturnType<typeof vi.fn>, frameCallback: VideoFrameRequestCallback;
const image = () => ({ width: 640, height: 480, close: vi.fn() });
beforeEach(() => {
  Peer.all = [];
  state.topics = [];
  vi.stubGlobal('RTCPeerConnection', Peer);
  fetchMock = vi.fn(async (_url, init) =>
    init.method === 'POST'
      ? new Response('answer', { status: 201, headers: { Location: '/camera/whep/session' } })
      : new Response(null, { status: 204 })
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => image())
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(document, 'createElement').mockImplementation((() => {
    const video = Object.create(HTMLVideoElement.prototype);
    Object.defineProperties(video, {
      videoWidth: { value: 640 },
      videoHeight: { value: 480 },
      requestVideoFrameCallback: {
        value: (callback: VideoFrameRequestCallback) => {
          frameCallback = callback;
          return 1;
        },
      },
      cancelVideoFrameCallback: { value: vi.fn() },
      srcObject: { writable: true },
      muted: { writable: true },
      playsInline: { writable: true },
    });
    return video;
  }) as any);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('shares one native WHEP connection, needs no metadata for 2D, and deletes only after the last consumer', async () => {
  const ros = {} as Ros,
    a = vi.fn(),
    b = vi.fn();
  const stopA = subscribeToWebRtcVideo(ros, '/camera/whep', a);
  const stopB = subscribeToWebRtcVideo(ros, '/camera/whep', b);
  await flush();
  expect(Peer.all).toHaveLength(1);
  expect(a).toHaveBeenLastCalledWith({ stream: { id: 'native' }, error: null });
  expect(state.topics).toHaveLength(0);
  stopA();
  expect(Peer.all[0].close).not.toHaveBeenCalled();
  stopB();
  await flush();
  expect(Peer.all[0].close).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls.filter(c => c[1].method === 'DELETE')).toHaveLength(1);
});
it('shares video and 3D frames, retaining bitmap leases without affecting native playback', async () => {
  const ros = {} as Ros,
    listener = vi.fn();
  const stopVideo = subscribeToWebRtcVideo(ros, '/camera/whep', vi.fn());
  const stop = subscribeToWebRtcFrames(ros, '/camera/whep', listener);
  await flush();
  frameCallback(100, {} as any);
  await flush();
  const frame = listener.mock.lastCall![0].frame,
    release = frame.retain();
  stop();
  expect(frame.image.close).not.toHaveBeenCalled();
  expect(Peer.all[0].close).not.toHaveBeenCalled();
  release();
  expect(frame.image.close).toHaveBeenCalledOnce();
  stopVideo();
});
it('supplies ordinary decoded frames with no ROS metadata subscriptions', async () => {
  const listener = vi.fn();
  const stop = subscribeToWebRtcFrames({} as Ros, '/camera/whep', listener);
  await flush();
  frameCallback(100, {} as any);
  await flush();
  expect(listener.mock.lastCall![0].frame.header).toBeUndefined();
  expect(listener.mock.lastCall![0].frame.image.width).toBe(640);
  expect(state.topics).toHaveLength(0);
  stop();
});
it('rejects a cross-origin session Location and closes the peer', async () => {
  fetchMock.mockImplementation(async (_url, init) =>
    init.method === 'POST'
      ? new Response('answer', { status: 201, headers: { Location: 'https://other.example/camera/whep/session' } })
      : new Response(null, { status: 204 })
  );
  const listener = vi.fn(),
    stop = subscribeToWebRtcVideo({} as Ros, '/camera/whep', listener);
  await flush();
  expect(listener.mock.lastCall![0].error).toContain('outside the selected stream');
  expect(Peer.all[0].close).toHaveBeenCalled();
  expect(fetchMock.mock.calls.every(c => !String(c[0]).includes('other.example'))).toBe(true);
  stop();
});
it('aborts pending negotiation when the final consumer leaves', async () => {
  let signal: AbortSignal | undefined;
  fetchMock.mockImplementation((_url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  });
  const stop = subscribeToWebRtcVideo({} as Ros, '/camera/whep', vi.fn());
  stop();
  expect(signal?.aborted).toBe(true);
  expect(Peer.all).toHaveLength(0);
});
it('limits signaling before allocating unbounded text', async () => {
  await expect(readSignalingText(new Response('a'.repeat(262145)))).rejects.toThrow('exceeds');
});

it('keeps native video alive if 3D capture APIs are unavailable', async () => {
  const ros = {} as Ros,
    video = vi.fn(),
    frames = vi.fn();
  vi.stubGlobal('createImageBitmap', undefined);
  const stopVideo = subscribeToWebRtcVideo(ros, '/camera/whep', video);
  const stopFrames = subscribeToWebRtcFrames(ros, '/camera/whep', frames);
  await flush();
  expect(video.mock.lastCall![0].stream).toEqual({ id: 'native' });
  expect(frames.mock.lastCall![0].error).toContain('cannot capture');
  expect(Peer.all[0].close).not.toHaveBeenCalled();
  stopFrames();
  stopVideo();
});
it('reports HTTP failure without changing source and retries on an explicit new subscription', async () => {
  let fail = true;
  fetchMock.mockImplementation(async (_url, init) =>
    init.method === 'POST'
      ? fail
        ? new Response(null, { status: 503 })
        : new Response('answer', { status: 201, headers: { Location: '/camera/whep/session' } })
      : new Response(null, { status: 204 })
  );
  const ros = {} as Ros,
    frames = vi.fn();
  const stopFrames = subscribeToWebRtcFrames(ros, '/camera/whep', frames);
  await flush();
  expect(frames.mock.lastCall![0].error).toContain('503');
  fail = false;
  const video = vi.fn(),
    stopVideo = subscribeToWebRtcVideo(ros, '/camera/whep', video);
  await flush();
  expect(video.mock.lastCall![0].stream).toEqual({ id: 'native' });
  expect(Peer.all).toHaveLength(2);
  stopFrames();
  stopVideo();
});

it('captures at the highest requested 3D rate while retaining one native connection', async () => {
  const ros = {} as Ros,
    stopVideo = subscribeToWebRtcVideo(ros, '/camera/whep', vi.fn());
  const stopSlow = subscribeToWebRtcFrames(ros, '/camera/whep', vi.fn(), 5);
  const stopFast = subscribeToWebRtcFrames(ros, '/camera/whep', vi.fn(), 30);
  await flush();
  for (const now of [0, 40, 80]) {
    frameCallback(now, {} as any);
    await flush();
  }
  expect(createImageBitmap).toHaveBeenCalledTimes(3);
  stopFast();
  frameCallback(120, {} as any);
  await flush();
  expect(createImageBitmap).toHaveBeenCalledTimes(3);
  frameCallback(300, {} as any);
  await flush();
  expect(createImageBitmap).toHaveBeenCalledTimes(4);
  expect(Peer.all).toHaveLength(1);
  stopSlow();
  stopVideo();
});
