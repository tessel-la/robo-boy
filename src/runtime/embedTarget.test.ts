import { describe, expect, it } from 'vitest';
import { EMBED_PORT_PATH, embedHostFor, isEmbedHost, normalizeEmbedBaseUrl } from './embedTarget';

describe('embed targets', () => {
  it('keeps only a plain http(s) origin', () => {
    expect(normalizeEmbedBaseUrl('https://robot.local')).toBe('https://robot.local');
    expect(normalizeEmbedBaseUrl('https://robot.local:8443/')).toBe('https://robot.local:8443');
    expect(normalizeEmbedBaseUrl('https://[::1]')).toBe('https://[::1]');
    for (const refused of ['', 'robot.local', 'file:///etc', 'https://user:pw@robot.local', 'https://robot.local/x', 'https://robot.local/?a=1']) {
      expect(normalizeEmbedBaseUrl(refused)).toBeNull();
    }
  });

  it('gives each robot a stable, valid host label of its own', () => {
    const long = `https://${'a'.repeat(60)}.example.com`;
    const hosts = ['https://robot-a.local', 'https://robot-b.local', 'https://robot-a.local:8443', long].map(embedHostFor);
    expect(new Set(hosts).size).toBe(hosts.length);
    expect(embedHostFor('https://robot-a.local')).toBe(hosts[0]);
    for (const host of hosts) {
      expect(isEmbedHost(host)).toBe(true);
      expect(host.length).toBeLessThanOrEqual(63);
      expect(new URL(`app://${host}/panel-sandbox.html`).hostname).toBe(host);
    }
    expect(isEmbedHost('robo-boy')).toBe(false);
    expect(isEmbedHost('embed-evil.example')).toBe(false);
  });

  it('matches only /<port>/ paths', () => {
    expect(EMBED_PORT_PATH.test('/8089')).toBe(true);
    expect(EMBED_PORT_PATH.test('/8089/vendor/mujoco.wasm')).toBe(true);
    expect(EMBED_PORT_PATH.test('/panel-sandbox.html')).toBe(false);
    expect(EMBED_PORT_PATH.test('/123456/')).toBe(false);
  });
});
