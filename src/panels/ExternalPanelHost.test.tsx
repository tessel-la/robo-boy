import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearExternalPanelModuleCache } from './loader';
import ExternalPanelHost from './ExternalPanelHost';
import type { ResolvedPanelManifest, RoboBoyPanelContext } from './types';

const manifest: ResolvedPanelManifest = {
  schemaVersion: 1,
  id: 'com.example.panel',
  name: 'Example panel',
  description: 'An example.',
  version: '1.0.0',
  entryPoint: 'https://roboboy.test/panels/example.js',
  registryUrl: 'https://roboboy.test/panels/installed.json',
  compatibility: { panelApi: '^1.0.0', roboboy: '*' },
  capabilities: ['ros', 'storage'],
  author: { name: 'Example' },
  repository: 'https://github.com/example/panel',
};

const renderHost = (importer: (entryPoint: string) => Promise<unknown>, overrides = {}) => {
  const onStateChange = vi.fn();
  const result = render(
    <ExternalPanelHost
      manifest={manifest}
      instanceId="panel-instance"
      ros={{} as any}
      isActive
      state={{ count: 2 }}
      onStateChange={onStateChange}
      importer={importer}
      {...overrides}
    />
  );
  return { ...result, onStateChange };
};

describe('ExternalPanelHost', () => {
  beforeEach(() => clearExternalPanelModuleCache());

  it('imports lazily on mount, supplies gated services, mounts, activates, and cleans up', async () => {
    let receivedContext: RoboBoyPanelContext | undefined;
    const unmount = vi.fn();
    const setActive = vi.fn();
    const importer = vi.fn().mockResolvedValue({
      default: {
        apiVersion: '1.0.0',
        id: manifest.id,
        activate: (context: RoboBoyPanelContext) => {
          receivedContext = context;
          return {
            mount: (container: HTMLElement) => {
              container.textContent = 'External content';
              context.storage?.set('count', 3);
            },
            setActive,
            unmount,
          };
        },
      },
    });

    expect(importer).not.toHaveBeenCalled();
    const { unmount: unmountHost, onStateChange } = renderHost(importer);

    expect(await screen.findByText('External content')).toBeInTheDocument();
    expect(importer).toHaveBeenCalledOnce();
    expect(receivedContext).toMatchObject({ panelId: manifest.id, instanceId: 'panel-instance', ros: {} });
    expect(receivedContext?.storage?.get('count', 0)).toBe(3);
    expect(onStateChange).toHaveBeenCalledWith({ count: 3 });
    expect(setActive).toHaveBeenCalledWith(true);

    unmountHost();
    expect(unmount).toHaveBeenCalledOnce();
  });

  it('does not expose ROS or storage unless the manifest declares them', async () => {
    let receivedContext: RoboBoyPanelContext | undefined;
    const importer = vi.fn().mockResolvedValue({
      default: {
        apiVersion: '1.0.0',
        id: manifest.id,
        activate: (context: RoboBoyPanelContext) => {
          receivedContext = context;
          return { mount: (container: HTMLElement) => (container.textContent = 'Mounted') };
        },
      },
    });

    renderHost(importer, { manifest: { ...manifest, capabilities: [] } });

    expect(await screen.findByText('Mounted')).toBeInTheDocument();
    expect(receivedContext?.ros).toBeNull();
    expect(receivedContext?.storage).toBeNull();
  });

  it('isolates initialization failures and retries successfully', async () => {
    const activate = vi
      .fn()
      .mockRejectedValueOnce(new Error('initialization failed'))
      .mockResolvedValueOnce({ mount: (container: HTMLElement) => (container.textContent = 'Recovered') });
    const importer = vi.fn().mockResolvedValue({
      default: { apiVersion: '1.0.0', id: manifest.id, activate },
    });

    renderHost(importer);

    expect(await screen.findByRole('alert')).toHaveTextContent('initialization failed');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Recovered')).toBeInTheDocument();
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it('isolates a runtime mount/render failure to the panel tile', async () => {
    const importer = vi.fn().mockResolvedValue({
      default: {
        apiVersion: '1.0.0',
        id: manifest.id,
        activate: () => ({
          mount: () => {
            throw new Error('render failed');
          },
        }),
      },
    });

    renderHost(importer);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('render failed'));
    expect(document.querySelector('[data-panel-id="com.example.panel"]')).toBeInTheDocument();
  });

  it('attributes later global runtime errors to the panel bundle and cleans up the instance', async () => {
    const unmount = vi.fn();
    const importer = vi.fn().mockResolvedValue({
      default: {
        apiVersion: '1.0.0',
        id: manifest.id,
        activate: () => ({
          mount: (container: HTMLElement) => (container.textContent = 'Running panel'),
          unmount,
        }),
      },
    });

    renderHost(importer);
    expect(await screen.findByText('Running panel')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new ErrorEvent('error', {
          error: new Error(`event callback failed at ${manifest.entryPoint}`),
          filename: manifest.entryPoint,
          message: 'event callback failed',
        })
      );
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('event callback failed');
    expect(unmount).toHaveBeenCalledOnce();
  });
});
