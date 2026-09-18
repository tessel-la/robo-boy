import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setAnimationLoop = vi.fn();
const setSession = vi.fn().mockResolvedValue(undefined);
const setReferenceSpaceType = vi.fn();
const rendererDispose = vi.fn();

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');

  class WebGLRenderer {
    domElement = document.createElement('canvas');
    xr = { enabled: false, setSession, setReferenceSpaceType };
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    setClearAlpha = vi.fn();
    setAnimationLoop = setAnimationLoop;
    render = vi.fn();
    dispose = rendererDispose;
  }

  return { ...actual, WebGLRenderer };
});

// Imported after the mock so the manager picks up the stubbed renderer.
const { XrSceneManager } = await import('./XrSceneManager');

interface FakeSession {
  environmentBlendMode: XREnvironmentBlendMode;
  requestReferenceSpace: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  domOverlayState?: { type: string };
}

const createSession = (blendMode: XREnvironmentBlendMode = 'opaque'): FakeSession => ({
  environmentBlendMode: blendMode,
  requestReferenceSpace: vi.fn().mockResolvedValue({}),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
});

let container: HTMLElement;
let requestSession: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  requestSession = vi.fn();
  vi.stubGlobal('navigator', { ...navigator, xr: { requestSession } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('XR session lifecycle', () => {
  it('starts a continuous animation loop only while a session is live', async () => {
    const session = createSession();
    requestSession.mockResolvedValue(session);
    const manager = new XrSceneManager({ container });

    expect(setAnimationLoop).not.toHaveBeenCalled();

    await manager.start('immersive-vr');

    // WebXR needs setAnimationLoop; the 2D viewer's invalidation model cannot serve a session.
    expect(setAnimationLoop).toHaveBeenCalledTimes(1);
    expect(setAnimationLoop.mock.calls[0][0]).toBeTypeOf('function');
    expect(manager.isPresenting).toBe(true);
    expect(manager.mode).toBe('immersive-vr');

    const [, endHandler] = session.addEventListener.mock.calls.find(
      ([type]) => type === 'end'
    ) as [string, () => void];
    endHandler();

    // And it must stop, or the page keeps rendering at headset rate after the user takes it off.
    expect(setAnimationLoop).toHaveBeenLastCalledWith(null);
    expect(manager.isPresenting).toBe(false);
    manager.dispose();
  });

  it('resolves a reference space before handing the session to three', async () => {
    const session = createSession();
    session.requestReferenceSpace
      .mockRejectedValueOnce(new Error('unsupported'))
      .mockResolvedValueOnce({});
    requestSession.mockResolvedValue(session);

    const manager = new XrSceneManager({ container });
    await manager.start('immersive-vr');

    // Falling back here is what stops a runtime that advertises local-floor but refuses it from
    // failing the whole entry.
    expect(setReferenceSpaceType).toHaveBeenCalledWith('local');
    expect(setSession).toHaveBeenCalledWith(session);
    manager.dispose();
  });

  it('ends a session it could not bind, rather than leaving the headset blank', async () => {
    const session = createSession();
    requestSession.mockResolvedValue(session);
    setSession.mockRejectedValueOnce(new Error('bind failed'));

    const manager = new XrSceneManager({ container });
    await expect(manager.start('immersive-vr')).rejects.toThrow('bind failed');

    expect(session.end).toHaveBeenCalled();
    expect(manager.isPresenting).toBe(false);
    expect(setAnimationLoop).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('tolerates being disposed twice', async () => {
    const session = createSession();
    requestSession.mockResolvedValue(session);
    const manager = new XrSceneManager({ container });
    await manager.start('immersive-vr');

    manager.dispose();
    // Every exit path funnels through dispose — unmount, disconnect, session end — so reaching it
    // twice has to be harmless.
    expect(() => manager.dispose()).not.toThrow();
    expect(rendererDispose).toHaveBeenCalledTimes(1);
  });

  it('removes its canvas from the page on dispose', async () => {
    const manager = new XrSceneManager({ container });
    expect(container.querySelector('canvas')).not.toBeNull();
    manager.dispose();
    expect(container.querySelector('canvas')).toBeNull();
  });
});

describe('environment per blend mode', () => {
  const findGrid = (manager: InstanceType<typeof XrSceneManager>) => {
    let found = false;
    manager.scene.traverse(object => {
      if (object.type === 'GridHelper') found = true;
    });
    return found;
  };

  it('draws a ground plane and background in enclosed VR', async () => {
    requestSession.mockResolvedValue(createSession('opaque'));
    const manager = new XrSceneManager({ container });
    await manager.start('immersive-vr');

    expect(manager.isPassthrough).toBe(false);
    expect(findGrid(manager)).toBe(true);
    expect(manager.scene.background).not.toBeNull();
    manager.dispose();
  });

  it('draws neither over passthrough', async () => {
    requestSession.mockResolvedValue(createSession('alpha-blend'));
    const manager = new XrSceneManager({ container });
    await manager.start('immersive-ar');

    // A background or a ground plane in AR paints over the room the user is standing in.
    expect(manager.isPassthrough).toBe(true);
    expect(findGrid(manager)).toBe(false);
    expect(manager.scene.background).toBeNull();
    manager.dispose();
  });

  it('clears the environment again when the session ends', async () => {
    const session = createSession('opaque');
    requestSession.mockResolvedValue(session);
    const manager = new XrSceneManager({ container });
    await manager.start('immersive-vr');
    expect(findGrid(manager)).toBe(true);

    const [, endHandler] = session.addEventListener.mock.calls.find(
      ([type]) => type === 'end'
    ) as [string, () => void];
    endHandler();

    expect(findGrid(manager)).toBe(false);
    manager.dispose();
  });
});
