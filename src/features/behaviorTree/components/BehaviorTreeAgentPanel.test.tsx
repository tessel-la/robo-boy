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

  it('builds removable automatic context from the open tree, selection, and ROS', () => {
    render(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={selection} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    const composer = screen.getByLabelText('Describe the behavior').closest('.bt-agent-composer');
    expect(composer).toHaveTextContent('BT: Mission');
    expect(composer).toHaveTextContent('1 selected');
    expect(composer).toHaveTextContent('ROS');
    expect(document.querySelector('.bt-agent-context-row')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove BT: Mission from context' }));
    expect(screen.queryByText('BT: Mission')).not.toBeInTheDocument();
  });

  it('allows generation before resources have been discovered', () => {
    render(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={null} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Move forward' } });
    expect(screen.getByRole('button', { name: 'Generate tree' })).toBeEnabled();
    expect(screen.getByText('ROS')).toBeInTheDocument();
    expect(document.querySelector('.bt-agent-context-row')).not.toBeInTheDocument();
  });

  it('offers voice input for instructions, mission context, and behavior description', () => {
    render(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={null} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Start voice input for Describe the behavior' })).toBeInTheDocument();
    expect(document.querySelector('.bt-agent-composer-heading label')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Agent settings' }));
    expect(screen.getByRole('dialog', { name: 'Agent settings' }).closest('.bt-agent-body')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start voice input for Agent instructions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start voice input for Robot / mission context' })).toBeInTheDocument();
  });

  it('renders desktop resize handles without changing the canvas layout', () => {
    render(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={null} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    expect(screen.getAllByRole('separator', { name: /Resize AI agent/ })).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument();
  });

  it('keeps proposal decisions on the canvas controls', () => {
    render(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={null} previewTree={tree} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    expect(screen.queryByText('Preview active on canvas')).not.toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Move forward' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tree' }));

    await waitFor(() => expect(onPreviewChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'Generated' })));
    expect(rosDiscoveryMock.discoverAllROSResources).toHaveBeenCalledOnce();
    expect(screen.getByText('ROS: 3')).toBeInTheDocument();
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
    expect(screen.getByText('Built “Generated” with complete action inputs.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(onPreviewChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByLabelText('Describe the behavior')).toHaveValue('');
  });

  it('allows all automatic context to be removed', async () => {
    rosDiscoveryMock.discoverAllROSResources.mockResolvedValue({
      actions: [{ name: '/move', type: 'robot/action/Move', namespace: '/move' }],
      services: [],
      topics: [],
    });

    render(<BehaviorTreeAgentPanel open ros={{} as any} isConnected currentTree={tree} selectedTreeContext={selection} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove BT: Mission from context' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove 1 selected from context' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove ROS from context' }));
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

    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Move' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tree' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ROS unavailable');

    fireEvent.click(screen.getByRole('button', { name: /Agent settings/ }));
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Continue the conversation'), { target: { value: 'Try again' } });
    rosDiscoveryMock.discoverAllROSResources.mockResolvedValue({
      actions: [{ name: '/move', type: 'robot/action/Move', namespace: '/move' }],
      services: [],
      topics: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tree' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Set both a base URL and model before generating.'));
  });

  it('updates provider defaults, requires cloud API keys, and closes from escape', async () => {
    const onClose = vi.fn();
    rosDiscoveryMock.discoverAllROSResources.mockResolvedValue({
      actions: [{ name: '/move', type: 'robot/action/Move', namespace: '/move' }],
      services: [],
      topics: [],
    });

    render(<BehaviorTreeAgentPanel open ros={{} as any} isConnected currentTree={tree} selectedTreeContext={null} previewTree={tree} onClose={onClose} onPreviewChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Agent settings/ }));
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1');
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-4.1-mini');
    expect(screen.queryByLabelText('Speech model')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Move' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tree' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add an API key for openai before generating.');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('runs an inline instruction in the background without opening the panel', async () => {
    const onPreviewChange = vi.fn();
    const onInlineClose = vi.fn();
    const onNotify = vi.fn();
    render(
      <BehaviorTreeAgentPanel
        open={false}
        ros={{} as any}
        isConnected
        currentTree={tree}
        selectedTreeContext={selection}
        previewTree={null}
        inlinePosition={{ left: 10, top: 10, width: 300 }}
        onInlineClose={onInlineClose}
        onClose={vi.fn()}
        onPreviewChange={onPreviewChange}
        onNotify={onNotify}
      />
    );

    fireEvent.change(screen.getByLabelText('Inline AI instruction'), { target: { value: 'Add a stop action' } });
    fireEvent.submit(screen.getByTestId('bt-agent-inline-prompt'));

    expect(onInlineClose).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('bt-agent-panel')).not.toBeInTheDocument();
    await waitFor(() => expect(onPreviewChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'Generated' })));
    expect(rosDiscoveryMock.discoverAllROSResources).toHaveBeenCalledOnce();
    expect(onNotify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'AI tree ready',
      message: expect.stringContaining('0 ROS resources'),
    }));
  });

  it('keeps an active generation running after the agent panel closes', async () => {
    let finishGeneration: ((value: string) => void) | undefined;
    agentClientMock.generateBehaviorTree.mockImplementationOnce(() => new Promise(resolve => {
      finishGeneration = resolve;
    }));
    const onPreviewChange = vi.fn();
    const { rerender } = render(
      <BehaviorTreeAgentPanel open ros={{} as any} isConnected currentTree={tree} selectedTreeContext={null} previewTree={null} onClose={vi.fn()} onPreviewChange={onPreviewChange} />
    );

    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Wait for completion' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tree' }));
    await waitFor(() => expect(agentClientMock.generateBehaviorTree).toHaveBeenCalledOnce());

    rerender(
      <BehaviorTreeAgentPanel open={false} ros={{} as any} isConnected currentTree={tree} selectedTreeContext={null} previewTree={null} onClose={vi.fn()} onPreviewChange={onPreviewChange} />
    );
    expect(screen.queryByTestId('bt-agent-panel')).not.toBeInTheDocument();

    finishGeneration?.(JSON.stringify({
      name: 'Background result',
      nodes: [{ id: 'root', type: 'sequence', label: 'Background root' }],
      edges: [],
    }));
    await waitFor(() => expect(onPreviewChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'Background result' })));
  });

  it('persists agent instructions and robot context between panel mounts', () => {
    const props = { ros: null, isConnected: false, currentTree: tree, selectedTreeContext: null, previewTree: null, onClose: vi.fn(), onPreviewChange: vi.fn() };
    const { unmount } = render(<BehaviorTreeAgentPanel open {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /Agent settings/ }));
    fireEvent.change(screen.getByLabelText('Agent instructions'), { target: { value: 'Prefer recovery branches.' } });
    fireEvent.change(screen.getByLabelText('Robot / mission context'), { target: { value: 'Indoor delivery robot.' } });
    unmount();

    render(<BehaviorTreeAgentPanel open {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Agent settings/ }));
    expect(screen.getByLabelText('Agent instructions')).toHaveValue('Prefer recovery branches.');
    expect(screen.getByLabelText('Robot / mission context')).toHaveValue('Indoor delivery robot.');
  });

  it('attaches text and image files in the composer and sends them with the prompt', async () => {
    render(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={null} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    const textFile = new File(['max_velocity: 0.4'], 'mission.yaml', { type: 'application/yaml', lastModified: 1 });
    const imageFile = new File(['image-data'], 'map.png', { type: 'image/png', lastModified: 2 });
    fireEvent.change(screen.getByLabelText('AI agent attachments'), { target: { files: [textFile, imageFile] } });

    expect(await screen.findByText('mission.yaml')).toBeInTheDocument();
    expect(screen.getByText('map.png')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Use these mission files' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tree' }));

    await waitFor(() => expect(agentClientMock.generateBehaviorTree).toHaveBeenCalled());
    expect(agentClientMock.generateBehaviorTree).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [
        expect.objectContaining({ name: 'mission.yaml', kind: 'text', content: 'max_velocity: 0.4' }),
        expect.objectContaining({ name: 'map.png', kind: 'image' }),
      ],
    }));
    expect(screen.getByLabelText('Continue the conversation').closest('.bt-agent-composer')).not.toHaveTextContent('mission.yaml');
  });

  it('rejects unsupported and oversized attachments without losing the prompt', async () => {
    render(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={null} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Keep this instruction' } });
    const unsupported = new File(['binary'], 'mission.pdf', { type: 'application/pdf' });

    fireEvent.change(screen.getByLabelText('AI agent attachments'), { target: { files: [unsupported] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('not a supported');
    expect(screen.getByLabelText('Describe the behavior')).toHaveValue('Keep this instruction');
  });

  it('repeats a command and rewinds both chat and BT checkpoints', async () => {
    const checkpoint = { tree, activeTree: tree, path: [] };
    const restoreCheckpoint = vi.fn();
    render(
      <BehaviorTreeAgentPanel
        open
        ros={{} as any}
        isConnected
        currentTree={tree}
        selectedTreeContext={null}
        previewTree={null}
        onClose={vi.fn()}
        onPreviewChange={vi.fn()}
        captureCheckpoint={() => checkpoint}
        onRestoreCheckpoint={restoreCheckpoint}
      />
    );

    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Inspect the dock' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tree' }));
    await screen.findByText('Built “Generated” with complete action inputs.');

    fireEvent.click(screen.getAllByRole('button', { name: 'Repeat' })[0]);
    await waitFor(() => expect(agentClientMock.generateBehaviorTree).toHaveBeenCalledTimes(2));
    expect(rosDiscoveryMock.discoverAllROSResources).toHaveBeenCalledTimes(2);
    expect(restoreCheckpoint).toHaveBeenCalledWith(checkpoint);

    await screen.findByText('Built “Generated” with complete action inputs.');
    const goBackButtons = screen.getAllByRole('button', { name: 'Go back here' });
    fireEvent.click(goBackButtons[goBackButtons.length - 1]);
    expect(restoreCheckpoint).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Built “Generated” with complete action inputs.')).not.toBeInTheDocument();
  });

  it('adds nodes as explicit context tags and closes the picker outside', async () => {
    render(<BehaviorTreeAgentPanel open ros={{} as any} isConnected currentTree={tree} selectedTreeContext={null} previewTree={null} onClose={vi.fn()} onPreviewChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add agent context' }));
    expect(screen.getByRole('dialog', { name: 'Add context' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Add context' })).toHaveAttribute('aria-busy', 'false'));
    fireEvent.click(await screen.findByRole('button', { name: /Move Current BT node/ }));
    expect(screen.getByText('Node: Move')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add agent context' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Add context' })).toHaveAttribute('aria-busy', 'false'));
    fireEvent.pointerDown(screen.getByRole('button', { name: /Agent settings/ }));
    expect(screen.queryByRole('dialog', { name: 'Add context' })).not.toBeInTheDocument();
  });
});
