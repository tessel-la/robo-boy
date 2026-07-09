import { ImgHTMLAttributes, useEffect, useRef } from 'react';
import { escape as escapeHtml } from 'lodash-es';

type SafeCameraImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string;
};

const SAFE_CAMERA_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/;

function isSafeCameraImageSrc(src: string): boolean {
  if (SAFE_CAMERA_DATA_URL_PATTERN.test(src)) return true;

  try {
    const url = new URL(src, window.location.origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.pathname.endsWith('/stream') &&
      url.searchParams.has('topic') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export default function SafeCameraImage({ src, ...imageProps }: SafeCameraImageProps) {
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const imageElement = imageRef.current;
    if (!imageElement) return;

    if (isSafeCameraImageSrc(src)) {
      imageElement.src = escapeHtml(src).replace(/&amp;/g, '&');
      return;
    }

    imageElement.removeAttribute('src');
  }, [src]);

  return <img ref={imageRef} {...imageProps} />;
}
