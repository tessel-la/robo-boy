import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ROSLIB from 'roslib';

const topicMock = vi.hoisted(() => ({
  instances: [] as Array<{
    name: string;
    callback?: (message: unknown) => void;
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('roslib', () => ({
  Topic: vi.fn(function Topic(options: { name: string }) {
    const instance = {
      name: options.name,
      callback: undefined as ((message: unknown) => void) | undefined,
      subscribe: vi.fn((callback: (message: unknown) => void) => {
        instance.callback = callback;
      }),
      unsubscribe: vi.fn(),
    };
    topicMock.instances.push(instance);
    return instance;
  }),
}));

const transformMessage = (childFrame: string, x: number) => ({
  transforms: [{
    header: { frame_id: '/map' },
    child_frame_id: `/${childFrame}`,
    transform: {
      translation: { x, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
  }],
});

describe('shared TF stream', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    topicMock.instances = [];
  });

  it('shares one topic pair and releases it after the final consumer', async () => {
    const { subscribeToTfStream } = await import('./tfStream');
    const ros = {} as any;
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    const unsubscribeFirst = subscribeToTfStream(ros, firstListener);
    const unsubscribeSecond = subscribeToTfStream(ros, secondListener);

    expect(topicMock.instances.map(topic => topic.name)).toEqual(['/tf', '/tf_static']);
    expect(firstListener).toHaveBeenCalledWith({ transforms: {}, changedFrames: new Set() });
    expect(secondListener).toHaveBeenCalledWith({ transforms: {}, changedFrames: new Set() });

    topicMock.instances.find(topic => topic.name === '/tf')?.callback?.(transformMessage('base_link', 1));
    expect(firstListener).toHaveBeenLastCalledWith(expect.objectContaining({
      changedFrames: new Set(['base_link']),
    }));
    expect(secondListener).toHaveBeenCalledTimes(2);

    unsubscribeFirst();
    expect(topicMock.instances.every(topic => topic.unsubscribe.mock.calls.length === 0)).toBe(true);

    unsubscribeSecond();
    expect(topicMock.instances.every(topic => topic.unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('preserves interleaved publishers without topic-wide throttling or replacement queues', async () => {
    const { subscribeToTfStream } = await import('./tfStream');
    const listener = vi.fn();
    const stop = subscribeToTfStream({} as any, listener);
    expect(ROSLIB.Topic).toHaveBeenCalledWith(
      expect.objectContaining({ name: '/tf', throttle_rate: 0, queue_length: 0 })
    );
    expect(ROSLIB.Topic).toHaveBeenCalledWith(
      expect.objectContaining({ name: '/tf_static', throttle_rate: 0, queue_length: 0 })
    );
    const dynamic = topicMock.instances.find(topic => topic.name === '/tf')!;
    for (let i = 0; i < 60; i++) {
      dynamic.callback?.(transformMessage('robot_small_link_1', i));
      dynamic.callback?.(transformMessage('robot_big_link_1', i + 10));
    }
    const last = listener.mock.calls[listener.mock.calls.length - 1][0].transforms;
    expect(last.robot_small_link_1.transform.translation.x).toBe(59);
    expect(last.robot_big_link_1.transform.translation.x).toBe(69);
    stop();
  });

  it('replays current data to a panel joining an active connection', async () => {
    const { subscribeToTfStream } = await import('./tfStream');
    const ros = {} as any;
    const unsubscribeFirst = subscribeToTfStream(ros, vi.fn());
    topicMock.instances.find(topic => topic.name === '/tf')?.callback?.(transformMessage('base_link', 4));
    const joiningListener = vi.fn();

    const unsubscribeSecond = subscribeToTfStream(ros, joiningListener);

    expect(joiningListener.mock.calls[0][0].transforms.base_link.transform.translation.x).toBe(4);
    expect(joiningListener.mock.calls[0][0].changedFrames).toEqual(new Set(['base_link']));

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('retains static data but drops stale dynamic data while no panel is mounted', async () => {
    const { subscribeToTfStream } = await import('./tfStream');
    const ros = {} as any;
    const firstListener = vi.fn();
    const unsubscribe = subscribeToTfStream(ros, firstListener);
    const oldDynamicTopic = topicMock.instances.find(topic => topic.name === '/tf')!;

    oldDynamicTopic.callback?.(transformMessage('base_link', 1));
    topicMock.instances.find(topic => topic.name === '/tf_static')?.callback?.(transformMessage('camera_mount', 2));
    unsubscribe();

    // A delivery already queued by the old ROSLIB topic must not repopulate the stopped source.
    oldDynamicTopic.callback?.(transformMessage('base_link', 99));

    const nextListener = vi.fn();
    const unsubscribeNext = subscribeToTfStream(ros, nextListener);
    const replay = nextListener.mock.calls[0][0];

    expect(replay.transforms.base_link).toBeUndefined();
    expect(replay.transforms.camera_mount.transform.translation.x).toBe(2);
    expect(topicMock.instances).toHaveLength(4);

    unsubscribeNext();
  });

  it('isolates subscriptions and snapshots by live ROS identity', async () => {
    const { subscribeToTfStream } = await import('./tfStream');
    const firstRos = {} as any;
    const secondRos = {} as any;
    const unsubscribeFirst = subscribeToTfStream(firstRos, vi.fn());
    topicMock.instances.find(topic => topic.name === '/tf')?.callback?.(transformMessage('base_link', 7));
    const secondListener = vi.fn();

    const unsubscribeSecond = subscribeToTfStream(secondRos, secondListener);

    expect(topicMock.instances.map(topic => topic.name)).toEqual(['/tf', '/tf_static', '/tf', '/tf_static']);
    expect(secondListener).toHaveBeenCalledWith({ transforms: {}, changedFrames: new Set() });

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('ignores malformed and unchanged messages', async () => {
    const { mergeTfMessage } = await import('./tfStream');
    const initial = mergeTfMessage({}, transformMessage('base_link', 1), false)!;

    expect(mergeTfMessage(initial.transforms, transformMessage('base_link', 1), false)).toBeNull();
    expect(mergeTfMessage(initial.transforms, { transforms: [{}] }, false)).toBeNull();
    expect(mergeTfMessage(initial.transforms, { transforms: 'invalid' }, false)).toBeNull();
  });

  it('feeds raw messages to a message consumer on the same topic pair', async () => {
    const { subscribeToTfMessages, subscribeToTfStream } = await import('./tfStream');
    const ros = {} as any;
    const messages = vi.fn();

    const stopMessages = subscribeToTfMessages(ros, messages);
    const stopStream = subscribeToTfStream(ros, vi.fn());
    expect(topicMock.instances.map(topic => topic.name)).toEqual(['/tf', '/tf_static']);

    const staticMessage = transformMessage('camera', 2);
    topicMock.instances.find(topic => topic.name === '/tf_static')?.callback?.(staticMessage);
    expect(messages).toHaveBeenCalledWith(staticMessage, 'static');

    // A consumer joining later gets the latched statics the subscription already received, which
    // rosbridge would not re-send to it.
    const late = vi.fn();
    const stopLate = subscribeToTfMessages(ros, late);
    expect(late).toHaveBeenCalledWith(staticMessage, 'static');
    expect(late).toHaveBeenCalledTimes(1);
    stopLate();

    stopStream();
    expect(topicMock.instances.every(topic => topic.unsubscribe.mock.calls.length === 0)).toBe(true);
    stopMessages();
    expect(topicMock.instances.every(topic => topic.unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('reset forgets everything, tells stream consumers, and subscribes again', async () => {
    const { resetTfStream, subscribeToTfStream } = await import('./tfStream');
    const ros = {} as any;
    const listener = vi.fn();
    subscribeToTfStream(ros, listener);
    topicMock.instances.find(topic => topic.name === '/tf_static')?.callback?.(transformMessage('camera', 2));
    topicMock.instances.find(topic => topic.name === '/tf')?.callback?.(transformMessage('base_link', 1));
    const originalTopics = [...topicMock.instances];

    resetTfStream(ros);

    expect(originalTopics.every(topic => topic.unsubscribe.mock.calls.length === 1)).toBe(true);
    expect(listener).toHaveBeenLastCalledWith({ transforms: {}, changedFrames: new Set(['camera', 'base_link']) });
    expect(topicMock.instances.slice(2).map(topic => topic.name)).toEqual(['/tf', '/tf_static']);

    // Whatever the robot re-sends is the new truth.
    topicMock.instances[3].callback?.(transformMessage('new_static', 3));
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ changedFrames: new Set(['new_static']) }));
    expect(Object.keys(listener.mock.calls[listener.mock.calls.length - 1][0].transforms)).toEqual(["new_static"]);

    // Resetting a connection nothing listens to is a no-op.
    expect(() => resetTfStream({} as any)).not.toThrow();
  });
});
