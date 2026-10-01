import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportBehaviorTree, importBehaviorTree, loadBehaviorTree, saveBehaviorTree } from '../storage/treeStorage';
import { nativeTreeFromXml, treeFormats } from './xml';

beforeEach(() => localStorage.clear());

describe('native document persistence and XML files', () => {
  it.each(treeFormats)('reloads the $id runtime and exact source from saved data', format => {
    const source = format.template.replace('</root>', '<!-- native metadata retained -->\n</root>');
    const tree = nativeTreeFromXml(source, format.id);
    expect(saveBehaviorTree(tree)).toBe(true);
    expect(loadBehaviorTree(tree.id)?.nativeDocument).toEqual(tree.nativeDocument);
  });

  it.each(treeFormats)('imports and exports $id XML without changing native semantics', async format => {
    const source = format.template.replace('</root>', '<!-- preserve this -->\n</root>');
    const imported = await importBehaviorTree(new File([source], 'example.xml', { type: 'application/xml' }));
    expect(imported?.nativeDocument?.xml).toBe(source);
    // Marker-free XML requires an explicit backend selection on import.
    expect(imported?.nativeDocument?.runtime).toBe(format.id === 'btcpp' ? 'btcpp' : null);
    const create = vi.fn().mockReturnValue('blob:native-tree');
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      exportBehaviorTree(imported!);
      expect(create).toHaveBeenCalledOnce();
      const blob = create.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('application/xml');
      const exported = await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsText(blob);
      });
      expect(exported).toBe(source);
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('reloads explicit format and selected main tree from a JSON envelope', async () => {
    const tree = nativeTreeFromXml(treeFormats[1].template, 'py_trees');
    const imported = await importBehaviorTree(new File([JSON.stringify({ tree, version: 1 })], 'saved.json'));
    expect(imported?.nativeDocument).toEqual(tree.nativeDocument);
  });
});
