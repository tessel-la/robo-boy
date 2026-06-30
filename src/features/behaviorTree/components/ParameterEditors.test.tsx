import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActionParameterEditor from './ActionParameterEditor';
import ServiceParameterEditor from './ServiceParameterEditor';

describe('behavior tree ROS parameter bindings', () => {
  it('saves action parameters with parsed goal and result bindings', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <ActionParameterEditor
        nodeData={{
          label: 'Navigate',
          actionName: '/navigate',
          actionType: 'example/action/Navigate',
          parameters: { target: { x: 1 } },
          inputBindings: [{ targetPath: 'target.x', variable: 'goal_x' }],
          outputBindings: [{ sourcePath: 'result.ok', variable: 'completed' }],
        }}
        ros={null}
        onSave={onSave}
        onClose={onClose}
      />
    );

    fireEvent.change(screen.getByLabelText('Goal path = variable'), {
      target: { value: 'target.x=goal_x\ninvalid\ntarget.y = goal_y' },
    });
    fireEvent.change(screen.getByLabelText('Result path = variable'), {
      target: { value: 'result.ok=completed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(
      { target: { x: 1 } },
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
        onSave={onSave}
        onClose={onClose}
      />
    );

    fireEvent.change(screen.getByLabelText('Request path = variable'), {
      target: { value: 'enabled=should_enable' },
    });
    fireEvent.change(screen.getByLabelText('Response path = variable'), {
      target: { value: 'success=service_ok' },
    });
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
