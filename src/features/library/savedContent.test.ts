import { beforeEach, expect, it, vi } from 'vitest';
import { cloneContent } from './content';
import { bundledReleases } from './official';
import { readSavedContent, removeSavedContent } from './savedContent';
import { setLibrarySnapshot } from './runtime';
const savedKey = 'robo-boy-desktop-workspace-saved-layouts-v1';
beforeEach(() => {
  localStorage.clear();
  setLibrarySnapshot([]);
});
function seed() {
  const docs = cloneContent(bundledReleases[0].package).documents;
  const pad = docs.find(doc => doc.kind === 'pad')!.data as any;
  const tree = docs.find(doc => doc.kind === 'behaviorTree')!.data as any;
  const layout = docs.find(doc => doc.kind === 'workspace')!.data as any;
  localStorage.setItem(
    'robo-boy-custom-gamepads',
    JSON.stringify({ version: '1.0.0', customLayouts: [{ id: pad.id, name: pad.name, layout: pad, isDefault: false }] })
  );
  localStorage.setItem('robo-boy-behavior-trees', JSON.stringify([{ tree, version: '1.0.0' }]));
  localStorage.setItem(
    `${savedKey}:connection:robot`,
    JSON.stringify([{ ...layout, panels: [], tileOrder: [], layout: { version: 2, root: null } }])
  );
  return { pad, tree, layout };
}
it('removes authored layouts, Pads and trees through their owning stores and emits change events', () => {
  seed();
  const listener = vi.fn();
  window.addEventListener('robo-boy-workspaces-changed', listener);
  const content = readSavedContent();
  expect(content.items).toHaveLength(3);
  for (const item of content.items) removeSavedContent(item);
  expect(readSavedContent().items).toHaveLength(0);
  expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener('robo-boy-workspaces-changed', listener);
});
it.each([savedKey, 'robo-boy-desktop-workspace-panels-v1', 'robo-boy-mobile-workspace-panels-v1'])(
  'blocks removal of Pads referenced by %s',
  key => {
    const { pad } = seed();
    const item = readSavedContent().items.find(item => item.padId)!;
    const panel = { id: 'pad', type: 'pad', layoutId: pad.id };
    localStorage.setItem(key, JSON.stringify(key === savedKey ? [{ title: 'Controls', panels: [panel] }] : [panel]));
    const before = localStorage.getItem('robo-boy-custom-gamepads');
    expect(() => removeSavedContent(item)).toThrow('Remove the Pad from that layout first');
    expect(localStorage.getItem('robo-boy-custom-gamepads')).toBe(before);
  }
);
it('preserves malformed layout storage on deletion', () => {
  seed();
  const item = readSavedContent().items.find(item => item.workspace)!;
  localStorage.setItem(item.workspace!.key, 'broken');
  expect(() => removeSavedContent(item)).toThrow();
  expect(localStorage.getItem(item.workspace!.key)).toBe('broken');
});
