/**
 * Where a panel's same-origin `/<port>/` frames go in the packaged desktop app.
 *
 * In a browser the app is served by the robot's own proxy, so `/8089/` beside the panel sandbox is
 * already the robot's port 8089. The desktop shell serves the app itself, so the same path would
 * name a file in the bundle instead. Each connection therefore gets its sandbox on a host of its
 * own -- `app://embed-<id>/` -- and the shell forwards that host's `/<port>/` paths to the robot
 * the connection belongs to. Shared by the renderer and the Electron main process.
 */

export const EMBED_HOST_PREFIX = 'embed-';

/** The path shape the robot proxy publishes: a port, then the embedded page's own path. */
export const EMBED_PORT_PATH = /^\/(\d{1,5})(?:\/.*)?$/;

const EMBED_HOST = new RegExp(`^${EMBED_HOST_PREFIX}[0-9a-f]{16}$`);

/** The robot proxy's origin, or null for anything that is not a plain http(s) origin. */
export const normalizeEmbedBaseUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
};

/**
 * A stable host label for one robot proxy. Stable so a reloaded panel lands on the host the shell
 * already knows; hashed because an origin is not a valid DNS label and may exceed 63 characters.
 */
/**
 * Ports a desktop shell reaches directly on the robot, from a list such as "8089, 8090".
 * Invalid entries are dropped; an empty list keeps the robot's proxy as the only route.
 */
export const parseEmbedPorts = (value: unknown): number[] => {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : [];
  const ports = items
    .map(item => (typeof item === 'number' || typeof item === 'string' ? Number(item) : NaN))
    .filter(port => Number.isInteger(port) && port >= 1 && port <= 65535);
  return [...new Set(ports)].sort((a, b) => a - b);
};

export const embedHostFor = (baseUrl: string): string => {
  // Two 32-bit FNV-1a passes with different offsets: collisions only need to be unlikely among the
  // handful of robots one app connects to, not resistant to anyone choosing them.
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < baseUrl.length; index++) {
    const code = baseUrl.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x01000193) ^ (b >>> 15);
  }
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, '0');
  return `${EMBED_HOST_PREFIX}${hex(a)}${hex(b)}`;
};

export const isEmbedHost = (hostname: string): boolean => EMBED_HOST.test(hostname);
