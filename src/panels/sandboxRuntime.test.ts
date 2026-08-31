import { describe, expect, it } from 'vitest';
import { createPanelSandboxDocument } from './sandboxRuntime';

describe('panel sandbox document', () => {
  it('loads panel modules without leaking Vite runtime helpers into the iframe', () => {
    const document = createPanelSandboxDocument();

    expect(document).not.toContain('__vite__injectQuery');
    expect(document).toContain('__roboboyPanelModuleBridge_');
    expect(document).toContain('Panel bundle module loader failed.');
    expect(document).toContain("script-src 'unsafe-inline' blob:");
  });
});
