import ROSLIB, { type Ros } from 'roslib';
import {
  COMPRESSED_IMAGE_TYPES,
  compressedImageBlob,
  isImageType,
  rawImageToRgba,
  type RawImage,
  type RgbaFrame,
} from '../../recordReplay/imageFrames';

/*
 * One frame of a camera topic for the model to look at. It is read as a ROS message, so it works
 * the same for the live robot and for a recording, and needs no access to the video server.
 */

export interface CameraFrame {
  topic: string;
  mimeType: 'image/jpeg';
  /** Base64 JPEG, without a data-URL prefix. */
  data: string;
  width: number;
  height: number;
}

/** Longest side of the frame the model receives: enough to read a scene, small enough to send. */
const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.8;
export const MAX_CAMERA_FRAMES = 2;

/**
 * A question about what a camera shows, not a request to change a camera panel: "what does the
 * camera see" captures a frame, "remove the camera panel" or "lower the camera quality" does not.
 */
export const wantsCameraFrame = (text: string) =>
  /\b(?:camera|cameras|image|picture|photo|frame|scene|view)\b|\bsee\b/i.test(text) &&
  /\bwhat\b|\bdescribe\b|\btell me\b|\bis there\b|\bare there\b|\bcan you see\b|\bdo you see\b|\blook(?:s|ing)? (?:at|like)\b|\bvisible\b|\bcount\b|\bidentify\b|\bread the\b|\banything\b|\banyone\b/i.test(text) &&
  !/\b(?:panel|panels|topic|quality|stream|resolution|layout|add|remove|close|switch|lower|raise)\b/i.test(text);

/** The image topics to look at: those of open camera panels, else any the user named. */
export function cameraFrameTopics(
  text: string,
  cameraPanelTopics: string[],
  topics: Array<{ name: string; type: string }>
): Array<{ name: string; type: string }> {
  const images = topics.filter(topic => isImageType(topic.type));
  const named = images.filter(topic => text.includes(topic.name));
  const shown = cameraPanelTopics
    .map(name => images.find(topic => topic.name === name) ?? { name, type: 'sensor_msgs/msg/Image' })
    .filter(topic => !named.some(item => item.name === topic.name));
  const chosen = [...named, ...shown].slice(0, MAX_CAMERA_FRAMES);
  // A compressed sibling carries the same picture in a fraction of the bytes over rosbridge.
  return chosen.map(topic => {
    if (COMPRESSED_IMAGE_TYPES.includes(topic.type)) return topic;
    const compressed = images.find(item => item.name === `${topic.name}/compressed` && COMPRESSED_IMAGE_TYPES.includes(item.type));
    return compressed ?? topic;
  });
}

/** rosbridge sends `uint8[]` as base64 text; a recording holds bytes. */
export function messageBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return Uint8Array.from(data as number[]);
  if (typeof data === 'string') {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  throw new Error('The image message has no pixel data.');
}

const scaled = (width: number, height: number) => {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

/** Draws a decoded image or an RGBA frame onto a canvas no larger than MAX_SIDE and encodes it. */
async function encodeJpeg(source: ImageBitmap | RgbaFrame): Promise<{ data: string; width: number; height: number }> {
  const size = scaled(source.width, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw the camera frame.');
  if ('data' in source) {
    const full = document.createElement('canvas');
    full.width = source.width;
    full.height = source.height;
    full.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(source.data), source.width, source.height), 0, 0);
    context.drawImage(full, 0, 0, size.width, size.height);
  } else {
    context.drawImage(source, 0, 0, size.width, size.height);
    source.close();
  }
  const url = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return { data: url.slice(url.indexOf(',') + 1), ...size };
}

/** Turns a sensor_msgs/Image or CompressedImage message into a JPEG the model can read. */
export async function imageMessageToJpeg(message: Record<string, unknown>, type: string) {
  if (COMPRESSED_IMAGE_TYPES.includes(type)) {
    const blob = compressedImageBlob({ format: String(message.format ?? 'jpeg'), data: messageBytes(message.data) });
    return encodeJpeg(await createImageBitmap(blob));
  }
  return encodeJpeg(rawImageToRgba({ ...(message as unknown as RawImage), data: messageBytes(message.data) }));
}

/** Waits for the next message of an image topic and returns it as a bounded JPEG. */
export function captureCameraFrame(
  ros: Ros,
  topic: { name: string; type: string },
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<CameraFrame> {
  return new Promise((resolve, reject) => {
    const subscriber = new ROSLIB.Topic({ ros, name: topic.name, messageType: topic.type, queue_length: 1 });
    let settled = false;
    const finish = (error: Error | null, frame?: CameraFrame) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      subscriber.unsubscribe();
      if (error) reject(error);
      else resolve(frame!);
    };
    const abort = () => finish(new DOMException('Camera capture cancelled.', 'AbortError'));
    const timer = setTimeout(
      () => finish(new Error(`No image arrived on ${topic.name} within ${Math.round((options.timeoutMs ?? 4000) / 1000)} s.`)),
      options.timeoutMs ?? 4000
    );
    options.signal?.addEventListener('abort', abort, { once: true });
    let received = false;
    subscriber.subscribe(message => {
      // Decoding takes a moment; the frames after the first are not needed.
      if (settled || received) return;
      received = true;
      imageMessageToJpeg(message as Record<string, unknown>, topic.type).then(
        encoded => finish(null, { topic: topic.name, mimeType: 'image/jpeg', ...encoded }),
        error => finish(error instanceof Error ? error : new Error(String(error)))
      );
    });
  });
}
