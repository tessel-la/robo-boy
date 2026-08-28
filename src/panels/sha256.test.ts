import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytesToBase64, getSha256Integrity, sha256 } from './sha256';

describe('SHA-256 fallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['', '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='],
    ['abc', 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0='],
    ['hello', 'LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ='],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      'JI1qYdIGOLjlwCaTDD5gOaM85Flk/yFn9uzt1BnbBsE=',
    ],
  ])('matches the standard digest for %j', (value, expected) => {
    expect(bytesToBase64(sha256(new TextEncoder().encode(value)))).toBe(expected);
  });

  it('produces an integrity value without Web Crypto', async () => {
    vi.stubGlobal('crypto', undefined);

    await expect(getSha256Integrity(new TextEncoder().encode('hello'))).resolves.toBe(
      'sha256-LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ='
    );
  });
});
