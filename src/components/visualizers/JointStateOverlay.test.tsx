import { createRef } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import JointStateOverlay from './JointStateOverlay';
import type { JointSample, JointLimits, JointStateOptions } from '../../utils/jointStates';
const data = vi.hoisted(() => ({
  joints: [] as JointSample[],
  limits: {} as Record<string, JointLimits>,
  messageError: null as string | null,
  descriptionError: null as string | null,
  descriptionLoaded: false,
  now: 5000,
  replay: false,
}));
vi.mock('../../hooks/useJointStates', () => ({ useJointStates: () => data }));
const change = vi.fn(),
  status = vi.fn();
const sample = (name: string, position?: number, receivedAt = 5000) => ({
  name,
  position,
  velocity: 0.5,
  effort: 2,
  receivedAt,
});
const parent = createRef<HTMLDivElement>();
Object.defineProperty(parent, 'current', {
  value: Object.defineProperties(document.createElement('div'), {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  }),
});
const props = {
  ros: {} as Ros,
  topic: '/joints',
  messageType: 'sensor_msgs/JointState',
  id: 'j',
  descriptionTopic: '/robot_description',
  container: parent,
  onChange: change,
  onStatus: status,
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(data, {
    joints: [],
    limits: {},
    messageError: null,
    descriptionError: null,
    descriptionLoaded: false,
    now: 5000,
    replay: false,
  });
});
it('reports waiting/disconnected/invalid data and keeps missing limits explicit', () => {
  const { rerender } = render(<JointStateOverlay {...props} />);
  expect(screen.getByText('Waiting for joint states.')).toBeInTheDocument();
  expect(screen.getByText(/Waiting for robot description/)).toBeInTheDocument();
  data.messageError = 'Invalid JointState';
  data.descriptionError = 'Invalid URDF';
  rerender(<JointStateOverlay {...props} />);
  expect(status).toHaveBeenLastCalledWith('j', 'Invalid JointState');
  expect(screen.getByText('Invalid URDF')).toBeInTheDocument();
  rerender(<JointStateOverlay {...props} ros={null} descriptionTopic="" />);
  expect(status).toHaveBeenLastCalledWith('j', 'Disconnected.');
  expect(screen.getByText(/Select a robot description/)).toBeInTheDocument();
  rerender(<JointStateOverlay {...props} options={{ visible: false }} />);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});
it('shows real values and units without clamping out-of-range telemetry or inventing missing values', () => {
  data.joints = [sample('arm', 2), sample('slide', 0.04), sample('wheel', 7), sample('unknown'), sample('locked', 1)];
  data.limits = {
    arm: { type: 'revolute', lower: -1, upper: 1, velocity: 2, effort: 20 },
    slide: { type: 'prismatic', lower: 0, upper: 0.08 },
    wheel: { type: 'continuous' },
    locked: { type: 'revolute', lower: 1, upper: 1 },
  };
  data.descriptionLoaded = true;
  const { rerender } = render(
    <JointStateOverlay {...props} options={{ angleUnit: 'deg', showVelocity: true, showEffort: true }} />
  );
  expect(screen.getByRole('meter', { name: 'arm position' })).toHaveAttribute(
    'aria-valuetext',
    '114.592 deg, outside limits'
  );
  expect(screen.getByText('Outside position limits')).toBeInTheDocument();
  expect(screen.getByText('Min -57.296 deg')).toBeInTheDocument();
  expect(screen.getByText('Max 0.080 m')).toBeInTheDocument();
  expect(screen.getByText('Continuous · no position limits')).toBeInTheDocument();
  expect(screen.getByText('Limits unavailable')).toBeInTheDocument();
  const arm = screen.getByText('arm').closest('article')!;
  expect(within(arm).getByText(/Velocity 28.648 deg\/s · max 114.592/)).toBeInTheDocument();
  expect(within(arm).getByText(/Effort 2.000 N·m · max 20.000/)).toBeInTheDocument();
  expect(within(screen.getByText('unknown').closest('article')!).getByText('—')).toBeInTheDocument();
  expect(screen.getByRole('meter', { name: 'locked position' }).firstElementChild).toHaveStyle({ width: '50%' });
  rerender(<JointStateOverlay {...props} options={{ filter: 'SLIDE', backgroundOpacity: 0.4 }} />);
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByRole('region').style.getPropertyValue('--joint-background-opacity')).toBe('40%');
  rerender(<JointStateOverlay {...props} options={{ filter: 'absent' }} />);
  expect(screen.getByText('No joints match the filter.')).toBeInTheDocument();
});
it('marks old live readings stale, preserves paused replay and supports keyboard placement', () => {
  data.joints = [sample('arm', 0.5, 0)];
  const options: JointStateOptions = { frame: { left: 100, top: 100, width: 320, height: 300 } };
  const wheel = vi.fn(),
    pointer = vi.fn();
  const renderOverlay = () => (
    <div onWheel={wheel} onPointerDown={pointer}>
      <JointStateOverlay {...props} options={options} />
    </div>
  );
  const { rerender } = render(renderOverlay());
  expect(screen.getByText('Stale reading')).toBeInTheDocument();
  const move = screen.getByRole('button', { name: 'Move joint states on /joints' });
  fireEvent.keyDown(move, { key: 'ArrowLeft' });
  expect(change).toHaveBeenLastCalledWith('j', { frame: { left: 95, top: 100, width: 320, height: 300 } });
  fireEvent.keyDown(move, { key: 'ArrowDown', shiftKey: true });
  expect(change).toHaveBeenLastCalledWith('j', { frame: { left: 100, top: 120, width: 320, height: 300 } });
  const resize = screen.getByRole('button', { name: 'Resize joint states on /joints' });
  fireEvent.keyDown(resize, { key: 'ArrowRight' });
  expect(change).toHaveBeenLastCalledWith('j', { frame: { left: 100, top: 100, width: 325, height: 300 } });
  change.mockClear();
  fireEvent.keyDown(resize, { key: 'Enter' });
  expect(change).not.toHaveBeenCalled();
  fireEvent.wheel(screen.getByRole('region'));
  fireEvent.pointerDown(screen.getByText('arm'));
  expect(wheel).not.toHaveBeenCalled();
  expect(pointer).not.toHaveBeenCalled();
  data.replay = true;
  rerender(renderOverlay());
  expect(screen.queryByText('Stale reading')).not.toBeInTheDocument();
});
