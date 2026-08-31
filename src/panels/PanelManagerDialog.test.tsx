import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PanelManagerDialog from './PanelManagerDialog';

const api = vi.hoisted(() => ({
  load: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
}));

vi.mock('./managerApi', async importOriginal => {
  const original = await importOriginal<typeof import('./managerApi')>();
  return {
    ...original,
    loadPanelManagerConfig: api.load,
    previewPanelManagerConfig: api.preview,
    applyPanelManagerPlan: api.apply,
  };
});

const panel = {
  schemaVersion: 1 as const,
  id: 'com.example.telemetry',
  name: 'Telemetry',
  description: 'Robot telemetry.',
  version: '2.0.0',
  entryPoint: 'https://roboboy.test/panels/com.example.telemetry/2.0.0/index.js',
  integrity: 'sha256-awLjC3PnQMe3GqvsLNqbulVO7zysg4XTJoKvBkR3kDk=',
  registryUrl: 'https://roboboy.test/panels/installed.json',
  compatibility: { panelApi: '^2.0.0', roboboy: '*' },
  capabilities: ['ros' as const],
  permissions: { ros: { discover: true, selectTopic: true, subscribe: ['/telemetry/**'] } },
  author: { name: 'Example' },
  repository: 'https://github.com/example/telemetry',
};
const secondPanel = {
  ...panel,
  id: 'com.example.camera',
  name: 'Camera',
};

describe('PanelManagerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.load.mockResolvedValue({
      config: {
        schemaVersion: 2,
        sources: [{ type: 'remote', name: 'official', catalogUrl: 'https://panels.example/catalog.json' }],
        selection: { mode: 'include', panelIds: [panel.id] },
      },
    });
    api.preview.mockResolvedValue({
      planId: 'sha256-plan',
      expiresInSeconds: 600,
      panels: [],
      changes: [{ type: 'remove', panel }],
    });
    api.apply.mockResolvedValue({ installed: 0 });
  });

  it('keeps authentication explicit and previews removals before apply', async () => {
    const onApplied = vi.fn();
    render(<PanelManagerDialog installedPanels={[panel]} onClose={vi.fn()} onApplied={onApplied} />);

    fireEvent.change(screen.getByLabelText('Panel manager token'), { target: { value: 'deployment-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByText('Remote catalog');
    expect(api.load).toHaveBeenCalledWith('deployment-secret');

    fireEvent.click(screen.getByRole('button', { name: 'Plan removal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    await screen.findByText('remove Telemetry@2.0.0');
    expect(api.preview).toHaveBeenCalledWith(
      'deployment-secret',
      expect.objectContaining({ selection: { mode: 'none' } })
    );
    expect(api.apply).not.toHaveBeenCalled();

    const applyButton = screen.getByRole('button', { name: 'Apply this exact plan' });
    expect(applyButton).toBeDisabled();
    fireEvent.click(
      screen.getByLabelText(
        'I reviewed these sources and permissions and trust the selected panels with the granted data.'
      )
    );
    fireEvent.click(applyButton);
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('deployment-secret', 'sha256-plan'));
    expect(onApplied).toHaveBeenCalled();
  });

  it('shows requested permissions in the review', async () => {
    api.preview.mockResolvedValue({
      planId: 'sha256-plan',
      expiresInSeconds: 600,
      panels: [panel],
      changes: [{ type: 'add', panel }],
    });
    render(<PanelManagerDialog installedPanels={[]} onClose={vi.fn()} onApplied={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Panel manager token'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByText('Remote catalog');
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));

    expect(await screen.findByText('discover approved ROS topics')).toBeInTheDocument();
    expect(screen.getByText('ask you to select individual ROS topics')).toBeInTheDocument();
    expect(screen.getByText('subscribe ROS: /telemetry/**')).toBeInTheDocument();
  });

  it('keeps consecutive planned removals instead of restoring an earlier one', async () => {
    api.load.mockResolvedValue({
      config: {
        schemaVersion: 2,
        sources: [{ type: 'remote', name: 'official', catalogUrl: 'https://panels.example/catalog.json' }],
        selection: { mode: 'include', panelIds: [panel.id, secondPanel.id] },
      },
    });
    render(<PanelManagerDialog installedPanels={[panel, secondPanel]} onClose={vi.fn()} onApplied={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Panel manager token'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByText('Remote catalog');

    const removalButtons = screen.getAllByRole('button', { name: 'Plan removal' });
    fireEvent.click(removalButtons[0]);
    fireEvent.click(removalButtons[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));

    await waitFor(() =>
      expect(api.preview).toHaveBeenCalledWith('secret', expect.objectContaining({ selection: { mode: 'none' } }))
    );
  });
});
