import { ImgHTMLAttributes, useEffect, useRef } from 'react';
import { getSafeCameraStreamUrl } from '../utils/cameraStreamUrl';

type SafeCameraImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string;
  allowedStreamBaseUrl?: string;
};

const SAFE_CAMERA_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/;

export function getSafeCameraImageSrc(src: string, allowedStreamBaseUrl?: string): string | null {
  if (SAFE_CAMERA_DATA_URL_PATTERN.test(src)) return src;

  return getSafeCameraStreamUrl(src, allowedStreamBaseUrl);
}

export function isSafeCameraImageSrc(src: string, allowedStreamBaseUrl?: string): boolean {
  return getSafeCameraImageSrc(src, allowedStreamBaseUrl) !== null;
}

export default function SafeCameraImage({ src, allowedStreamBaseUrl, ...imageProps }: SafeCameraImageProps) {
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const imageElement = imageRef.current;
    if (!imageElement) return;

    const safeSrc = getSafeCameraImageSrc(src, allowedStreamBaseUrl);
    if (safeSrc) {
      imageElement.src = safeSrc;
      return;
    }

    imageElement.removeAttribute('src');
  }, [allowedStreamBaseUrl, src]);

  return <img ref={imageRef} {...imageProps} />;
}
