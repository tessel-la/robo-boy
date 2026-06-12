import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamepadComponentConfig } from '../types';
import DPadComponent from './DPadComponent';

const roslibMock = vi.hoisted(() => ({
  topics: [] as Array<{
    name: string;
    publish: ReturnType<typeof vi.fn>;
    advertise: ReturnType<typeof vi.fn>;
    unadvertise: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('roslib', () => ({
  default: {
    Topic: vi.fn(function Topic(options: { name: string }) {
      const topic = {
        name: options.name,
        publish: vi.fn(),
        advertise: vi.fn(),
        unadvertise: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      };
      roslibMock.topics.push(topic);
      return topic;
    }),
    Message: vi.fn(function Message(value: unknown) {
      return value;
    }),
  },
}));

describe('DPadComponent', () => {
  beforeEach(() => {
    roslibMock.topics = [];
  });

  it('publishes directional PoseStamped offsets', () => {
    const config: GamepadComponentConfig = {
      id: 'pose-dpad',
      type: 'dpad',
      position: { x: 0, y: 0, width: 2, height: 2 },
      action: {
        topic: '/target_pose',
        messageType: 'geometry_msgs/msg/PoseStamped',
        field: 'pose',
      },
      config: {
        axes: ['position.x', 'position.z'],
        poseStampedFrameId: 'base_link',
        poseStampedReferenceMode: 'frame',
      },
    };

    const { getByRole } = render(<DPadComponent config={config} ros={{} as any} />);
    fireEvent.pointerDown(getByRole('button', { name: '↑' }));

    expect(roslibMock.topics).toHaveLength(1);
    expect(roslibMock.topics[0].publish).toHaveBeenCalledOnce();
    expect(roslibMock.topics[0].publish.mock.calls[0][0]).toMatchObject({
      header: { frame_id: 'base_link' },
      pose: {
        position: { x: 0, y: 0, z: 1 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    });
  });

  it('starts publishing after resolving the configured reference frame from /tf', () => {
    const config: GamepadComponentConfig = {
      id: 'tf-pose-dpad',
      type: 'dpad',
      position: { x: 0, y: 0, width: 2, height: 2 },
      action: {
        topic: '/target_pose',
        messageType: 'geometry_msgs/msg/PoseStamped',
        field: 'pose',
      },
      config: {
        axes: ['position.x', 'position.y'],
        poseStampedFrameId: 'base_link',
        poseStampedReferenceMode: 'tf',
        poseStampedReferenceFrameId: 'end_effector',
      },
    };

    const { getByRole } = render(<DPadComponent config={config} ros={{} as any} />);
    const tfTopic = roslibMock.topics.find(topic => topic.name === '/tf');
    const outputTopic = roslibMock.topics.find(topic => topic.name === '/target_pose');
    expect(tfTopic).toBeDefined();
    expect(outputTopic).toBeDefined();

    const handleTf = tfTopic!.subscribe.mock.calls[0][0];
    handleTf({
      transforms: [{
        header: { frame_id: 'base_link' },
        child_frame_id: 'end_effector',
        transform: {
          translation: { x: 2, y: 3, z: 4 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      }],
    });
    fireEvent.pointerDown(getByRole('button', { name: '→' }));

    expect(outputTopic!.publish).toHaveBeenCalledOnce();
    expect(outputTopic!.publish.mock.calls[0][0]).toMatchObject({
      header: { frame_id: 'base_link' },
      pose: {
        position: { x: 3, y: 3, z: 4 },
      },
    });
  });
});
