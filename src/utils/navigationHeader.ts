import { rosStamp } from './rosTime';

export function navigationHeader(header: any, fallback?: any) {
  const rawFrame =
    typeof header?.frame_id === 'string' && header.frame_id.trim() ? header.frame_id : fallback?.frame_id;
  const frameId = typeof rawFrame === 'string' ? rawFrame.trim().replace(/^\/+/, '') : '';
  const stamp = rosStamp(header?.stamp === undefined ? fallback?.stamp : header.stamp);
  if (!frameId) throw new Error('Message frame_id is missing.');
  if (stamp === null) throw new Error('Message timestamp is invalid.');
  return { frameId, stamp };
}
