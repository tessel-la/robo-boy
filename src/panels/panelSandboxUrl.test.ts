import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedHostFor } from '../runtime/embedTarget';
import { getPanelSandboxUrl } from './panelSandboxUrl';

describe('panel sandbox URL', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stays beside the app in a browser, where the robot proxy serves the page', () => {
    const url = new URL(getPanelSandboxUrl(''));
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toMatch(/\/panel-sandbox\.html$/);
    expect(url.searchParams.get('parentOrigin')).toBe(window.location.origin);
  });

  it("moves to the connection's embed host in Electron and registers the robot proxy", () => {
    const registerEmbedTarget = vi.fn();
    vi.stubGlobal('roboBoyDesktop', { shell: 'electron', registerEmbedTarget });

    const url = new URL(getPanelSandboxUrl('https://robot.local'));

    expect(registerEmbedTarget).toHaveBeenCalledWith('https://robot.local', []);
    expect(url.href.startsWith(`app://${embedHostFor('https://robot.local')}/panel-sandbox.html?`)).toBe(true);
    expect(url.searchParams.get('parentOrigin')).toBe(window.location.origin);
    // A panel's relative /8089/ frame now resolves on the robot's embed host.
    expect(new URL('/8089/', url).href).toBe(`app://${embedHostFor('https://robot.local')}/8089/`);
  });

  it('registers the ports a robot without a proxy publishes directly', () => {
    const registerEmbedTarget = vi.fn();
    vi.stubGlobal('roboBoyDesktop', { shell: 'electron', registerEmbedTarget });

    getPanelSandboxUrl('https://robot.local', [8089, 0, 8089]);

    expect(registerEmbedTarget).toHaveBeenCalledWith('https://robot.local', [8089]);
  });

  it('keeps the old placement in shells without the embed proxy, or without a robot proxy', () => {
    vi.stubGlobal('roboBoyDesktop', { shell: 'electron' });
    expect(new URL(getPanelSandboxUrl('https://robot.local')).origin).toBe(window.location.origin);

    const registerEmbedTarget = vi.fn();
    vi.stubGlobal('roboBoyDesktop', { shell: 'electron', registerEmbedTarget });
    expect(new URL(getPanelSandboxUrl('')).origin).toBe(window.location.origin);
    expect(registerEmbedTarget).not.toHaveBeenCalled();
  });
});
