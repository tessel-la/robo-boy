import { describe, expect, it } from 'vitest';
import { toResponse } from './desktopBridge';

const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe('toResponse', () => {
  /**
   * The shell cannot hand back a Response. Only structured-cloneable values cross the context
   * bridge, and a Response sent through one arrives as a plain object whose `status` reads as
   * undefined rather than throwing -- so callers saw "HTTP undefined" instead of a failure they
   * could act on. The parts travel; the Response is rebuilt here.
   */
  it('rebuilds a usable response from the parts that crossed the bridge', async () => {
    const response = toResponse({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: encode('{"schemaVersion":1}'),
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    await expect(response.json()).resolves.toEqual({ schemaVersion: 1 });
  });

  it('reports a failed download as not ok, so the installer can say what went wrong', () => {
    const response = toResponse({ status: 404, statusText: 'Not Found', headers: {}, body: encode('') });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
  });

  // The Response constructor throws when a body is paired with a status defined to have none.
  it.each([204, 304])('accepts %i, which may carry no body', status => {
    expect(() => toResponse({ status, statusText: '', headers: {}, body: encode('ignored') })).not.toThrow();
  });
});
