import { describe, expect, it, vi } from 'vitest';
import { ExternalPanelSurface } from './externalPanelSurface';
import { validSurfaceFrame } from './surfaceProtocol';

describe('external surface transport', () => {
  it('correlates frames, bounds pending work and releases stale bitmaps', () => {
    const post = vi.fn(),
      present = vi.fn(),
      bridge = new ExternalPanelSurface(post, present);
    bridge.request(0);
    expect(post).not.toHaveBeenCalled();
    bridge.setPresented(true);
    bridge.request(0);
    bridge.request(400);
    expect(post).toHaveBeenCalledOnce();
    const image = { close: vi.fn() } as unknown as ImageBitmap;
    bridge.receive({ type: 'surface-frame', requestId: 2, image, targets: [] });
    expect(image.close).toHaveBeenCalledOnce();
    bridge.receive({ type: 'surface-frame', requestId: 1, image, targets: [] });
    bridge.request(1000);
    bridge.request(7000);
    expect(bridge.error).toContain('timed out');
    bridge.setPresented(false);
    expect(post).toHaveBeenLastCalledWith({ type: 'surface-stop' });
    bridge.input({ type: 'surface-scroll', delta: 1 });
    expect(post).toHaveBeenLastCalledWith({ type: 'surface-stop' });
    bridge.dispose();
    bridge.dispose();
    expect(image.close).toHaveBeenCalledTimes(2);
    expect(present.mock.calls).toEqual([[true], [false]]);
  });
  it('rejects malformed frames at the sandbox trust boundary', () => {
    const frame = {
      type: 'surface-frame' as const,
      requestId: 1,
      targets: [{ id: 'target-1', x: 0, y: 0, width: 0.1, height: 0.1 }],
    };
    expect(validSurfaceFrame(frame)).toBe(true);
    for (const bad of [
      { ...frame, requestId: NaN },
      { ...frame, requestId: -1 },
      { ...frame, image: { width: 1, height: 1 } },
      { ...frame, error: 'x'.repeat(1025) },
      { ...frame, targets: [null] },
      { ...frame, targets: Array(513).fill(frame.targets[0]) },
      { ...frame, targets: [{ ...frame.targets[0], x: Infinity }] },
      { ...frame, targets: [{ ...frame.targets[0], id: '__proto__' }] },
    ])
      expect(validSurfaceFrame(bad as typeof frame)).toBe(false);
  });
});
