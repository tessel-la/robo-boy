import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getDesktopWindow } from './desktopWindow';

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));

describe('getDesktopWindow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('routes window controls through the Electron preload bridge', async () => {
    const electronWindow = { minimize: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('roboBoyDesktop', { shell: 'electron', window: electronWindow });

    const desktopWindow = await getDesktopWindow();
    await desktopWindow.minimize();

    expect(desktopWindow).toBe(electronWindow);
    expect(electronWindow.minimize).toHaveBeenCalledOnce();
    expect(getCurrentWindow).not.toHaveBeenCalled();
  });

  it('retains the native Tauri window when no Electron bridge is installed', async () => {
    const tauriWindow = { close: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(getCurrentWindow).mockReturnValue(tauriWindow as ReturnType<typeof getCurrentWindow>);

    const desktopWindow = await getDesktopWindow();
    await desktopWindow.close();

    expect(desktopWindow).toBe(tauriWindow);
    expect(tauriWindow.close).toHaveBeenCalledOnce();
  });
});
