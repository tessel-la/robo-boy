import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFICIAL_PANEL_SOURCE } from './constants';
import PanelManagerDialog from './PanelManagerDialog';
import type { AvailablePanel } from './useInstalledPanels';

const availableFrom = (panels: { id: string }[]): AvailablePanel[] =>
  panels.map(manifest => ({ manifest, origin: 'installed', isEnabled: true }) as AvailablePanel);

const api = vi.hoisted(() => ({
  status: vi.fn(),
  load: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
  catalog: vi.fn(),
}));

vi.mock('./managerApi', async importOriginal => {
  const original = await importOriginal<typeof import('./managerApi')>();
  return {
    ...original,
    fetchPanelManagerStatus: api.status,
    loadPanelManagerConfig: api.load,
    previewPanelManagerConfig: api.preview,
    applyPanelManagerPlan: api.apply,
    listPanelCatalog: api.catalog,
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
    window.localStorage.clear();
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
    api.catalog.mockResolvedValue({ panels: [] });
    // A deployment without a configured token asks nothing of the user.
    api.status.mockResolvedValue({ authenticationRequired: false });
  });

  it('keeps authentication explicit and previews removals before apply', async () => {
    const onApplied = vi.fn();
    render(
      <PanelManagerDialog
        installedPanels={[panel]}
        availablePanels={availableFrom([panel])}
        onPanelEnabledChange={vi.fn()}
        onClose={vi.fn()}
        onApplied={onApplied}
      />
    );

    await screen.findByText('Remote catalog');
    expect(api.load).toHaveBeenCalledWith('');

    // Removing from the panel list previews the change straight away.
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByText('remove Telemetry@2.0.0');
    expect(api.preview).toHaveBeenCalledWith(
      '',
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
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('', 'sha256-plan'));
    expect(onApplied).toHaveBeenCalled();
  });

  it('shows requested permissions in the review', async () => {
    api.preview.mockResolvedValue({
      planId: 'sha256-plan',
      expiresInSeconds: 600,
      panels: [panel],
      changes: [{ type: 'add', panel }],
    });
    render(
      <PanelManagerDialog
        installedPanels={[]}
        availablePanels={availableFrom([])}
        onPanelEnabledChange={vi.fn()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );

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
    render(
      <PanelManagerDialog
        installedPanels={[panel, secondPanel]}
        availablePanels={availableFrom([panel, secondPanel])}
        onPanelEnabledChange={vi.fn()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );
    await screen.findByText('Remote catalog');

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(1));
    // The first panel now reads "Keep", so this is the second one.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);

    await waitFor(() =>
      expect(api.preview).toHaveBeenCalledWith('', expect.objectContaining({ selection: { mode: 'none' } }))
    );
  });

  it('splits panel IDs typed with spaces, not just commas or newlines', async () => {
    render(
      <PanelManagerDialog
        installedPanels={[panel]}
        availablePanels={availableFrom([panel])}
        onPanelEnabledChange={vi.fn()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );

    await screen.findByText('Remote catalog');

    fireEvent.change(screen.getByLabelText('Panel IDs'), {
      target: { value: 'com.example.telemetry com.example.camera' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));

    await waitFor(() =>
      expect(api.preview).toHaveBeenCalledWith(
        '',
        expect.objectContaining({
          selection: { mode: 'include', panelIds: ['com.example.telemetry', 'com.example.camera'] },
        })
      )
    );
  });

  it('installs an official catalog panel with Install, confirm, and Apply', async () => {
    const officialSummary = {
      id: 'la.tessel.roboboy.timeseries',
      name: 'ROS Time Series',
      description: 'Plots ROS numeric fields.',
      version: '1.0.0',
    };
    const timeseriesPanel = {
      ...panel,
      id: officialSummary.id,
      name: officialSummary.name,
      version: officialSummary.version,
    };
    api.catalog.mockResolvedValue({ panels: [officialSummary] });
    api.preview.mockResolvedValue({
      planId: 'sha256-plan',
      expiresInSeconds: 600,
      panels: [timeseriesPanel],
      changes: [{ type: 'add', panel: timeseriesPanel }],
    });
    render(
      <PanelManagerDialog
        installedPanels={[]}
        availablePanels={availableFrom([])}
        onPanelEnabledChange={vi.fn()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );

    await screen.findByText('ROS Time Series');

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() =>
      expect(api.preview).toHaveBeenCalledWith(
        '',
        expect.objectContaining({
          sources: expect.arrayContaining([expect.objectContaining({ catalogUrl: OFFICIAL_PANEL_SOURCE.catalogUrl })]),
          selection: { mode: 'include', panelIds: [panel.id, officialSummary.id] },
        })
      )
    );

    await screen.findByText('add ROS Time Series@1.0.0');
    fireEvent.click(
      screen.getByLabelText(
        'I reviewed these sources and permissions and trust the selected panels with the granted data.'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply this exact plan' }));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith('', 'sha256-plan'));
  });

  it('removes an official catalog panel with Remove, confirm, and Apply', async () => {
    const officialSummary = {
      id: 'la.tessel.roboboy.timeseries',
      name: 'ROS Time Series',
      description: 'Plots ROS numeric fields.',
      version: '1.0.0',
    };
    const timeseriesPanel = { ...panel, id: officialSummary.id, name: officialSummary.name };
    api.catalog.mockResolvedValue({ panels: [officialSummary] });
    api.load.mockResolvedValue({
      config: {
        schemaVersion: 2,
        sources: [{ type: 'remote', name: 'official', catalogUrl: OFFICIAL_PANEL_SOURCE.catalogUrl }],
        selection: { mode: 'include', panelIds: [officialSummary.id] },
      },
    });
    api.preview.mockResolvedValue({
      planId: 'sha256-plan',
      expiresInSeconds: 600,
      panels: [],
      changes: [{ type: 'remove', panel: timeseriesPanel }],
    });
    render(
      <PanelManagerDialog
        installedPanels={[timeseriesPanel]}
        availablePanels={availableFrom([timeseriesPanel])}
        onPanelEnabledChange={vi.fn()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );

    await screen.findByText('ROS Time Series');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(api.preview).toHaveBeenCalledWith('', expect.objectContaining({ selection: { mode: 'none' } }))
    );
  });

  it('offers a bundled panel a switch but never a removal', async () => {
    const onPanelEnabledChange = vi.fn();
    render(
      <PanelManagerDialog
        installedPanels={[]}
        availablePanels={[{ manifest: panel, origin: 'bundled', isEnabled: true } as AvailablePanel]}
        onPanelEnabledChange={onPanelEnabledChange}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );
    await screen.findByText('Remote catalog');

    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));

    expect(onPanelEnabledChange).toHaveBeenCalledWith('com.example.telemetry', false);
  });

  it('never reports a panel the app can already run as not installed', async () => {
    // The catalog offers it and the build already ships it: it must not invite an install.
    api.catalog.mockResolvedValue({
      panels: [{ id: panel.id, name: panel.name, description: 'Robot telemetry.', version: '2.0.0' }],
    });
    render(
      <PanelManagerDialog
        installedPanels={[]}
        availablePanels={[{ manifest: panel, origin: 'bundled', isEnabled: true } as AvailablePanel]}
        onPanelEnabledChange={vi.fn()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );
    await screen.findByText('Remote catalog');

    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Not installed/)).not.toBeInTheDocument();
    expect(screen.getByText(/ships with this build/)).toBeInTheDocument();
  });

  it('shows a retry action when the official catalog fails to load', async () => {
    api.catalog.mockRejectedValueOnce(new Error('network down'));
    render(
      <PanelManagerDialog
        installedPanels={[]}
        availablePanels={availableFrom([])}
        onPanelEnabledChange={vi.fn()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );


    await screen.findByText("Couldn't load the official panel catalog: network down");

    api.catalog.mockResolvedValueOnce({ panels: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(api.catalog).toHaveBeenCalledTimes(2));
  });

  it('does not duplicate the official source when it is already configured under a custom name', async () => {
    const officialSummary = {
      id: 'la.tessel.roboboy.timeseries',
      name: 'ROS Time Series',
      description: 'Plots ROS numeric fields.',
      version: '1.0.0',
    };
    api.catalog.mockResolvedValue({ panels: [officialSummary] });
    api.load.mockResolvedValue({
      config: {
        schemaVersion: 2,
        sources: [{ type: 'remote', name: 'my-custom-name', catalogUrl: OFFICIAL_PANEL_SOURCE.catalogUrl }],
        selection: { mode: 'none' },
      },
    });
    api.preview.mockResolvedValue({ planId: 'sha256-plan', expiresInSeconds: 600, panels: [], changes: [] });
    render(
      <PanelManagerDialog
        installedPanels={[]}
        availablePanels={availableFrom([])}
        onPanelEnabledChange={vi.fn()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );

    await screen.findByText('ROS Time Series');

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => expect(api.preview).toHaveBeenCalled());
    const [, sentConfig] = api.preview.mock.calls[0];
    expect(sentConfig.sources).toHaveLength(1);
    expect(sentConfig.sources[0].name).toBe('my-custom-name');
  });

  it('installing under "all discovered panels" mode only adds the clicked panel, not every discovered one', async () => {
    const officialSummary = {
      id: 'la.tessel.roboboy.timeseries',
      name: 'ROS Time Series',
      description: 'Plots ROS numeric fields.',
      version: '1.0.0',
    };
    api.catalog.mockResolvedValue({
      panels: [officialSummary, { ...officialSummary, id: 'la.tessel.roboboy.webrtc', name: 'WebRTC Camera' }],
    });
    api.load.mockResolvedValue({
      config: {
        schemaVersion: 2,
        sources: [{ type: 'remote', name: 'official', catalogUrl: 'https://panels.example/catalog.json' }],
        selection: { mode: 'all' },
      },
    });
    api.preview.mockResolvedValue({ planId: 'sha256-plan', expiresInSeconds: 600, panels: [], changes: [] });
    render(
      <PanelManagerDialog
        installedPanels={[panel]}
        availablePanels={availableFrom([panel])}
        onPanelEnabledChange={vi.fn()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );

    await screen.findByText('ROS Time Series');

    fireEvent.click(screen.getAllByRole('button', { name: 'Install' })[0]);

    await waitFor(() =>
      expect(api.preview).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ selection: { mode: 'include', panelIds: [panel.id, officialSummary.id] } })
      )
    );
  });

  it('asks for a token only when the deployment configured one, and then remembers it', async () => {
    api.status.mockResolvedValue({ authenticationRequired: true });
    const { unmount } = render(
      <PanelManagerDialog
        installedPanels={[panel]}
        availablePanels={availableFrom([panel])}
        onPanelEnabledChange={vi.fn()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );

    fireEvent.change(await screen.findByLabelText('Panel manager token'), {
      target: { value: 'remembered-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await screen.findByText('Remote catalog');
    expect(window.localStorage.getItem('robo-boy-panel-manager-token')).toBe('remembered-secret');
    unmount();

    api.load.mockClear();
    render(
      <PanelManagerDialog
        installedPanels={[panel]}
        availablePanels={availableFrom([panel])}
        onPanelEnabledChange={vi.fn()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );

    await screen.findByText('Remote catalog');
    expect(api.load).toHaveBeenCalledWith('remembered-secret');
  });

  it('never asks for a token when the deployment has none', async () => {
    render(
      <PanelManagerDialog
        installedPanels={[panel]}
        availablePanels={availableFrom([panel])}
        onPanelEnabledChange={vi.fn()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />
    );

    await screen.findByText('Remote catalog');
    expect(screen.queryByLabelText('Panel manager token')).not.toBeInTheDocument();
    expect(api.load).toHaveBeenCalledWith('');
  });
});
