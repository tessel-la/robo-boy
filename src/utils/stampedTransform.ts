import type { CustomTFProvider } from './tfUtils';
import { rosStamp, type TransformResult } from './tfHistory';

export function watchMessageTransform(
  provider: CustomTFProvider,
  header: { frame_id?: string; stamp?: unknown } | undefined,
  callback: (result: TransformResult) => void
): () => void {
  const frame = typeof header?.frame_id === 'string' ? header.frame_id.trim().replace(/^\/+/, '') : '';
  const stamp = rosStamp(header?.stamp);
  if (!frame || stamp === null) {
    callback({ transform: null, error: !frame ? 'Message frame_id is missing.' : 'Message timestamp is invalid.' });
    return () => {};
  }
  return provider.watchTransform(frame, stamp, callback);
}
