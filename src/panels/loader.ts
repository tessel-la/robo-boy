import { getSha256Integrity } from './sha256';
import type { ResolvedPanelManifest } from './types';

const MAX_PANEL_BUNDLE_BYTES = 25 * 1024 * 1024;

export class PanelLoadError extends Error {
  constructor(
    message: string,
    readonly code: 'fetch-failed' | 'integrity-failed' | 'invalid-encoding'
  ) {
    super(message);
    this.name = 'PanelLoadError';
  }
}

const readBoundedResponse = async (response: Response): Promise<Uint8Array> => {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let streamComplete = false;
  try {
    while (!streamComplete) {
      const { done, value } = await reader.read();
      streamComplete = done;
      if (done) continue;
      size += value.byteLength;
      if (size > MAX_PANEL_BUNDLE_BYTES) {
        await reader.cancel();
        throw new Error(`bundle exceeds ${MAX_PANEL_BUNDLE_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export const loadVerifiedExternalPanelSource = async (
  manifest: ResolvedPanelManifest,
  fetcher: typeof fetch = fetch
): Promise<string> => {
  let response: Response;
  try {
    response = await fetcher(manifest.entryPoint, { cache: 'no-cache', credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declaredLength = Number(response.headers?.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PANEL_BUNDLE_BYTES) {
      throw new Error(`bundle exceeds ${MAX_PANEL_BUNDLE_BYTES} bytes`);
    }
  } catch (error) {
    throw new PanelLoadError(
      `Unable to fetch ${manifest.name}: ${error instanceof Error ? error.message : String(error)}`,
      'fetch-failed'
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedResponse(response);
  } catch (error) {
    throw new PanelLoadError(
      `Unable to fetch ${manifest.name}: ${error instanceof Error ? error.message : String(error)}`,
      'fetch-failed'
    );
  }
  if (bytes.byteLength > MAX_PANEL_BUNDLE_BYTES) {
    throw new PanelLoadError(
      `Unable to fetch ${manifest.name}: bundle exceeds ${MAX_PANEL_BUNDLE_BYTES} bytes`,
      'fetch-failed'
    );
  }
  const actual = await getSha256Integrity(bytes);
  if (actual !== manifest.integrity) {
    throw new PanelLoadError(
      `Unable to verify ${manifest.name}: expected ${manifest.integrity}, received ${actual}`,
      'integrity-failed'
    );
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PanelLoadError(`${manifest.name} is not valid UTF-8 JavaScript.`, 'invalid-encoding');
  }
};
