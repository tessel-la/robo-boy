import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorNodeType, BehaviorTree } from '../types';
import BehaviorTreeAgentPanel from './BehaviorTreeAgentPanel';

const rosDiscoveryMock = vi.hoisted(() => ({
  discoverAllROSResources: vi.fn(),
  fetchActionGoalDetails: vi.fn(),
  fetchServiceRequestSchema: vi.fn(),
}));

const agentClientMock = vi.hoisted(() => ({
  generateBehaviorTree: vi.fn(),
}));

vi.mock('../services/rosDiscovery', () => rosDiscoveryMock);
vi.mock('../agent/agentClient', () => agentClientMock);

const tree: BehaviorTree = {
  id: 'tree',
  name: 'Mission',
  nodes: [
    { id: 'root', type: BehaviorNodeType.Sequence, position: { x: 0, y: 0 }, data: { label: 'Mission', type: 'sequence' } },
    { id: 'move', type: BehaviorNodeType.Action, position: { x: 0, y: 100 }, data: { label: 'Move', actionName: '/move', actionType: 'robot/action/Move' } },
  ],
  edges: [{ id: 'edge', source: 'root', target: 'move' }],
  createdAt: 1,
  updatedAt: 1,
};

const selection: BehaviorTree = { ...tree, id: 'selection', name: 'Selection', nodes: [tree.nodes[1]], edges: [] };

describe('BehaviorTreeAgentPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    rosDiscoveryMock.discoverAllROSResources.mockResolvedValue({ actions: [], services: [], topics: [] });
    rosDiscoveryMock.fetchActionGoalDetails.mockResolvedValue(null);
    rosDiscoveryMock.fetchServiceRequestSchema.mockResolvedValue(null);
    agentClientMock.generateBehaviorTree.mockResolvedValue(JSON.stringify({
      name: 'Generated',
      nodes: [{ id: 'root', type: 'sequence', label: 'Generated root' }],
      edges: [],
    }));
  });

  it('shows explicit full-tree, selected-part, combined, and no-context choices', () => {
    render(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={selection} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Full \+ selection/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Using the full 2-node tree, with 1 selected node called out as the edit focus.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Full BT/ }));
    expect(screen.getByRole('button', { name: /Full BT/ })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Selection/ }));
    expect(screen.getByText('Using only the 1 selected node and its internal connections.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'No BT' }));
    expect(screen.getByRole('button', { name: 'No BT' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('No behavior-tree structure will be sent. The agent will use only your text, robot context, and scanned ROS resources.')).toBeInTheDocument();
  });

  it('does not reset no-context mode when selection changes while open', () => {
    const { rerender } = render(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={null} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'No BT' }));
    rerender(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={selection} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'No BT' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps generation locked without a discovered action or service', () => {
    render(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={null} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Move forward' } });
    expect(screen.getByRole('button', { name: 'Generate tree' })).toBeDisabled();
    expect(screen.getByText('Scan at least one action or service to continue.')).toBeInTheDocument();
  });

  it('keeps proposal decisions on the canvas controls', () => {
    render(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={null} previewTree={tree} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    expect(screen.getByText('Preview active on canvas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept replacement' })).not.toBeInTheDocument();
  });

  it('discovers ROS resources, generates a preview, and sends combined tree context', async () => {
    const onPreviewChange = vi.fn();
    rosDiscoveryMock.discoverAllROSResources.mockResolvedValue({
      actions: [{ name: '/move', type: 'robot/action/Move', namespace: '/move' }],
      services: [{ name: '/capture', type: 'camera/srv/Capture' }],
      topics: [{ name: '/image', type: 'sensor_msgs/msg/Image' }],
    });
    rosDiscoveryMock.fetchActionGoalDetails.mockResolvedValueOnce({
      fields: [],
      defaults: { x: 0, y: 0 },
    });
    rosDiscoveryMock.fetchServiceRequestSchema.mockResolvedValueOnce({
      fields: [],
      defaults: { quality: 80 },
    });
    agentClientMock.generateBehaviorTree.mockImplementation(async (request: any) => {
      request.onProgress('mock thinking');
      request.onToken('{"name":"Generated"');
      return JSON.stringify({
        name: 'Generated',
        description: 'Ready to preview',
        nodes: [
          { id: 'root', type: 'sequence', label: 'Generated root' },
          { id: 'move', type: 'action', label: 'Move', config: { actionName: '/move', actionType: 'robot/action/Move', parameters: { x: 1 } } },
        ],
        edges: [{ source: 'root', target: 'move' }],
      });
    });

    render(<BehaviorTreeAgentPanel open ros={{} as any} isConnected currentTree={tree} selectedTreeContext={selection} previewTree={null} onClose={vi.fn()} onPreviewChange={onPreviewChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Scan ROS actions' }));
    await screen.findByText('3 resources · 2 input schemas');

    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Move forward' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tree' }));

    await waitFor(() => expect(onPreviewChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'Generated' })));
    expect(agentClientMock.generateBehaviorTree).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ includeCurrentTree: true }),
      treeContext: expect.objectContaining({
        mode: 'open-and-selection',
        openTree: expect.objectContaining({ id: 'tree' }),
        selectedTree: expect.objectContaining({ id: 'selection' }),
      }),
      resourceSchemas: {
        actions: { 'robot/action/Move': { fields: [], defaults: { x: 0, y: 0 } } },
        services: { 'camera/srv/Capture': { fields: [], defaults: { quality: 80 } } },
      },
    }));
    expect(screen.getByText('mock thinking')).toBeInTheDocument();
    expect(screen.getByText('Built “Generated” with complete action inputs.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(onPreviewChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByLabelText('Describe the behavior')).toHaveValue('');
  });

  it('allows generation with no behavior-tree context selected', async () => {
    rosDiscoveryMock.discoverAllROSResources.mockResolvedValue({
      actions: [{ name: '/move', type: 'robot/action/Move', namespace: '/move' }],
      services: [],
      topics: [],
    });

    render(<BehaviorTreeAgentPanel open ros={{} as any} isConnected currentTree={tree} selectedTreeContext={selection} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'No BT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scan ROS actions' }));
    await screen.findByText('1 resources · 0 input schemas');
    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Make a fresh tree' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tree' }));

    await waitFor(() => expect(agentClientMock.generateBehaviorTree).toHaveBeenCalled());
    expect(agentClientMock.generateBehaviorTree.mock.calls[0][0]).toMatchObject({
      currentTree: null,
      treeContext: null,
      settings: expect.objectContaining({ includeCurrentTree: false }),
    });
  });

  it('handles clarification responses with suggestions and continuing conversation', async () => {
    rosDiscoveryMock.discoverAllROSResources.mockResolvedValue({
      actions: [{ name: '/move', type: 'robot/action/Move', namespace: '/move' }],
      services: [],
      topics: [],
    });
    agentClientMock.generateBehaviorTree.mockResolvedValueOnce(JSON.stringify({
      kind: 'clarification',
      question: 'Which frame should I use?',
      missing: ['frame'],
      suggestions: ['Use base_link', 'Use map'],
    }));

    render(<BehaviorTreeAgentPanel open ros={{} as any} isConnected currentTree={tree} selectedTreeContext={null} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Scan ROS actions' }));
    await screen.findByText('1 resources · 0 input schemas');
    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Move somewhere' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tree' }));

    expect(await screen.findByText('Which frame should I use?')).toBeInTheDocument();
    expect(screen.getByLabelText('Your answer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use base_link' }));
    expect(screen.getByLabelText('Your answer')).toHaveValue('Use base_link');
  });

  it('surfaces discovery and provider validation errors', async () => {
    rosDiscoveryMock.discoverAllROSResources.mockRejectedValue(new Error('ROS unavailable'));

    render(<BehaviorTreeAgentPanel open ros={{} as any} isConnected currentTree={tree} selectedTreeContext={null} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Scan ROS actions' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ROS unavailable');

    fireEvent.click(screen.getByRole('button', { name: /Provider settings/ }));
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: '' } });
    rosDiscoveryMock.discoverAllROSResources.mockResolvedValue({
      actions: [{ name: '/move', type: 'robot/action/Move', namespace: '/move' }],
      services: [],
      topics: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Scan ROS actions' }));
    await screen.findByText('1 resources · 0 input schemas');
    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Move' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tree' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Set both a base URL and model before generating.');
  });

  it('updates provider defaults, requires cloud API keys, and closes from escape', async () => {
    const onClose = vi.fn();
    rosDiscoveryMock.discoverAllROSResources.mockResolvedValue({
      actions: [{ name: '/move', type: 'robot/action/Move', namespace: '/move' }],
      services: [],
      topics: [],
    });

    render(<BehaviorTreeAgentPanel open ros={{} as any} isConnected currentTree={tree} selectedTreeContext={null} previewTree={tree} onClose={onClose} onPreviewChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Provider settings/ }));
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1');
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-4.1-mini');

    fireEvent.click(screen.getByRole('button', { name: 'Scan ROS actions' }));
    await screen.findByText('1 resources · 0 input schemas');
    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Move' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tree' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add an API key for openai before generating.');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
