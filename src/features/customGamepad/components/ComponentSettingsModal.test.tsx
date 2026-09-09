import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';

import type { GamepadComponentConfig } from '../types';
import ComponentSettingsModal from './ComponentSettingsModal';

const slider: GamepadComponentConfig = {
  id: 'slider-1',
  type: 'slider',
  label: 'Throttle',
  position: { x: 1, y: 1, width: 2, height: 1 },
  action: { topic: '/throttle', messageType: 'std_msgs/Float32', field: 'data' },
  config: { min: -1, max: 1, step: 0.1, orientation: 'horizontal' },
};

const createConnectedRos = (topics: string[], types: string[]) => ({
  isConnected: true,
  getTopics: vi.fn((onSuccess: (response: { topics: string[]; types: string[] }) => void) => {
    onSuccess({ topics, types });
  }),
}) as unknown as Ros;

describe('ComponentSettingsModal', () => {
  it('keeps configuration behavior intact while exposing the existing slider parameters', () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    render(<ComponentSettingsModal isOpen component={slider} onClose={onClose} onSave={onSave} />);

    expect(screen.getByRole('dialog', { name: 'Configure Slider' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Display label'), { target: { value: 'Speed' } });
    fireEvent.change(screen.getByLabelText('Custom topic'), { target: { value: '/drive/speed' } });

    const minimum = screen.getByRole('spinbutton', { name: 'Minimum value' });
    fireEvent.change(minimum, { target: { value: '-5' } });
    fireEvent.blur(minimum);

    const maximum = screen.getByRole('spinbutton', { name: 'Maximum value' });
    fireEvent.change(maximum, { target: { value: '5' } });
    fireEvent.blur(maximum);

    const step = screen.getByRole('spinbutton', { name: 'Step size' });
    fireEvent.change(step, { target: { value: '0.25' } });
    fireEvent.blur(step);

    fireEvent.change(screen.getByLabelText('Orientation'), { target: { value: 'vertical' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'slider-1',
        label: 'Speed',
        action: { topic: '/drive/speed', messageType: 'std_msgs/Float32', field: 'data' },
        config: { min: -5, max: 5, step: 0.25, orientation: 'vertical' },
      })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fills camera settings when an available ROS topic is selected', async () => {
    const camera: GamepadComponentConfig = {
      id: 'camera-1',
      type: 'camera',
      label: 'Camera',
      position: { x: 0, y: 0, width: 2, height: 2 },
      action: { topic: '/camera/raw', messageType: 'sensor_msgs/Image' },
      config: { cameraTransport: 'ros', streamType: 'mjpeg' },
    };
    const ros = createConnectedRos(
      ['/camera/raw', '/camera/compressed'],
      ['sensor_msgs/Image', 'sensor_msgs/msg/CompressedImage']
    );

    render(
      <ComponentSettingsModal
        isOpen
        component={camera}
        onClose={vi.fn()}
        onSave={vi.fn()}
        ros={ros}
      />
    );

    await screen.findByRole('option', {
      name: '/camera/compressed (sensor_msgs/msg/CompressedImage)',
    });
    fireEvent.change(screen.getByLabelText('Topic'), {
      target: { value: '/camera/compressed' },
    });

    expect(screen.getByLabelText('Message type')).toHaveValue('sensor_msgs/CompressedImage');
  });

  it('switches heartbeat mode when a boolean ROS topic is selected', async () => {
    const heartbeat: GamepadComponentConfig = {
      id: 'heartbeat-1',
      type: 'heartbeat',
      label: 'Heartbeat',
      position: { x: 0, y: 0, width: 1, height: 1 },
      action: { topic: '/heartbeat/count', messageType: 'std_msgs/Int32', field: 'data' },
      config: { heartbeatMode: 'pulse', heartbeatTimeoutMs: 1000 },
    };
    const onSave = vi.fn();
    const ros = createConnectedRos(
      ['/heartbeat/count', '/heartbeat/ready'],
      ['std_msgs/Int32', 'std_msgs/msg/Bool']
    );

    render(
      <ComponentSettingsModal
        isOpen
        component={heartbeat}
        onClose={vi.fn()}
        onSave={onSave}
        ros={ros}
      />
    );

    await screen.findByRole('option', { name: '/heartbeat/ready (std_msgs/msg/Bool)' });
    fireEvent.change(screen.getByLabelText('Topic'), {
      target: { value: '/heartbeat/ready' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      action: {
        topic: '/heartbeat/ready',
        messageType: 'std_msgs/Bool',
        field: 'data',
      },
      config: expect.objectContaining({
        heartbeatMode: 'boolean',
        heartbeatFieldPath: 'data',
      }),
    }));
  });

  it('keeps selected odometry metadata when a custom odometry topic is entered', async () => {
    const joystick: GamepadComponentConfig = {
      id: 'joystick-1',
      type: 'joystick',
      label: 'Pose control',
      position: { x: 0, y: 0, width: 2, height: 2 },
      action: { topic: '/target_pose', messageType: 'geometry_msgs/PoseStamped', field: 'pose' },
      config: {
        min: -1,
        max: 1,
        axes: ['position.x', 'position.y'],
        poseStampedReferenceMode: 'odometry',
        poseStampedOdometryTopic: '/odom',
      },
    };
    const onSave = vi.fn();
    const ros = createConnectedRos(
      ['/odom', '/odometry/filtered'],
      ['nav_msgs/Odometry', 'nav_msgs/msg/Odometry']
    );

    render(
      <ComponentSettingsModal
        isOpen
        component={joystick}
        onClose={vi.fn()}
        onSave={onSave}
        ros={ros}
      />
    );

    await screen.findByRole('option', { name: '/odometry/filtered (nav_msgs/msg/Odometry)' });
    fireEvent.change(screen.getByLabelText('Odometry topic'), {
      target: { value: '/odometry/filtered' },
    });
    expect(screen.getByLabelText('Odometry Message Type:')).toHaveValue('nav_msgs/msg/Odometry');

    fireEvent.change(screen.getByLabelText('Custom odometry topic'), {
      target: { value: '/robot/odom' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        poseStampedReferenceMode: 'odometry',
        poseStampedOdometryTopic: '/robot/odom',
        poseStampedOdometryMessageType: 'nav_msgs/msg/Odometry',
      }),
    }));
  });
});
