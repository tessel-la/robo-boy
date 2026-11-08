import { describe, expect, it } from 'vitest';
import { backendCompatibility, parseBackendInfo } from './backendCompatibility';

describe('backend compatibility', () => {
  it('compares full release versions including prereleases', () => {
    const info = parseBackendInfo({ stackVersion: '0.20.0-alpha', rosDistro: 'jazzy', rosbridgeVersion: '2.3.0' });
    expect(backendCompatibility(info, '0.20.0-alpha').state).toBe('matched');
    for (const app of ['0.19.0-alpha', '0.21.0-alpha', '0.20.0', '0.20.0-beta']) {
      expect(backendCompatibility(info, app).state).toBe('mismatch');
    }
  });

  it('keeps missing or malformed versions unverified', () => {
    for (const value of [
      undefined,
      null,
      [],
      'version',
      {},
      { stackVersion: 'unknown' },
      { stackVersion: 20 },
      { stackVersion: 'x'.repeat(129) },
      { stackVersion: '<b>0.20.0</b>' },
    ]) {
      expect(backendCompatibility(parseBackendInfo(value)).state).toBe('unknown');
    }
    expect(parseBackendInfo({ stackVersion: '0.20.0-alpha', rosDistro: {}, rosbridgeVersion: null })).toEqual({
      stackVersion: '0.20.0-alpha',
      rosDistro: null,
      rosbridgeVersion: null,
    });
  });
});
