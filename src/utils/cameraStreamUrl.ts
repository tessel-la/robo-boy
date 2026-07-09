import { escape as escapeHtml } from 'lodash-es';

const DEFAULT_VIDEO_STREAM_BASE_URL = '/video_stream';

function normalizeVideoStreamBaseUrl(baseUrl: string): string {
  const trimmedBaseUrl = baseUrl.trim();
  if (!trimmedBaseUrl) return DEFAULT_VIDEO_STREAM_BASE_URL;

  if (trimmedBaseUrl.startsWith('/')) {
    return trimmedBaseUrl.replace(/\/+$/, '') || DEFAULT_VIDEO_STREAM_BASE_URL;
  }

  try {
    const url = new URL(trimmedBaseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return DEFAULT_VIDEO_STREAM_BASE_URL;
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return DEFAULT_VIDEO_STREAM_BASE_URL;
  }
}

function appendQueryParam(params: string[], key: string, value: string) {
  params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
}

function appendPositiveNumber(params: string[], key: string, value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return;
  appendQueryParam(params, key, String(value));
}

export function buildCameraStreamUrl({
  topic,
  streamType = 'mjpeg',
  width,
  height,
  baseUrl = DEFAULT_VIDEO_STREAM_BASE_URL,
}: {
  topic: string;
  streamType?: string;
  width?: number;
  height?: number;
  baseUrl?: string;
}): string {
  const params: string[] = [];
  appendQueryParam(params, 'topic', escapeHtml(topic));
  if (streamType) appendQueryParam(params, 'type', escapeHtml(streamType));
  appendPositiveNumber(params, 'width', width);
  appendPositiveNumber(params, 'height', height);

  return `${normalizeVideoStreamBaseUrl(baseUrl)}/stream?${params.join('&')}`;
}
