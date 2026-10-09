const DEFAULT_VIDEO_STREAM_BASE_URL = '/video_stream';
const RELATIVE_URL_ORIGIN = 'http://camera.local';
const ROS_TOPIC_NAME_PATTERN = /^\/(?:[A-Za-z_][A-Za-z0-9_]*)(?:\/[A-Za-z_][A-Za-z0-9_]*)*$/;
const CAMERA_STREAM_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

function normalizeVideoStreamBaseUrl(baseUrl: string): string {
  const trimmedBaseUrl = baseUrl.trim();
  if (!trimmedBaseUrl) return DEFAULT_VIDEO_STREAM_BASE_URL;

  try {
    const relativeUrl = new URL(trimmedBaseUrl, RELATIVE_URL_ORIGIN);
    const isAbsolutePath = trimmedBaseUrl.charAt(0) === '/' && trimmedBaseUrl.charAt(1) !== '/';
    if (relativeUrl.origin === RELATIVE_URL_ORIGIN && isAbsolutePath) {
      relativeUrl.search = '';
      relativeUrl.hash = '';
      return relativeUrl.pathname.replace(/\/+$/, '') || DEFAULT_VIDEO_STREAM_BASE_URL;
    }
  } catch {
    return DEFAULT_VIDEO_STREAM_BASE_URL;
  }

  try {
    const url = new URL(trimmedBaseUrl);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return DEFAULT_VIDEO_STREAM_BASE_URL;
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return DEFAULT_VIDEO_STREAM_BASE_URL;
  }
}

export function isSafeRosTopicName(topic: string): boolean {
  return ROS_TOPIC_NAME_PATTERN.test(topic);
}

function isSafeCameraStreamType(streamType: string): boolean {
  return CAMERA_STREAM_TYPE_PATTERN.test(streamType);
}

function appendTopicParam(params: string[], topic: string) {
  if (!isSafeRosTopicName(topic)) {
    throw new Error(`Invalid camera topic name: ${topic}`);
  }

  params.push(`topic=${encodeURIComponent(topic).replace(/%2F/gi, '/')}`);
}

function appendStreamType(params: URLSearchParams, streamType: string) {
  if (!isSafeCameraStreamType(streamType)) {
    throw new Error(`Invalid camera stream type: ${streamType}`);
  }

  params.set('type', streamType);
}

function appendPositiveNumber(params: URLSearchParams, key: string, value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return;
  params.set(key, String(Math.floor(value)));
}

/** web_video_server's JPEG quality, 1–100. */
function appendJpegQuality(params: URLSearchParams, value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  params.set('quality', String(Math.min(100, Math.max(1, Math.round(value)))));
}

const isJpegQuality = (value: string) => /^[1-9][0-9]?$|^100$/.test(value);

function getCurrentOrigin(): string {
  if (typeof window === 'undefined') return RELATIVE_URL_ORIGIN;
  return window.location.origin;
}

export function isSafeCameraStreamUrl(
  src: string,
  allowedBaseUrl = DEFAULT_VIDEO_STREAM_BASE_URL,
  currentOrigin = getCurrentOrigin()
): boolean {
  return getSafeCameraStreamUrl(src, allowedBaseUrl, currentOrigin) !== null;
}

export function getSafeCameraStreamUrl(
  src: string,
  allowedBaseUrl = DEFAULT_VIDEO_STREAM_BASE_URL,
  currentOrigin = getCurrentOrigin()
): string | null {
  if (src !== src.trim()) return null;

  try {
    const normalizedBaseUrl = normalizeVideoStreamBaseUrl(allowedBaseUrl);
    const allowedStreamUrl = new URL(`${normalizedBaseUrl}/stream`, currentOrigin);
    const url = new URL(src, currentOrigin);

    if (
      url.protocol !== allowedStreamUrl.protocol ||
      url.host !== allowedStreamUrl.host ||
      url.pathname !== allowedStreamUrl.pathname ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return null;
    }

    const allowedParams = new Set(['topic', 'type', 'width', 'height', 'quality', '_refresh']);
    for (const key of url.searchParams.keys()) {
      if (!allowedParams.has(key)) return null;
    }

    const topic = url.searchParams.get('topic');
    if (!topic || !isSafeRosTopicName(topic)) return null;

    const streamType = url.searchParams.get('type');
    if (streamType && !isSafeCameraStreamType(streamType)) return null;

    for (const dimension of ['width', 'height']) {
      const value = url.searchParams.get(dimension);
      if (value && !/^[1-9][0-9]*$/.test(value)) return null;
    }
    const quality = url.searchParams.get('quality');
    if (quality && !isJpegQuality(quality)) return null;
    const refresh = url.searchParams.get('_refresh');
    if (refresh !== null && !REFRESH_TOKEN_PATTERN.test(refresh)) return null;

    const topicParams: string[] = [];
    appendTopicParam(topicParams, topic);
    const params = new URLSearchParams();
    if (streamType) appendStreamType(params, streamType);

    for (const dimension of ['width', 'height']) {
      const value = url.searchParams.get(dimension);
      if (value) params.set(dimension, value);
    }
    if (quality) params.set('quality', quality);
    if (refresh) params.set('_refresh', refresh);

    const encodedParams = params.toString();
    const query = encodedParams ? `${topicParams.join('&')}&${encodedParams}` : topicParams.join('&');
    const streamPathAndQuery = `${allowedStreamUrl.pathname}?${query}`;

    return normalizedBaseUrl.charAt(0) === '/' ? streamPathAndQuery : `${allowedStreamUrl.origin}${streamPathAndQuery}`;
  } catch {
    return null;
  }
}

export function buildCameraStreamUrl({
  topic,
  streamType = 'mjpeg',
  width,
  height,
  quality,
  refresh,
  baseUrl = DEFAULT_VIDEO_STREAM_BASE_URL,
}: {
  topic: string;
  streamType?: string;
  width?: number;
  height?: number;
  /** JPEG quality, 1–100; omitted keeps web_video_server's default. */
  quality?: number;
  /** A unique token forces a new request when refreshing an active MJPEG response. */
  refresh?: string;
  baseUrl?: string;
}): string {
  const params = new URLSearchParams();
  const topicParams: string[] = [];
  appendTopicParam(topicParams, topic);
  if (streamType) appendStreamType(params, streamType);
  appendPositiveNumber(params, 'width', width);
  appendPositiveNumber(params, 'height', height);
  appendJpegQuality(params, quality);
  if (refresh !== undefined) {
    if (!REFRESH_TOKEN_PATTERN.test(refresh)) throw new Error('Invalid camera refresh token.');
    params.set('_refresh', refresh);
  }

  const encodedParams = params.toString();
  const query = encodedParams ? `${topicParams.join('&')}&${encodedParams}` : topicParams.join('&');

  return `${normalizeVideoStreamBaseUrl(baseUrl)}/stream?${query}`;
}

/** One JPEG of the topic's current frame, from web_video_server's `/snapshot`. */
export function buildCameraSnapshotUrl({
  topic,
  quality,
  baseUrl = DEFAULT_VIDEO_STREAM_BASE_URL,
}: {
  topic: string;
  quality?: number;
  baseUrl?: string;
}): string {
  const params = new URLSearchParams();
  const topicParams: string[] = [];
  appendTopicParam(topicParams, topic);
  appendJpegQuality(params, quality);
  const encodedParams = params.toString();
  const query = encodedParams ? `${topicParams.join('&')}&${encodedParams}` : topicParams.join('&');
  return `${normalizeVideoStreamBaseUrl(baseUrl)}/snapshot?${query}`;
}
