/** File trust boundary shared by the three document owners. No storage or ROS access. */
export const MAX_CONTENT_BYTES = 5 * 1024 * 1024;
export type JsonRecord = Record<string, any>;
export function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonRecord;
}
export function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024)
    throw new Error(`${label} must be a non-empty string (up to 1024 characters).`);
  return value;
}
export function collection(value: unknown, label: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new Error(`${label} must be an array with at most ${limit} items.`);
  return value;
}
export function parseContentJson(source: string): unknown {
  if (new TextEncoder().encode(source).byteLength > MAX_CONTENT_BYTES)
    throw new Error('File is too large. Maximum size is 5 MiB.');
  const value: unknown = JSON.parse(source);
  let count = 0;
  const walk = (item: unknown, depth: number) => {
    if (++count > 100000 || depth > 64) throw new Error('Document is too large or deeply nested.');
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Document contains a non-finite number.');
    if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`Unsupported property: ${key}.`);
        walk(child, depth + 1);
      }
    }
  };
  walk(value, 0);
  return value;
}
export function readContentFile(file: File, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new DOMException('Import cancelled', 'AbortError'));
  if (file.size > MAX_CONTENT_BYTES) return Promise.reject(new Error('File is too large. Maximum size is 5 MiB.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      reader.abort();
      cleanup();
      reject(new DOMException('Import cancelled', 'AbortError'));
    };
    reader.onload = () => {
      cleanup();
      resolve(String(reader.result ?? ''));
    };
    reader.onerror = () => {
      cleanup();
      reject(new Error('Unable to read this file.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    reader.readAsText(file);
  });
}
export const importError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Imported field selectors must not traverse JavaScript prototypes when applied later. */
export function assertSafeFieldPath(value: unknown, label: string): void {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  if (value.split(/[.\[\]"']/).some(part => ['__proto__', 'prototype', 'constructor'].includes(part)))
    throw new Error(`${label} cannot reference a prototype.`);
}
