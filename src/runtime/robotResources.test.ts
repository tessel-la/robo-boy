import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRobotResourceManager } from './robotResources';
import { isRobotResourceUrl } from './robotResourceScope';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string, protocol: string) => `http://${protocol}.localhost/${path}`,
}));

afterEach(() => {
  delete (window as any).roboBoyDesktop;
  delete (window as any).__TAURI_INTERNALS__;
});

describe('robot asset transport', () => {
  it.each(['10.8.0.1', 'localhost', '127.0.0.1', '[::1]', 'robot.local'])(
    'preserves the configured port on %s, including nested materials and textures',
    host => {
      (window as any).roboBoyDesktop = { shell: 'electron', robotResourceProtocol: true };
      const base = `http://${host}:18000/assets`;
      const manager = createRobotResourceManager(base);
      for (const file of ['arm.obj', 'arm.mtl', 'arm.stl', 'arm.dae', 'textures/paint.png?rev=2']) {
        const target = `${base}/robot/${file}`;
        const native = new URL(manager.resolveURL(target));
        expect(native.protocol).toBe('robot-resource:');
        expect(native.searchParams.get('base')).toBe(base);
        expect(native.searchParams.get('url')).toBe(target);
      }
      expect(manager.resolveURL(`http://${host}:8000/arm.obj`)).toBe(`http://${host}:8000/arm.obj`);
    }
  );

  it('supports Tauri custom protocol mapping on Windows and Android', () => {
    (window as any).__TAURI_INTERNALS__ = {};
    const manager = createRobotResourceManager('https://robot.local:18443/');
    expect(manager.resolveURL('https://robot.local:18443/a.stl')).toBe(
      'http://robot-resource.localhost/resource?base=https%3A%2F%2Frobot.local%3A18443%2F&url=https%3A%2F%2Frobot.local%3A18443%2Fa.stl'
    );
  });

  it('leaves browser proxy URLs, browser direct requests, and older shells unchanged', () => {
    for (const bridge of [undefined, { shell: 'electron' }]) {
      (window as any).roboBoyDesktop = bridge;
      for (const base of ['/mesh_resources', 'http://localhost:18000']) {
        const target = `${base}/robot/arm.obj`;
        expect(createRobotResourceManager(base).resolveURL(target)).toBe(target);
      }
    }
  });

  it('keeps embedded assets and unrelated origins out of the native transport', () => {
    (window as any).roboBoyDesktop = { robotResourceProtocol: true };
    const manager = createRobotResourceManager('http://robot:18000/assets');
    for (const target of [
      'data:image/png;base64,abc',
      'blob:http://robot/id',
      'https://cdn.example/a.png',
      'file:///etc/passwd',
    ]) {
      expect(manager.resolveURL(target)).toBe(target);
    }
  });

  it('rejects credentials, path escapes, different schemes, and prefix lookalikes', () => {
    const base = 'https://robot:18443/assets';
    for (const target of [
      'https://user:secret@robot:18443/assets/a.obj',
      'http://robot:18443/assets/a.obj',
      'https://robot:18443/assets-other/a.obj',
      'https://robot:18443/assets/../private/a.obj',
      'https://robot:18443/assets/%2e%2e/private/a.obj',
      'https://robot:18443/assets/x%2f..%2fprivate',
      'file:///assets/a.obj',
      'not a URL',
    ])
      expect(isRobotResourceUrl(base, target)).toBe(false);
  });
});
