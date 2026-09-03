import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelSandboxToHostMessage } from './sandboxProtocol';
import ExternalPanelHost from './ExternalPanelHost';
import type { ResolvedPanelManifest } from './types';

const broker = vi.hoisted(() => ({
  connect: vi.fn(),
  onMessage: undefined as ((message: PanelSandboxToHostMessage) => void) | undefined,
  cleanup: vi.fn(),
}));

vi.mock('./capabilityBroker', () => ({
  connectPanelCapabilityBroker: vi.fn((_port, _options, onMessage) => {
    broker.onMessage = onMessage;
    broker.connect(_port, _options);
    return broker.cleanup;
  }),
  getGrantedPanelEndpoints: vi.fn(() => ({})),
}));

class FakePort {
  postMessage = vi.fn();
  close = vi.fn();
  start = vi.fn();
  onmessage: ((event: MessageEvent) => void) | null = null;
}

class FakeMessageChannel {
  port1 = new FakePort();
  port2 = new FakePort();
}

const manifest: ResolvedPanelManifest = {
  schemaVersion: 1,
  id: 'com.example.panel',
  name: 'Example panel',
  description: 'An example.',
  version: '2.0.0',
  entryPoint: 'https://roboboy.test/panels/example/2.0.0/index.js',
  integrity: 'sha256-awLjC3PnQMe3GqvsLNqbulVO7zysg4XTJoKvBkR3kDk=',
  registryUrl: 'https://roboboy.test/panels/installed.json',
  compatibility: { panelApi: '^2.0.0', roboboy: '*' },
  capabilities: ['ros', 'storage'],
  permissions: { ros: { discover: true, subscribe: ['/telemetry/**'] } },
  author: { name: 'Example' },
  repository: 'https://github.com/example/panel',
};

const renderHost = (overrides: Partial<React.ComponentProps<typeof ExternalPanelHost>> = {}) => {
  const onStateChange = vi.fn();
  const sourceLoader = vi.fn().mockResolvedValue('export default {};');
  const props: React.ComponentProps<typeof ExternalPanelHost> = {
    manifest,
    instanceId: 'panel-instance',
    ros: {} as never,
    connectionStatus: 'connected',
    connectionGeneration: 1,
    runtime: { target: 'web', endpoints: { videoStream: 'https://robot.test/stream' } },
    isActive: true,
    state: { count: 2 },
    onStateChange,
    sourceLoader,
    ...overrides,
  };
  const result = render(<ExternalPanelHost {...props} />);
  return { ...result, onStateChange, props, sourceLoader };
};

const announceSandboxReady = (iframe: HTMLIFrameElement, sessionId = 'sandbox-session-1', origin = 'null') => {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'roboboy-panel-sandbox-ready', sessionId },
      origin,
      source: iframe.contentWindow,
    })
  );
};

describe('ExternalPanelHost sandbox', () => {
  beforeEach(() => {
    broker.connect.mockClear();
    broker.cleanup.mockClear();
    broker.onMessage = undefined;
    vi.stubGlobal('MessageChannel', FakeMessageChannel);
  });

  it('uses an opaque-origin iframe and sends only the capability-scoped initialization', async () => {
    const { container, sourceLoader } = renderHost();
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-downloads allow-forms');
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin');
    // Loaded from its own URL rather than srcdoc, so it does not inherit the host page's CSP.
    expect(iframe?.getAttribute('srcdoc')).toBeNull();
    const sandboxSrc = new URL(iframe!.getAttribute('src')!, document.baseURI);
    expect(sandboxSrc.pathname).toContain('panel-sandbox.html');
    expect(sandboxSrc.searchParams.get('parentOrigin')).toBe(window.location.origin);
    expect(sourceLoader).not.toHaveBeenCalled();

    announceSandboxReady(iframe!);
    await waitFor(() => expect(sourceLoader).toHaveBeenCalledWith(manifest));
    await waitFor(() => {
      const port = broker.connect.mock.calls[0][0] as FakePort;
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'initialize',
          value: expect.objectContaining({
            panelId: manifest.id,
            capabilities: ['ros', 'storage'],
            runtime: { target: 'web' },
            endpoints: {},
            theme: expect.objectContaining({ colorScheme: expect.any(String), tokens: expect.any(Object) }),
            storage: expect.objectContaining({ values: { count: 2 } }),
          }),
        })
      );
    });
    expect(container.textContent).not.toContain('export default');
  });

  it('rejects sandbox-ready messages that do not come from the opaque iframe origin', async () => {
    const { container, sourceLoader } = renderHost();
    const iframe = container.querySelector('iframe')!;

    announceSandboxReady(iframe, 'spoofed-session', 'https://attacker.test');
    await Promise.resolve();
    expect(sourceLoader).not.toHaveBeenCalled();

    announceSandboxReady(iframe);
    await waitFor(() => expect(sourceLoader).toHaveBeenCalledWith(manifest));
  });

  it('accepts valid storage updates from the private broker and rejects invalid state', () => {
    const { container, onStateChange } = renderHost();
    announceSandboxReady(container.querySelector('iframe')!);

    broker.onMessage?.({ type: 'storage', values: { count: 3 } });
    expect(onStateChange).toHaveBeenCalledWith({ count: 3 });

    broker.onMessage?.({ type: 'storage', values: { invalid: Number.NaN } as never });
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  it('shows isolated sandbox failures and creates a fresh sandbox on retry', async () => {
    const { container } = renderHost();
    announceSandboxReady(container.querySelector('iframe')!);
    act(() => broker.onMessage?.({ type: 'error', message: 'render failed' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('render failed');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    const nextIframe = container.querySelector('iframe');
    announceSandboxReady(nextIframe!);
    expect(broker.cleanup).toHaveBeenCalled();
  });

  it('removes the loading overlay only after the sandbox reports ready', async () => {
    const { container } = renderHost();
    expect(screen.getByRole('status')).toHaveTextContent('Loading Example panel');
    announceSandboxReady(container.querySelector('iframe')!);
    act(() => broker.onMessage?.({ type: 'ready' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('reports an error when the sandbox never announces itself, instead of loading forever', async () => {
    vi.useFakeTimers();
    try {
      renderHost();
      expect(screen.getByRole('status')).toHaveTextContent('Loading Example panel');

      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });

      expect(screen.getByRole('alert')).toHaveTextContent('The panel sandbox did not start.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not return to loading when equivalent manifest metadata is recreated', async () => {
    const { container, props, rerender } = renderHost();
    announceSandboxReady(container.querySelector('iframe')!);
    act(() => broker.onMessage?.({ type: 'ready' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    rerender(<ExternalPanelHost {...props} manifest={{ ...manifest }} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reconnects when browser reordering reloads the iframe document', async () => {
    const { container } = renderHost();
    const iframe = container.querySelector('iframe')!;
    announceSandboxReady(iframe, 'sandbox-session-1');
    act(() => broker.onMessage?.({ type: 'ready' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    act(() => announceSandboxReady(iframe, 'sandbox-session-2'));

    expect(await screen.findByRole('status')).toHaveTextContent('Loading Example panel');
    expect(broker.connect).toHaveBeenCalledTimes(2);
    act(() => broker.onMessage?.({ type: 'ready' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('uses a trusted host picker to approve one ROS topic', async () => {
    const selectableManifest: ResolvedPanelManifest = {
      ...manifest,
      permissions: { ros: { selectTopic: true } },
    };
    const { container } = renderHost({ manifest: selectableManifest });
    announceSandboxReady(container.querySelector('iframe')!);
    await waitFor(() => expect(broker.connect).toHaveBeenCalled());
    const brokerOptions = broker.connect.mock.calls[0][1] as {
      requestRosTopicSelection(topics: Array<{ name: string; messageType: string }>): Promise<{
        name: string;
        messageType: string;
      }>;
    };
    const selection = brokerOptions.requestRosTopicSelection([
      { name: '/diagnostics', messageType: 'diagnostic_msgs/msg/DiagnosticArray' },
      { name: '/joint_states', messageType: 'sensor_msgs/msg/JointState' },
    ]);

    expect(await screen.findByRole('dialog', { name: 'Choose ROS topic' })).toHaveTextContent(
      'The panel receives only the topic and message type you approve here.'
    );
    fireEvent.change(screen.getByLabelText('Available topics'), { target: { value: '/joint_states' } });
    fireEvent.click(screen.getByRole('button', { name: 'Allow selected topic' }));

    await expect(selection).resolves.toEqual({
      name: '/joint_states',
      messageType: 'sensor_msgs/msg/JointState',
    });
    expect(screen.queryByRole('dialog', { name: 'Choose ROS topic' })).not.toBeInTheDocument();
  });

  it('restores host-owned topic grants and reports newly approved topics', async () => {
    const onApprovedRosTopicsChange = vi.fn();
    const approvedRosTopics = [{ name: '/joint_states', messageType: 'sensor_msgs/msg/JointState' }];
    const { container } = renderHost({ approvedRosTopics, onApprovedRosTopicsChange });
    announceSandboxReady(container.querySelector('iframe')!);
    await waitFor(() => expect(broker.connect).toHaveBeenCalled());

    const brokerOptions = broker.connect.mock.calls[0][1] as {
      userSelectedRosTopics: Map<string, string>;
      onRosTopicSelected(topic: { name: string; messageType: string }): void;
    };
    expect(brokerOptions.userSelectedRosTopics).toEqual(new Map([['/joint_states', 'sensor_msgs/msg/JointState']]));

    brokerOptions.userSelectedRosTopics.set('/joy', 'sensor_msgs/msg/Joy');
    brokerOptions.onRosTopicSelected({ name: '/joy', messageType: 'sensor_msgs/msg/Joy' });
    expect(onApprovedRosTopicsChange).toHaveBeenCalledWith([
      { name: '/joint_states', messageType: 'sensor_msgs/msg/JointState' },
      { name: '/joy', messageType: 'sensor_msgs/msg/Joy' },
    ]);
  });
});
