import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActionParameterEditor from './ActionParameterEditor';
import ServiceParameterEditor from './ServiceParameterEditor';

describe('behavior tree ROS parameter bindings', () => {
  it('shows nested parameter connections directly in the form list', () => {
    render(
      <ActionParameterEditor
        nodeData={{
          label: 'Navigate',
          actionName: '/navigate',
          actionType: 'example/action/Navigate',
          parameters: { target: { x: 1, y: 2 } },
          inputBindings: [{ targetPath: 'target.x', variable: 'goal_x' }],
        }}
        ros={null}
        blackboardVariables={['goal_x']}
        blackboardValues={{ goal_x: 4 }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('← goal_x')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Goal field 1')).getAllByRole('option').map(option => option.getAttribute('value'))
    ).toEqual(['', 'target', 'target.x', 'target.y']);
    fireEvent.click(screen.getByRole('button', { name: /TARGET/ }));
    expect(screen.getByText('← goal_x')).toBeInTheDocument();
    expect(screen.getByText('X')).toBeInTheDocument();
  });

  it('saves action parameters with parsed goal and result bindings', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <ActionParameterEditor
        nodeData={{
          label: 'Navigate',
          actionName: '/navigate',
          actionType: 'example/action/Navigate',
          parameters: { target: { x: 1, y: 0 } },
          inputBindings: [{ targetPath: 'target.x', variable: 'goal_x' }],
          outputBindings: [{ sourcePath: 'result.ok', variable: 'completed' }],
        }}
        ros={null}
        blackboardVariables={['goal_x', 'goal_y', 'completed']}
        blackboardValues={{ goal_x: 1, goal_y: 2, completed: false }}
        onSave={onSave}
        onClose={onClose}
      />
    );

    const inputs = screen.getByLabelText('input blackboard bindings');
    fireEvent.click(within(inputs).getByRole('button', { name: '+ Connect' }));
    fireEvent.change(screen.getByLabelText('Goal field 2'), { target: { value: 'target.y' } });
    fireEvent.change(within(inputs).getByLabelText('Blackboard key 2'), { target: { value: 'goal_y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(
      { target: { x: 1, y: 0 } },
      [
        { targetPath: 'target.x', variable: 'goal_x' },
        { targetPath: 'target.y', variable: 'goal_y' },
      ],
      [{ sourcePath: 'result.ok', variable: 'completed' }]
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('saves JSON service requests with request and response bindings', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <ServiceParameterEditor
        nodeData={{
          label: 'Enable',
          serviceName: '/enable',
          serviceType: 'example/srv/Enable',
          request: { enabled: false },
        }}
        ros={null}
        blackboardVariables={['should_enable', 'service_ok']}
        blackboardValues={{ should_enable: false, service_ok: false }}
        onSave={onSave}
        onClose={onClose}
      />
    );

    const inputs = screen.getByLabelText('input blackboard bindings');
    fireEvent.click(within(inputs).getByRole('button', { name: '+ Connect' }));
    fireEvent.change(screen.getByLabelText('Request field 1'), { target: { value: 'enabled' } });
    fireEvent.change(within(inputs).getByLabelText('Blackboard key 1'), { target: { value: 'should_enable' } });
    const outputs = screen.getByLabelText('output blackboard bindings');
    fireEvent.click(within(outputs).getByRole('button', { name: '+ Connect' }));
    fireEvent.change(screen.getByLabelText('Response field 1'), { target: { value: 'success' } });
    fireEvent.change(within(outputs).getByLabelText('Blackboard key 1'), { target: { value: 'service_ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    fireEvent.change(screen.getByPlaceholderText('{}'), { target: { value: '{"enabled":true}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(
      { enabled: true },
      [{ targetPath: 'enabled', variable: 'should_enable' }],
      [{ sourcePath: 'success', variable: 'service_ok' }]
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
