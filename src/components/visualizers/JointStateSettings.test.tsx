import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import JointStateSettings from './JointStateSettings';
it('configures observer presentation, remapped descriptions and placement reset independently', () => {
  const update = vi.fn();
  const props = {
    id: 'j',
    topic: '/joints',
    descriptionTopic: '/saved/description',
    topics: [
      { name: '/remapped', type: 'std_msgs/msg/String' },
      { name: '/joints', type: 'sensor_msgs/JointState' },
    ],
    onChange: update,
  };
  const { rerender } = render(<JointStateSettings {...props} />);
  const description = screen.getByLabelText('Robot description (limits)');
  expect(description).toHaveTextContent('/saved/description (current)');
  expect(description).toHaveTextContent('/remapped');
  expect(description).not.toHaveTextContent('/joints');
  fireEvent.change(description, { target: { value: '/remapped' } });
  expect(update).toHaveBeenLastCalledWith('j', { robotDescriptionTopic: '/remapped' });
  fireEvent.change(screen.getByLabelText('Angle units'), { target: { value: 'deg' } });
  expect(update).toHaveBeenLastCalledWith('j', { angleUnit: 'deg' });
  fireEvent.change(screen.getByLabelText('Filter joint names'), { target: { value: 'elbow' } });
  expect(update).toHaveBeenLastCalledWith('j', { filter: 'elbow' });
  fireEvent.change(screen.getByLabelText('Background opacity'), { target: { value: '0.5' } });
  expect(update).toHaveBeenLastCalledWith('j', { backgroundOpacity: 0.5 });
  for (const [label, key] of [
    ['Show Joint states on /joints', 'visible'],
    ['Show velocity for Joint states on /joints', 'showVelocity'],
    ['Show effort for Joint states on /joints', 'showEffort'],
  ] as const) {
    fireEvent.click(screen.getByLabelText(label));
    expect(update).toHaveBeenLastCalledWith('j', { [key]: key !== 'visible' });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Reset overlay position and size' }));
  expect(update).toHaveBeenLastCalledWith('j', { frame: undefined });
  rerender(
    <JointStateSettings
      {...props}
      descriptionTopic="/remapped"
      options={{ backgroundOpacity: 0.5, angleUnit: 'deg', filter: 'elbow', showVelocity: true }}
    />
  );
  expect(screen.getByLabelText('Angle units')).toHaveValue('deg');
  expect(screen.getByLabelText('Background opacity')).toHaveValue('0.5');
  expect(screen.getByLabelText('Filter joint names')).toHaveValue('elbow');
});
