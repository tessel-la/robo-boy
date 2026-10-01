import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubRepositoryFiles, localRepositoryFiles, parseGithubRepository } from './treeRepository';
import { treeFormats } from '../runtime/xml';

const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
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
  it('pins GitHub loads to blob SHA and uses native XML parsing', async () => {
    const sha = 'a'.repeat(40);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ default_branch: 'dev' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tree: [
            { type: 'blob', path: 'examples/tree.xml', size: 100, sha },
            { type: 'blob', path: 'README.md' },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ encoding: 'base64', content: btoa(treeFormats[0].template) }),
      });
    vi.stubGlobal('fetch', fetcher);
    const files = await githubRepositoryFiles('https://github.com/owner/repo', '', signal());
    expect(files).toHaveLength(1);
    expect((await files[0].load(signal())).nativeDocument?.runtime).toBe('btcpp');
    expect(fetcher.mock.calls[2][0]).toBe(`https://api.github.com/repos/owner/repo/git/blobs/${sha}`);
  });
  it('rejects unsupported origins and incomplete repository listings', async () => {
    expect(() => parseGithubRepository('https://evil.example/owner/repo')).toThrow();
    expect(() => parseGithubRepository('https://github.com/owner/repo/tree/dev')).toThrow();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tree: [], truncated: true }) }));
    await expect(githubRepositoryFiles('owner/repo', 'dev', signal())).rejects.toThrow('too large');
  });
  it('reports unavailable repositories and request limits', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    vi.stubGlobal('fetch', fetcher);
    await expect(githubRepositoryFiles('owner/repo', 'dev', signal())).rejects.toThrow('not found');
    await expect(githubRepositoryFiles('owner/repo', 'dev', signal())).rejects.toThrow('request limit');
  });
});
