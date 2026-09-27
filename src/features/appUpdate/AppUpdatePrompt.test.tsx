import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppUpdatePrompt, { AppUpdateMenuItem } from './AppUpdatePrompt';
import { appUpdater, type UpdateSnapshot } from './appUpdater';
import { APP_VERSION } from './releases';

const RELEASE = {
  version: '99.0.0', tag: 'robo-boy-v99.0.0', name: 'robo-boy: v99.0.0', publishedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  pageUrl: 'https://github.com/tessel-la/robo-boy/releases/tag/robo-boy-v99.0.0',
  notes: '## [99.0.0](https://github.com/x) (2026-09-27)\n\n### Features\n\n* **replay:** open bags on the ROS host ([#189](https://github.com/x)) ([8a2059d](https://github.com/y))\n* plainer first panel',
  assets: [],
};
const INSTALLER = { name: 'Robo-Boy-linux-amd64-electron.deb', url: 'u', size: 100 * 1024 ** 2, sha256: 'c'.repeat(64) };
const initial = appUpdater.snapshot;
const set = (patch: Partial<UpdateSnapshot>) => act(() => (appUpdater as unknown as { update(patch: Partial<UpdateSnapshot>): void }).update(patch));

// Each test starts from the updater's first state; merging a patch back would keep earlier releases.
beforeEach(() => { appUpdater.snapshot = { ...initial }; vi.spyOn(appUpdater, 'start').mockResolvedValue(undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('AppUpdatePrompt', () => {
  it('offers a new release with its notes and what it means for the ROS stack', () => {
    render(<AppUpdatePrompt />);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    set({ supported: true, phase: 'available', release: RELEASE, installer: INSTALLER, rosStack: ['infra/ros/recording_runner.py', 'docker-compose.yml'], promptOpen: true });

    const card = screen.getByRole('complementary', { name: 'Robo-Boy update' });
    expect(card).toHaveTextContent('Robo-Boy 99.0.0 is available');
    expect(card).toHaveTextContent(`You have ${APP_VERSION} · released 2 days ago`);
    fireEvent.click(screen.getByText("What's new"));
    expect(screen.getByRole('heading', { name: 'Features' })).toBeInTheDocument();
    // Links, pull-request numbers and commit hashes give way to the words.
    expect(screen.getByText('open bags on the ROS host', { exact: false }).closest('li')).toHaveTextContent('replay: open bags on the ROS host');
    expect(card).not.toHaveTextContent('#189');
    expect(screen.getByRole('note')).toHaveTextContent('This update also changes the ROS stack');
    expect(screen.getByRole('note')).toHaveTextContent('infra/ros/recording_runner.py, docker-compose.yml');

    const install = vi.spyOn(appUpdater, 'install').mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Update and restart' }));
    expect(install).toHaveBeenCalled();
    const skip = vi.spyOn(appUpdater, 'skip');
    fireEvent.click(screen.getByRole('button', { name: 'Skip this version' }));
    expect(skip).toHaveBeenCalled();
  });

  it('shows the download, then what the installer is doing, without a way to back out mid-install', () => {
    render(<AppUpdatePrompt />);
    set({ phase: 'downloading', release: RELEASE, installer: INSTALLER, promptOpen: true, progress: { received: 25 * 1024 ** 2, total: 100 * 1024 ** 2 } });
    expect(screen.getByRole('progressbar', { name: 'Download progress' })).toHaveAttribute('value', String(25 * 1024 ** 2));
    expect(screen.getByText('Downloading 25.0 MiB of 100.0 MiB · 25%')).toBeInTheDocument();
    const cancel = vi.spyOn(appUpdater, 'cancel').mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Remind me later' })).not.toBeInTheDocument();

    set({ phase: 'installing' });
    expect(screen.getByRole('status')).toHaveTextContent('Your system may ask for your password');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('explains a failure and offers the installer it already checked', () => {
    render(<AppUpdatePrompt />);
    set({ phase: 'failed', release: RELEASE, installer: INSTALLER, promptOpen: true, downloaded: true, error: 'Installing needs administrator approval, and it was not given.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Installing needs administrator approval');
    const open = vi.spyOn(appUpdater, 'openInstaller').mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Open installer' }));
    expect(open).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    const page = vi.spyOn(appUpdater, 'openReleasePage').mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Release page' }));
    expect(page).toHaveBeenCalled();
  });

  it('sends an installation without a matching installer to the release page', () => {
    render(<AppUpdatePrompt />);
    set({ phase: 'available', release: RELEASE, installer: undefined, promptOpen: true });
    const page = vi.spyOn(appUpdater, 'openReleasePage').mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Get it from the release page' }));
    expect(page).toHaveBeenCalled();
  });

  it('reminds to update the ROS host after an update that changed its stack', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<AppUpdatePrompt />);
    set({ rosReminder: { from: '0.13.0', to: APP_VERSION, files: ['docker-compose.yml'] } });
    const card = screen.getByRole('complementary', { name: 'ROS stack update' });
    expect(card).toHaveTextContent(`Robo-Boy is now ${APP_VERSION}`);
    expect(card).toHaveTextContent('git pull && docker compose up -d --build');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy the update command' })); });
    expect(writeText).toHaveBeenCalledWith('git pull && docker compose up -d --build');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    const dismiss = vi.spyOn(appUpdater, 'dismissRosReminder');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(dismiss).toHaveBeenCalledWith(true);
  });
});

describe('AppUpdateMenuItem', () => {
  it('shows the running version and what updates are doing, where the app can update itself', () => {
    const { rerender } = render(<AppUpdateMenuItem />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    set({ supported: true, phase: 'idle' });
    rerender(<AppUpdateMenuItem />);
    expect(screen.getByRole('button')).toHaveAccessibleName(`Robo-Boy ${APP_VERSION}, Check for updates`);
    const open = vi.spyOn(appUpdater, 'open').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button'));
    expect(open).toHaveBeenCalled();
    set({ phase: 'current' });
    expect(screen.getByRole('button')).toHaveTextContent(`${APP_VERSION} · up to date`);
    expect(screen.getByRole('button')).toHaveAccessibleName(`Robo-Boy ${APP_VERSION}, Up to date`);
    set({ phase: 'available', release: RELEASE });
    expect(screen.getByRole('button')).toHaveTextContent('99.0.0 available');
    set({ phase: 'downloading', progress: { received: 50, total: 200 } });
    expect(screen.getByRole('button')).toHaveTextContent('Downloading 25%');
    expect(screen.getByRole('button')).toHaveAccessibleName(`Robo-Boy ${APP_VERSION}, Downloading 99.0.0, 25%`);
  });
});
