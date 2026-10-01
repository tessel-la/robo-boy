import { describe, expect, it } from 'vitest';
import { localRepositoryFiles } from './treeRepository';
import { treeFormats } from '../runtime/xml';

const signal = () => new AbortController().signal;
describe('repository documents', () => {
  it.each(treeFormats)('loads $id XML from a local repository and preserves source', async format => {
    const file = new File([format.template], 'tree.xml');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'repo/examples/tree.xml' });
    const files = localRepositoryFiles([file, new File(['x'], 'notes.md')]);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('repo/examples/tree.xml');
    expect((await files[0].load(signal())).nativeDocument?.xml).toBe(format.template);
  });
  it('loads JSON through the same repository workflow and rejects invalid documents', async () => {
    const tree = { id: 'json', name: 'JSON', nodes: [], edges: [] };
    const [file] = localRepositoryFiles([new File([JSON.stringify({ tree })], 'tree.json')]);
    expect(await file.load(signal())).toEqual(tree);
    const [invalid] = localRepositoryFiles([new File(['{"configuration":true}'], 'config.json')]);
    await expect(invalid.load(signal())).rejects.toThrow('Invalid');
    const [malformed] = localRepositoryFiles([
      new File([JSON.stringify({ tree: { ...tree, nodes: {} } })], 'malformed.json'),
    ]);
    await expect(malformed.load(signal())).rejects.toThrow('Invalid');
  });
  it('rejects oversized files and cancelled reads', async () => {
    const [large] = localRepositoryFiles([new File(['x'.repeat(5 * 1024 * 1024 + 1)], 'large.xml')]);
    await expect(large.load(signal())).rejects.toThrow('exceeds 5 MiB');
    const [file] = localRepositoryFiles([new File([treeFormats[0].template], 'tree.xml')]);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(file.load(cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
