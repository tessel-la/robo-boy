import { BehaviorTree } from '../types';
import { parseBehaviorTreeFile } from '../storage/treeStorage';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
export interface RepositoryTreeFile {
  path: string;
  format: 'JSON' | 'XML';
  load: (signal: AbortSignal) => Promise<BehaviorTree>;
}
const format = (path: string) => (/\.xml$/i.test(path) ? ('XML' as const) : ('JSON' as const));
const isTreeFile = (path: string) => /\.(json|xml)$/i.test(path);

export function localRepositoryFiles(files: File[]): RepositoryTreeFile[] {
  return files
    .filter(file => isTreeFile(file.name))
    .map(file => ({
      path: file.webkitRelativePath || file.name,
      format: format(file.name),
      load: async (signal: AbortSignal) => {
        if (file.size > MAX_FILE_BYTES) throw new Error('Tree file exceeds 5 MiB.');
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          const abort = () => reader.abort();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Could not read tree file.'));
          reader.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
          reader.onloadend = () => signal.removeEventListener('abort', abort);
          signal.addEventListener('abort', abort);
          if (signal.aborted) reject(new DOMException('Cancelled', 'AbortError'));
          else reader.readAsText(file);
        });
        return parseBehaviorTreeFile(text, file.name);
      },
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function parseGithubRepository(input: string): string {
  const value = input.trim();
  let path = value;
  if (value.includes('://')) {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Use a public GitHub repository URL or owner/repository.');
    path = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(path)) throw new Error('Use owner/repository; enter its branch separately.');
  return path.replace(/\.git$/, '');
}

async function githubJson(url: string, signal: AbortSignal) {
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/vnd.github+json' },
    credentials: 'omit',
  });
  if (!response.ok)
    throw new Error(
      response.status === 403 || response.status === 429
        ? 'GitHub request limit reached. Retry later or open a local repository folder.'
        : response.status === 404
          ? 'Repository or revision not found. Use a public repository or open a local folder.'
          : `GitHub request failed (${response.status}).`
    );
  return response.json();
}

/** Only GitHub API URLs are fetched; a repository cannot supply a download origin. */
export async function githubRepositoryFiles(
  input: string,
  revision: string,
  signal: AbortSignal
): Promise<RepositoryTreeFile[]> {
  const repository = parseGithubRepository(input);
  const base = `https://api.github.com/repos/${repository}`;
  const ref = revision.trim() || (await githubJson(base, signal)).default_branch;
  if (typeof ref !== 'string' || !ref) throw new Error('Repository has no default branch.');
  const listing = await githubJson(`${base}/git/trees/${encodeURIComponent(ref)}?recursive=1`, signal);
  if (!Array.isArray(listing.tree) || listing.truncated)
    throw new Error('Repository listing is too large or invalid. Open a local folder instead.');
  return listing.tree
    .filter((entry: any) => entry.type === 'blob' && typeof entry.path === 'string' && isTreeFile(entry.path))
    .map((entry: any) => ({
      path: entry.path,
      format: format(entry.path),
      load: async (loadSignal: AbortSignal) => {
        if (!/^[a-f0-9]{40,64}$/i.test(entry.sha) || !Number.isFinite(entry.size) || entry.size > MAX_FILE_BYTES)
          throw new Error('Invalid or oversized repository tree file.');
        // The listing's immutable blob SHA keeps selection consistent if the branch moves.
        const blob = await githubJson(`${base}/git/blobs/${entry.sha}`, loadSignal);
        if (
          blob.encoding !== 'base64' ||
          typeof blob.content !== 'string' ||
          blob.content.length > MAX_FILE_BYTES * 1.5
        )
          throw new Error('Invalid repository file response.');
        const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), character => character.charCodeAt(0));
        return parseBehaviorTreeFile(new TextDecoder('utf-8', { fatal: true }).decode(bytes), entry.path);
      },
    }))
    .sort((a: RepositoryTreeFile, b: RepositoryTreeFile) => a.path.localeCompare(b.path));
}
