import type { SharedImageFrame } from './sharedImageFrame';

/** Retain before asynchronous encoding: stream replacement must not close the selected bitmap. */
export async function cameraFramePng(frame: SharedImageFrame): Promise<Blob> {
  const release = frame.retain();
  try {
    const canvas = document.createElement('canvas');
    canvas.width = frame.image.width;
    canvas.height = frame.image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot export camera images.');
    if ('data' in frame.image)
      context.putImageData(new ImageData(new Uint8ClampedArray(frame.image.data), canvas.width, canvas.height), 0, 0);
    else context.drawImage(frame.image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Camera image could not be encoded.'))),
        'image/png'
      );
    });
  } finally {
    release();
  }
}

export function downloadCameraBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
