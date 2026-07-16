import { describe, expect, it } from 'vitest';
import { normalizeConnectionHost } from './connectionHost';

describe('normalizeConnectionHost', () => {
  it('repairs comma-separated IPv4 typos', () => {
    expect(normalizeConnectionHost('192,168,1,20')).toBe('192.168.1.20');
  });

  it('normalizes full URLs to their host', () => {
    expect(normalizeConnectionHost('http://robot.tailnet.ts.net:1234/path')).toBe('robot.tailnet.ts.net');
  });

  it('returns the fallback for blank hosts', () => {
    expect(normalizeConnectionHost('   ', 'localhost')).toBe('localhost');
  });
});
