import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { getDesktopBridge } from '../../runtime/desktopBridge';
import { defaultSessionName, rememberSessionName } from './sessionName';
import { setEnterpriseSession } from '../enterprise/session';

vi.mock('../../runtime/desktopBridge', () => ({ getDesktopBridge: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('session names', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getDesktopBridge).mockReset();
    vi.mocked(invoke).mockReset();
    localStorage.clear();
    setEnterpriseSession(null);
    delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
  });

  it('uses the authenticated employee name before the OS name, preserving a chosen label', async () => {
    setEnterpriseSession({ user: { id: 'alice', name: 'Alice Employee' }, expires: Date.now() + 60000 });
    vi.mocked(getDesktopBridge).mockReturnValue({ getUsername: async () => 'shared-device' } as never);
    expect(await defaultSessionName()).toBe('Alice Employee');
    expect(getDesktopBridge).not.toHaveBeenCalled();
    rememberSessionName('Test operator');
    expect(await defaultSessionName()).toBe('Test operator');
  });

  it('uses the Electron username and bounds the display label', async () => {
    vi.mocked(getDesktopBridge).mockReturnValue({ getUsername: async () => `  user\n${'x'.repeat(80)} ` } as never);
    const name = await defaultSessionName();
    expect(name).toHaveLength(64);
    expect(name).toMatch(/^userx+$/);
  });

  it('keeps a chosen name across sessions instead of replacing it with the OS user', async () => {
    rememberSessionName('Alice');
    vi.mocked(getDesktopBridge).mockReturnValue({ getUsername: vi.fn(async () => 'system-user') } as never);
    expect(await defaultSessionName()).toBe('Alice');
    expect(getDesktopBridge).not.toHaveBeenCalled();
  });

  it('uses the Tauri native command when available', async () => {
    (window as unknown as { __TAURI_INTERNALS__: object }).__TAURI_INTERNALS__ = {};
    vi.mocked(invoke).mockResolvedValue('tauri-user');
    expect(await defaultSessionName()).toBe('tauri-user');
    expect(invoke).toHaveBeenCalledWith('session_username');
  });

  it('keeps the generated gateway name in browsers and older native shells', async () => {
    expect(await defaultSessionName()).toBeUndefined();
    vi.mocked(getDesktopBridge).mockReturnValue({
      getUsername: async () => {
        throw new Error('Unavailable');
      },
    } as never);
    expect(await defaultSessionName()).toBeUndefined();
  });

  it('still reads native identity when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    vi.mocked(getDesktopBridge).mockReturnValue({ getUsername: async () => 'native-user' } as never);
    expect(await defaultSessionName()).toBe('native-user');
  });
});
