import { beforeEach, describe, expect, it } from 'vitest';
import {
  LEGACY_WORKSPACE_OWNER_KEY,
  getConnectionStorageKey,
  readConnectionStorage,
  writeConnectionStorage,
} from './connectionStorage';

describe('connection workspace storage', () => {
  beforeEach(() => localStorage.clear());

  it('keeps values isolated by connection scope', () => {
    writeConnectionStorage('workspace', 'alpha', 'target-alpha');
    writeConnectionStorage('workspace', 'beta', 'target-beta');

    expect(readConnectionStorage('workspace', 'target-alpha')).toBe('alpha');
    expect(readConnectionStorage('workspace', 'target-beta')).toBe('beta');
    expect(getConnectionStorageKey('workspace', 'target-alpha')).not.toBe(
      getConnectionStorageKey('workspace', 'target-beta')
    );
  });

  it('allows only the first connection scope to claim legacy workspace state', () => {
    localStorage.setItem('workspace', 'legacy');

    expect(readConnectionStorage('workspace', 'target-alpha')).toBe('legacy');
    expect(localStorage.getItem(LEGACY_WORKSPACE_OWNER_KEY)).toBe('target-alpha');
    expect(readConnectionStorage('workspace', 'target-beta')).toBeNull();
  });

  it('retains legacy behavior when no connection scope is supplied', () => {
    localStorage.setItem('workspace', 'legacy');
    expect(readConnectionStorage('workspace')).toBe('legacy');
  });
});
