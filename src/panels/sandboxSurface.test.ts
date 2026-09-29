import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSandboxSurface } from './sandboxSurface';
vi.mock('./capturePanelSurface', () => ({ capturePanelSurface: vi.fn(async () => document.createElement('canvas')) }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
async function setup() {
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ close: vi.fn() }))
  );
  document.body.innerHTML = '<div id="panel-root"><button>Drive</button></div>';
  const root = document.getElementById('panel-root')!,
    button = root.querySelector('button')!;
  Object.defineProperties(root, { clientWidth: { value: 100 }, clientHeight: { value: 100 } });
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 50,
    bottom: 50,
    width: 50,
    height: 50,
    toJSON() {},
  });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => button) });
  const send = vi.fn(),
    surface = createSandboxSurface(send);
  await surface.capture(1);
  const targetId = send.mock.calls[0][0].targets[0].id;
  const input = (action: 'down' | 'up' | 'cancel' | 'move' | 'click') =>
    surface.input({ type: 'surface-input', pointerId: 'controller-0', targetId, x: 0.25, y: 0.25, action });
  return { surface, button, input };
}

describe('sandbox pointer lease', () => {
  it('renews a hold and cancels when controller updates stop', async () => {
    const { button, input } = await setup();
    const down = vi.fn(),
      cancel = vi.fn();
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointercancel', cancel);
    input('down');
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(100);
      input('move');
    }
    expect(down).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    vi.advanceTimersByTime(401);
    expect(cancel).toHaveBeenCalledOnce();
    input('move');
    input('up');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('releases once and never converts cancellation into a click', async () => {
    const { surface, button, input } = await setup();
    const up = vi.fn(),
      cancel = vi.fn(),
      click = vi.fn();
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', cancel);
    button.addEventListener('click', click);
    input('down');
    input('up');
    input('click');
    expect(up).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    input('down');
    surface.stop();
    surface.stop();
    input('click');
    expect(cancel).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('cancels a stale target and rejects a now-disabled button', async () => {
    const { button, input } = await setup();
    const down = vi.fn(),
      cancel = vi.fn();
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointercancel', cancel);
    input('down');
    vi.mocked(document.elementFromPoint).mockReturnValue(document.body);
    input('move');
    expect(cancel).toHaveBeenCalledOnce();
    vi.mocked(document.elementFromPoint).mockReturnValue(button);
    button.disabled = true;
    input('down');
    expect(down).toHaveBeenCalledOnce();
  });
});
