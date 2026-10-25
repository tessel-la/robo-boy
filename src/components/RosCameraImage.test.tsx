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
