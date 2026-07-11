import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BlackboardBindingEditor, { isBlackboardTypeCompatible, isBlackboardValueCompatible } from './BlackboardBindingEditor';

describe('BlackboardBindingEditor', () => {
  it('filters input choices by the selected ROS field type while keeping dynamic values available', () => {
    const { container } = render(
      <BlackboardBindingEditor
        direction="input"
        bindings={[{ targetPath: 'speed', variable: 'wrong_text' }]}
        onChange={() => undefined}
        pathSuggestions={[{ path: 'speed', rosType: 'float64' }]}
        blackboardVariables={['speed_value', 'wrong_text', 'runtime_result']}
        blackboardValues={{ speed_value: 1.5, wrong_text: 'fast' }}
      />
    );

    const options = within(screen.getByLabelText('Blackboard key 1')).getAllByRole('option');
    expect(options.map(option => option.getAttribute('value'))).toEqual(['', 'runtime_result', 'speed_value', 'wrong_text']);
    expect(container.querySelector('.bbe-row')).toHaveClass('incompatible');
  });

  it('checks primitive, array, and structured values against ROS types', () => {
    expect(isBlackboardValueCompatible(2, 'float32')).toBe(true);
    expect(isBlackboardValueCompatible('2', 'float32')).toBe(false);
    expect(isBlackboardValueCompatible([], 'float64[]')).toBe(true);
    expect(isBlackboardValueCompatible({}, 'geometry_msgs/msg/Point')).toBe(true);
    expect(isBlackboardTypeCompatible('float64', 'double')).toBe(true);
    expect(isBlackboardTypeCompatible('float32', 'int32')).toBe(false);
    expect(isBlackboardTypeCompatible('pose', 'geometry_msgs/msg/Pose')).toBe(true);
    expect(isBlackboardTypeCompatible('twist', 'geometry_msgs/msg/Pose')).toBe(false);
  });
});
