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
