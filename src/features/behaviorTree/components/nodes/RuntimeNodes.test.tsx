import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionStatus } from '../../types';
import IfElseNode from './IfElseNode';
import SubscriberNode from './SubscriberNode';
import TimeoutNode from './TimeoutNode';

vi.mock('reactflow', () => ({
  Handle: ({ id }: { id?: string }) => <span data-testid={`handle-${id || 'default'}`} />,
  Position: { Top: 'top', Bottom: 'bottom' },
}));

const nodeProps = (data: unknown, selected = false) => ({ data, selected }) as any;

describe('behavior tree runtime nodes', () => {
  it('renders fixed then and else branches with selection state', () => {
    const { container } = render(
      <IfElseNode
        {...nodeProps(
          {
            label: 'Condition',
            variable: 'ready',
            operator: 'truthy',
            status: ExecutionStatus.Running,
          },
          true
        )}
      />
    );
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByText('Then')).toBeInTheDocument();
    expect(screen.getByText('Else')).toBeInTheDocument();
    expect(screen.getByTestId('handle-then')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('selected', 'status-running');
  });

  it('renders timeout and subscriber details', () => {
    const { container } = render(
      <>
        <TimeoutNode {...nodeProps({ label: 'Deadline', timeout: 0 })} />
        <SubscriberNode
          {...nodeProps({
            label: 'Robot state',
            topicName: '/state',
            messageType: 'example/msg/State',
            outputBindings: [{ sourcePath: 'ready', variable: 'ready' }],
          })}
        />
      </>
    );
    expect(screen.getByText('1 ms')).toBeInTheDocument();
    expect(screen.getByText('/state')).toBeInTheDocument();
    expect(screen.getByText('1 mapping(s)')).toBeInTheDocument();
    expect(container.querySelector('.bt-timeout-node')).toHaveClass('status-idle');
  });
});
