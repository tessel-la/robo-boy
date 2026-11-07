import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Ros } from 'roslib';
import RosCameraImage from './RosCameraImage';
import { subscribeToImages } from '../utils/images/cameraStreams';
vi.mock('../utils/images/cameraStreams', () => ({ subscribeToImages: vi.fn(() => vi.fn()) }));
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
it('draws only the chosen ROS image topic and releases the shared subscription', () => {
  const drawImage = vi.fn(),
    stop = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as any);
  const ros = {
    getTopicType: (_topic: string, callback: (type: string) => void) => callback('sensor_msgs/msg/Image'),
  } as Ros;
  vi.mocked(subscribeToImages).mockImplementationOnce((_ros, _topic, _type, receive) => {
    receive({ frame: { image: { width: 2, height: 2, close() {} } } as any, error: null });
    return stop;
  });
  const view = render(<RosCameraImage ros={ros} topic="/camera/image" />);
  expect(subscribeToImages).toHaveBeenCalledWith(ros, '/camera/image', 'sensor_msgs/msg/Image', expect.any(Function));
  expect(screen.getByRole('img')).toBeVisible();
  expect(drawImage).toHaveBeenCalledOnce();
  view.unmount();
  expect(stop).toHaveBeenCalledOnce();
});
it('does not subscribe to unsupported types or late discovery after unmount', () => {
  let callback!: (type: string) => void;
  const ros = {
    getTopicType: (_topic: string, value: typeof callback) => {
      callback = value;
    },
  } as Ros;
  const view = render(<RosCameraImage ros={ros} topic="/camera/image" />);
  view.unmount();
  callback('sensor_msgs/Image');
  expect(subscribeToImages).not.toHaveBeenCalled();
  render(
    <RosCameraImage
      ros={{ getTopicType: (_topic: string, value: typeof callback) => value('std_msgs/String') } as Ros}
      topic="/bad"
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent('Select a ROS Image');
  expect(subscribeToImages).not.toHaveBeenCalled();
});

it('measures metric depth through letterboxed pixels, clears errors and releases the last frame', async () => {
  const { act, fireEvent } = await import('@testing-library/react');
  let receive!: Parameters<typeof subscribeToImages>[3];
  vi.mocked(subscribeToImages).mockImplementationOnce((_ros, _topic, _type, cb) => {
    receive = cb;
    return vi.fn();
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any);
  const ros = { getTopicType: (_: string, cb: (type: string) => void) => cb('sensor_msgs/Image') } as Ros;
  const view = render(<RosCameraImage ros={ros} topic="/depth" />);
  const frame = {
    image: { width: 2, height: 1, close() {} },
    depth: { width: 2, height: 1, metres: new Float32Array([1.234, 0]) },
  } as any;
  act(() => receive({ frame, error: null }));
  const canvas = screen.getByRole('img');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 200 } as DOMRect);
  // jsdom lacks PointerEvent; MouseEvent carries the coordinates for the React handler.
  fireEvent(canvas, new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 75 }));
  expect(screen.getByLabelText('Depth measurement')).toHaveTextContent('1.234 m');
  fireEvent.focus(canvas);
  expect(screen.getByLabelText('Depth measurement')).toHaveTextContent('1.234 m');
  fireEvent.keyDown(canvas, { key: 'ArrowRight' });
  expect(screen.getByLabelText('Depth measurement')).toHaveTextContent('No depth');
  fireEvent(canvas, new MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 75 }));
  expect(screen.getByLabelText('Depth measurement')).toHaveTextContent('No depth');
  fireEvent(canvas, new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 20 }));
  expect(screen.getByLabelText('Depth measurement')).toHaveTextContent('Point or use arrow keys');
  act(() => receive({ frame: null, error: 'Depth image is truncated.' }));
  expect(screen.queryByLabelText('Depth measurement')).not.toBeInTheDocument();
  expect(canvas).not.toBeVisible();
  act(() => receive({ frame, error: null }));
  expect(canvas).toBeVisible();
  view.unmount();
});
