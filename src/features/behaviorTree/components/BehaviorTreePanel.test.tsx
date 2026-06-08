import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BehaviorTreePanel from './BehaviorTreePanel';

const reactFlowMock = vi.hoisted(() => ({
  render: vi.fn(),
}));

const roslibMock = vi.hoisted(() => ({
  topic: vi.fn(),
  publish: vi.fn(),
}));

const createRosMock = (topics: string[] = []) => ({
  getServices: (success: (services: string[]) => void) => success([]),
  getTopics: (success: (result: { topics: string[]; types: string[] }) => void) =>
    success({ topics, types: topics.map(() => 'std_msgs/msg/String') }),
  getServiceType: (_service: string, success: (type: string) => void) => success(''),
});

vi.mock('roslib', () => ({
  default: {
    Topic: vi.fn().mockImplementation(function Topic(options) {
      roslibMock.topic(options);
      return {
        advertise: vi.fn(),
        publish: roslibMock.publish,
        unadvertise: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      };
    }),
    Message: vi.fn().mockImplementation(function Message(payload) {
      return payload;
    }),
  },
}));

vi.mock('reactflow', () => ({
  default: (props: { children?: React.ReactNode }) => {
    reactFlowMock.render(props);
    return <div data-testid="mock-react-flow">{props.children}</div>;
  },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  BackgroundVariant: { Dots: 'dots' },
  ConnectionMode: { Loose: 'loose' },
  addEdge: vi.fn((_edge, edges) => edges),
  useNodesState: () => [[], vi.fn(), vi.fn()],
  useEdgesState: () => [[], vi.fn(), vi.fn()],
  useReactFlow: () => ({
    screenToFlowPosition: (position: { x: number; y: number }) => position,
    deleteElements: vi.fn(),
  }),
}));

describe('BehaviorTreePanel', () => {
  beforeEach(() => {
    reactFlowMock.render.mockClear();
    roslibMock.topic.mockClear();
    roslibMock.publish.mockClear();
  });

  it('does not open the node palette until the user toggles it', () => {
    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);

    expect(screen.queryByTestId('bt-node-palette')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bt-palette-toggle'));

    expect(screen.getByTestId('bt-node-palette')).toBeInTheDocument();
  });

  it('uses a touch-friendly connection radius', () => {
    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);

    expect(reactFlowMock.render).toHaveBeenCalledWith(
      expect.objectContaining({ connectionRadius: 48 })
    );
  });

  it('uses the shared toolbar run and stop controls for external engines', async () => {
    render(
      <BehaviorTreePanel
        ros={createRosMock(['/arm_1/behavior_tree/runtime/capabilities']) as any}
        isConnected
        isActive
      />
    );

    fireEvent.change(screen.getByLabelText('Behavior tree engine'), {
      target: { value: 'py_trees' },
    });
    expect(await screen.findByDisplayValue('arm_1')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Execute tree'));

    expect(await screen.findByTitle('Stop execution')).toBeInTheDocument();
    expect(roslibMock.topic).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '/arm_1/behavior_tree/runtime/command',
      })
    );
    expect(roslibMock.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.stringContaining('"command":"load_and_run"'),
      })
    );

    fireEvent.click(screen.getByTitle('Stop execution'));

    expect(roslibMock.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.stringContaining('"command":"stop"'),
      })
    );
  });

  it('does not enter external execution mode when ROS is offline', async () => {
    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);

    fireEvent.change(screen.getByLabelText('Behavior tree engine'), {
      target: { value: 'py_trees' },
    });
    fireEvent.click(screen.getByTitle('Execute tree'));

    expect(await screen.findByText('Runtime offline')).toBeInTheDocument();
    expect(screen.queryByTitle('Stop execution')).not.toBeInTheDocument();
    expect(roslibMock.publish).not.toHaveBeenCalled();
  });
});
