import { describe, expect, it } from 'vitest';
import { createPanelSandboxDocument } from './sandboxRuntime';

describe('panel sandbox document', () => {
  it('loads panel modules without leaking Vite runtime helpers into the iframe', () => {
    const document = createPanelSandboxDocument('https://roboboy.test');

    expect(document).not.toContain('__vite__injectQuery');
    expect(document).toContain('__roboboyPanelModuleBridge_');
    expect(document).toContain('Panel bundle module loader failed.');
    expect(document).toContain("script-src 'unsafe-inline' blob:");
  });

  it('uses secure randomness and binds window messages to the parent origin', () => {
    const document = createPanelSandboxDocument('http://192.168.1.39');

    expect(document).toContain('crypto.getRandomValues(bytes)');
    expect(document).not.toContain('Math.random()');
    expect(document).toContain('event.source !== window.parent');
    expect(document).toContain('event.origin !== parentOrigin');
    expect(document).toMatch(/window\.parent\.postMessage\([^;]+,\s*parentOrigin\);/);
    expect(document).toContain('(\"http://192.168.1.39\");');
  });
});
