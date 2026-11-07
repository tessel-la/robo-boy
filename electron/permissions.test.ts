// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  setPermissionCheckHandler: vi.fn(),
  setPermissionRequestHandler: vi.fn(),
  fromWebContents: vi.fn(),
  showMessageBox: vi.fn(),
}));
vi.mock('electron', () => ({
  session: { defaultSession: native },
  BrowserWindow: { fromWebContents: native.fromWebContents },
  dialog: { showMessageBox: native.showMessageBox },
}));
import { configurePermissions } from './permissions';

describe('native hardware permission boundary', () => {
  let contents: any, navigate: (...args: any[]) => void, request: any, check: any;
  const audio = { isMainFrame: true, requestingUrl: 'app://robo-boy/index.html', mediaTypes: ['audio'] };
  const ask = (permission: string, details: object = audio) =>
    new Promise<boolean>(resolve => request(contents, permission, resolve, details));
  beforeEach(() => {
    vi.clearAllMocks();
    contents = {
      getURL: vi.fn(() => 'app://robo-boy/index.html'),
      isDestroyed: vi.fn(() => false),
      on: vi.fn((_event, fn) => {
        navigate = fn;
      }),
    };
    native.fromWebContents.mockReturnValue({});
    native.showMessageBox.mockResolvedValue({ response: 1 });
    configurePermissions('app://robo-boy');
    request = native.setPermissionRequestHandler.mock.calls.at(-1)![0];
    check = native.setPermissionCheckHandler.mock.calls.at(-1)![0];
  });
  it('requires a user decision before the main app can record audio', async () => {
    expect(check(contents, 'media', 'app://robo-boy', { ...audio, mediaType: 'audio' })).toBe(false);
    expect(await ask('media')).toBe(true);
    expect(native.showMessageBox).toHaveBeenCalledOnce();
    expect(check(contents, 'media', 'app://robo-boy', { ...audio, mediaType: 'audio' })).toBe(true);
    expect(await ask('media')).toBe(true);
    expect(native.showMessageBox).toHaveBeenCalledOnce();
  });
  it.each([
    { ...audio, mediaTypes: ['video'] },
    { ...audio, mediaTypes: ['audio', 'video'] },
    { ...audio, mediaTypes: [] },
    { ...audio, mediaTypes: undefined },
    { ...audio, isMainFrame: false },
    { ...audio, requestingUrl: 'app://other/index.html' },
    { ...audio, requestingUrl: 'https://untrusted.invalid' },
    { ...audio, requestingUrl: 'null' },
  ])('denies capture outside the trusted audio request: %j', async details => {
    expect(await ask('media', details)).toBe(false);
    expect(native.showMessageBox).not.toHaveBeenCalled();
  });
  it('does not reuse an approval after navigation, including reload to the same URL', async () => {
    let respond!: (value: object) => void;
    native.showMessageBox.mockReturnValue(
      new Promise(resolve => {
        respond = resolve;
      })
    );
    const answer = ask('media');
    navigate({ isMainFrame: true, url: 'app://robo-boy/index.html' });
    respond({ response: 1 });
    expect(await answer).toBe(false);
    expect(check(contents, 'media', 'app://robo-boy', { ...audio, mediaType: 'audio' })).toBe(false);
  });
  it('shares an outstanding prompt and denies dismissal or failure', async () => {
    native.showMessageBox.mockResolvedValue({ response: 0 });
    expect(await Promise.all([ask('media'), ask('media')])).toEqual([false, false]);
    expect(native.showMessageBox).toHaveBeenCalledOnce();
    native.showMessageBox.mockRejectedValue(new Error('closed'));
    expect(await ask('media')).toBe(false);
  });
  it('denies camera checks, missing frames, foreign windows and other permissions', async () => {
    await ask('media');
    expect(check(contents, 'media', '', { ...audio, mediaType: 'video' })).toBe(false);
    expect(check(contents, 'media', '', { ...audio, isMainFrame: false, mediaType: 'audio' })).toBe(false);
    expect(check(null, 'media', '', { ...audio, mediaType: 'audio' })).toBe(false);
    expect(await ask('notifications')).toBe(false);
    contents.getURL.mockReturnValue('https://untrusted.invalid');
    expect(await ask('media')).toBe(false);
  });
  it('keeps fullscreen on app frames but refuses arbitrary origins', async () => {
    expect(await ask('fullscreen')).toBe(true);
    expect(await ask('fullscreen', { requestingUrl: 'https://untrusted.invalid' })).toBe(false);
  });
  it('prompts for manifest-delegated panel capture without caching a grant for other panels', async () => {
    const panel = {
      isMainFrame: false,
      requestingUrl: 'app://embed-0123456789abcdef/panel-sandbox.html',
      mediaTypes: ['video', 'audio'],
    };
    expect(await ask('media', panel)).toBe(true);
    expect(native.showMessageBox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        message: expect.stringContaining('camera and microphone'),
      })
    );
    expect(check(contents, 'media', 'null', { ...panel, mediaType: 'video' })).toBe(false);
    native.showMessageBox.mockResolvedValue({ response: 0 });
    expect(await ask('media', panel)).toBe(false);
    expect(await ask('media', { ...panel, requestingUrl: 'app://embed-0123456789abcdef/8089/' })).toBe(false);
  });
  it('supports the configured development origin without trusting other ports', async () => {
    configurePermissions('http://localhost:5173');
    request = native.setPermissionRequestHandler.mock.calls.at(-1)![0];
    contents.getURL.mockReturnValue('http://localhost:5173');
    expect(await ask('media', { ...audio, requestingUrl: 'http://localhost:5173/' })).toBe(true);
    expect(await ask('media', { ...audio, requestingUrl: 'http://localhost:5174/' })).toBe(false);
  });
});
