import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../runtime/runtimeConfig', () => ({
  useRuntimeConfig: () => ({ meshResourcesBaseUrl: '/mesh_resources', mode: 'web' }),
}));

// three's HTMLMesh rasterises real DOM through a canvas 2D context jsdom does not implement. The
// component under test here is the entry point and lifecycle wiring, not the rasteriser, which has
// its own limits documented in docs/xr.md.
vi.mock('three/examples/jsm/interactive/HTMLMesh.js', () => ({
  HTMLMesh: class {
    dispose = vi.fn();
  },
}));

import XrWorkspace from './XrWorkspace';

const stubXr = (supported: Partial<Record<XRSessionMode, boolean>>) => {
  vi.stubGlobal('navigator', {
    ...navigator,
    xr: {
      isSessionSupported: vi.fn(async (mode: XRSessionMode) => supported[mode] === true),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestSession: vi.fn(),
    },
  });
};

const panels = [{ id: 'panel-1', type: 'pad', title: 'Drive' }];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('XrWorkspace entry point', () => {
  it('offers nothing when the device supports no immersive mode', async () => {
    stubXr({});
    render(<XrWorkspace ros={null} isConnected={false} panels={panels} />);

    // No disabled button and no explanation for a capability the device was never going to have.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /enter xr/i })).not.toBeInTheDocument()
    );
  });

  it('offers a single action with no toggle when only one mode is available', async () => {
    stubXr({ 'immersive-vr': true });
    render(<XrWorkspace ros={null} isConnected={false} panels={panels} />);

    const button = await screen.findByRole('button', { name: /enter xr workspace/i });
    expect(button).toBeInTheDocument();
    // A toggle between one option is noise.
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(button).toHaveTextContent('VR');
  });

  it('offers a VR/AR toggle when the device serves both', async () => {
    stubXr({ 'immersive-vr': true, 'immersive-ar': true });
    render(<XrWorkspace ros={null} isConnected={false} panels={panels} />);

    await screen.findByRole('radiogroup', { name: /immersive mode/i });
    expect(screen.getByRole('radio', { name: 'VR' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'AR' })).not.toBeChecked();
  });

  it('defaults to AR on an AR-only device', async () => {
    stubXr({ 'immersive-ar': true });
    render(<XrWorkspace ros={null} isConnected={false} panels={panels} />);

    const button = await screen.findByRole('button', { name: /enter xr workspace/i });
    expect(button).toHaveTextContent('AR');
  });

  it('will not start a session without a robot connected', async () => {
    stubXr({ 'immersive-vr': true });
    render(<XrWorkspace ros={null} isConnected={false} panels={panels} />);

    const button = await screen.findByRole('button', { name: /enter xr workspace/i });
    // Entering an empty control room is a worse failure than being told to connect first.
    expect(button).toBeDisabled();
  });

  it('unmounts without leaving a session or a canvas behind', async () => {
    stubXr({ 'immersive-vr': true });
    const { unmount } = render(<XrWorkspace ros={null} isConnected={false} panels={panels} />);
    await screen.findByRole('button', { name: /enter xr workspace/i });

    expect(() => unmount()).not.toThrow();
    expect(document.querySelector('.xr-canvas-host')).toBeNull();
  });
});
