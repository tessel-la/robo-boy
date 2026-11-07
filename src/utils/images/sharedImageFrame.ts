import type { DecodedImageFrame } from './decodeImage';

/** Stream and consumers share bitmap ownership; each retained frame must be released. */
export type SharedImageFrame = DecodedImageFrame & { retain: () => () => void };
export type ImageEvent = { frame: SharedImageFrame | null; error: string | null };
export function shareImageFrame(frame: DecodedImageFrame) {
  let references = 1;
  const release = () => {
    if (--references === 0) closeFrame(frame);
  };
  const shared: SharedImageFrame = {
    ...frame,
    retain: () => {
      references++;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        release();
      };
    },
  };
  return { frame: shared, release };
}

function closeFrame(frame: DecodedImageFrame | null) {
  if (frame && 'close' in frame.image) frame.image.close();
}
