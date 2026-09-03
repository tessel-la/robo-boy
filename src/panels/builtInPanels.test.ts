import { describe, expect, it } from 'vitest';
import { BUILT_IN_PANELS, createPanelCatalog } from './builtInPanels';
import type { ResolvedPanelManifest } from './types';

describe('panel catalog', () => {
  it('keeps every existing built-in workspace panel registered', () => {
    expect(BUILT_IN_PANELS.map(panel => panel.id)).toEqual(['camera', '3d', 'behaviorTree', 'tfTree', 'pad']);
  });

  it('appends external manifests without changing built-in definitions', () => {
    const external = {
      schemaVersion: 1,
      id: 'com.example.panel',
      name: 'Example',
      description: 'Example panel',
      version: '1.0.0',
      entryPoint: 'https://roboboy.test/panel/1.0.0/index.js',
      integrity: 'sha256-awLjC3PnQMe3GqvsLNqbulVO7zysg4XTJoKvBkR3kDk=',
      registryUrl: 'https://roboboy.test/installed.json',
      compatibility: { panelApi: '^2.0.0', roboboy: '*' },
      author: { name: 'Example' },
      repository: 'https://github.com/example/panel',
    } satisfies ResolvedPanelManifest;

    const catalog = createPanelCatalog([external]);

    expect(catalog.slice(0, BUILT_IN_PANELS.length)).toEqual(BUILT_IN_PANELS);
    expect(catalog[catalog.length - 1]).toMatchObject({ id: external.id, source: 'external', manifest: external });
  });
});
