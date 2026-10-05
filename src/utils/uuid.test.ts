import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUuid } from './uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('createUuid', () => {
  it('uses randomUUID when the context is secure', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'native-id' });
    expect(createUuid()).toBe('native-id');
  });

  it('builds a v4 UUID from getRandomValues when randomUUID is missing (http)', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff) });
    expect(createUuid()).toMatch(V4);
  });

  it('still returns a v4 UUID with no crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(createUuid()).toMatch(V4);
    expect(createUuid()).not.toBe(createUuid());
  });
});
