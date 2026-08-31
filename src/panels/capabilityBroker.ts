import ROSLIB from 'roslib';
import type { Ros, Service, Topic } from 'roslib';
import type { PanelHostToSandboxMessage, PanelSandboxToHostMessage } from './sandboxProtocol';
import { isJsonObject, type ResolvedPanelManifest, type RoboBoyJsonObject, type RoboBoyPanelRuntime } from './types';

const MAX_NETWORK_BYTES = 10 * 1024 * 1024;
const MAX_ROS_JSON_BYTES = 1024 * 1024;
const MAX_NETWORK_REQUESTS = 8;
const MAX_ROS_SUBSCRIPTIONS = 32;
const MAX_ROS_PUBLISHERS = 32;
const MAX_ROS_SERVICES = 16;
const NETWORK_TIMEOUT_MS = 30_000;
const ALLOWED_NETWORK_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const BLOCKED_REQUEST_HEADERS = new Set(['cookie', 'host', 'origin', 'proxy-authorization', 'referer', 'set-cookie']);
const EXPOSED_RESPONSE_HEADERS = new Set([
  'accept-patch',
  'cache-control',
  'content-length',
  'content-type',
  'etag',
  'link',
  'location',
]);
const SANDBOX_MESSAGE_TYPES = new Set(['ready', 'error', 'log', 'storage', 'request', 'cancel']);

interface CapabilityBrokerOptions {
  manifest: ResolvedPanelManifest;
  ros: Ros | null;
  runtime: RoboBoyPanelRuntime;
  runtimeEndpoints: { videoStream?: string };
  hostElement: HTMLElement;
  requestRosTopicSelection?: (
    topics: Array<{ name: string; messageType: string }>,
    currentTopic?: string
  ) => Promise<{ name: string; messageType: string }>;
  userSelectedRosTopics?: Map<string, string>;
  onRosTopicSelected?: (topic: { name: string; messageType: string }) => void;
  logger: {
    debug(message: string, ...details: unknown[]): void;
    info(message: string, ...details: unknown[]): void;
    warn(message: string, ...details: unknown[]): void;
    error(message: string, ...details: unknown[]): void;
  };
}

interface BrokerResources {
  subscriptions: Map<string, { topic: Topic; listener: (message: RoboBoyJsonObject) => void }>;
  publishers: Map<string, Topic>;
  services: Map<string, Service>;
  requests: Map<string, AbortController>;
  selectedTopics: Map<string, string>;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const normalizeRosMessage = (value: unknown): { value: RoboBoyJsonObject; byteLength: number } | null => {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return null;
    const normalized = JSON.parse(serialized) as unknown;
    if (!isJsonObject(normalized)) return null;
    return {
      value: normalized,
      byteLength: new TextEncoder().encode(serialized).byteLength,
    };
  } catch {
    return null;
  }
};

export const resourceMatches = (pattern: string, value: string): boolean => {
  const escaped = pattern
    .split('/')
    .map(segment => {
      if (segment === '**') return '.*';
      if (segment === '*') return '[^/]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${escaped}$`).test(value);
};

const requireResourcePermission = (
  allowed: readonly string[] | undefined,
  resource: unknown,
  label: string
): string => {
  if (typeof resource !== 'string' || !resource.startsWith('/')) throw new Error(`Invalid ROS ${label} name.`);
  if (!allowed?.some(pattern => resourceMatches(pattern, resource))) {
    throw new Error(`Panel is not permitted to access ROS ${label} ${resource}.`);
  }
  return resource;
};

const normalizeHeaders = (value: unknown): Record<string, string> => {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Network headers must be an object.');
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    const normalized = name.toLowerCase();
    if (BLOCKED_REQUEST_HEADERS.has(normalized) || normalized.startsWith('sec-')) {
      throw new Error(`Network header ${name} is not permitted.`);
    }
    if (typeof headerValue !== 'string' || /[\r\n]/.test(headerValue)) {
      throw new Error(`Network header ${name} is invalid.`);
    }
    headers[name] = headerValue;
  }
  return headers;
};

const isVideoStreamEndpointUrl = (endpoint: string, url: URL): boolean => {
  const base = new URL(endpoint, document.baseURI);
  const proxyBacked =
    endpoint.startsWith('/') || (base.origin === window.location.origin && base.pathname === '/video_stream');
  if (proxyBacked) {
    return (
      url.origin === window.location.origin &&
      (url.pathname === '/webrtc/_discovery/paths' ||
        /^\/webrtc\/[A-Za-z0-9][A-Za-z0-9_-]*\/whep(?:\/.*)?$/.test(url.pathname))
    );
  }
  if (url.protocol !== base.protocol || url.hostname !== base.hostname) return false;
  if (url.port === '9997') return url.pathname === '/v3/paths/list';
  return url.port === '8889' && /^\/[A-Za-z0-9][A-Za-z0-9_-]*\/whep(?:\/.*)?$/.test(url.pathname);
};

const isGrantedHostEndpointUrl = (
  manifest: ResolvedPanelManifest,
  runtimeEndpoints: { videoStream?: string },
  url: URL
): boolean =>
  (manifest.permissions?.network?.hostEndpoints || []).some(endpoint => {
    const value = runtimeEndpoints[endpoint];
    return endpoint === 'videoStream' && value ? isVideoStreamEndpointUrl(value, url) : false;
  });

const allowedNetworkUrl = (
  manifest: ResolvedPanelManifest,
  runtimeEndpoints: { videoStream?: string },
  value: unknown
) => {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Network URL is invalid.');
  const url = new URL(value, document.baseURI);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only credential-free HTTP(S) panel requests are supported.');
  }
  const permissions = manifest.permissions?.network;
  const allowed = (permissions?.origins || []).some(origin => {
    if (origin === 'self') return url.origin === window.location.origin;
    if (origin === 'https:') return url.protocol === 'https:';
    return url.origin === origin;
  });
  if (!allowed && !isGrantedHostEndpointUrl(manifest, runtimeEndpoints, url)) {
    throw new Error(`Panel is not permitted to access network origin ${url.origin}.`);
  }
  return url;
};

const requireJsonPayload = (value: unknown, label: string): RoboBoyJsonObject => {
  if (!isJsonObject(value)) throw new Error(`${label} must be a finite JSON object.`);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_ROS_JSON_BYTES) {
    throw new Error(`${label} is too large.`);
  }
  return value;
};

const readBoundedResponseText = async (response: Response): Promise<string> => {
  if (!response.body) {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_NETWORK_BYTES) {
      throw new Error('Network response is too large.');
    }
    return body;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  let streamComplete = false;
  try {
    while (!streamComplete) {
      const { done, value } = await reader.read();
      streamComplete = done;
      if (done) continue;
      size += value.byteLength;
      if (size > MAX_NETWORK_BYTES) {
        await reader.cancel();
        throw new Error('Network response is too large.');
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
};

const respond = (port: MessagePort, requestId: string, value?: unknown, error?: unknown) => {
  const message: PanelHostToSandboxMessage = error
    ? { type: 'response', requestId, error: errorMessage(error) }
    : { type: 'response', requestId, value };
  port.postMessage(message);
};

const requireRos = (ros: Ros | null): Ros => {
  if (!ros) throw new Error('ROS is unavailable.');
  return ros;
};

const handleRequest = async (
  port: MessagePort,
  message: Extract<PanelSandboxToHostMessage, { type: 'request' }>,
  options: CapabilityBrokerOptions,
  resources: BrokerResources
) => {
  const params = (message.params || {}) as Record<string, unknown>;
  const rosPermissions = options.manifest.permissions?.ros;
  if (message.method === 'viewport.requestFullscreen') {
    if (!options.hostElement.requestFullscreen) throw new Error('Fullscreen is unavailable.');
    await options.hostElement.requestFullscreen();
    return undefined;
  }
  if (message.method === 'ros.getTopics') {
    if (!rosPermissions?.discover) throw new Error('Panel is not permitted to discover ROS topics.');
    const ros = requireRos(options.ros);
    const response = await new Promise<{ topics?: string[]; types?: string[] }>((resolve, reject) => {
      ros.getTopics(resolve, reject);
    });
    return (response.topics || [])
      .map((name, index) => ({ name, messageType: response.types?.[index] || '' }))
      .filter(topic => rosPermissions.subscribe?.some(pattern => resourceMatches(pattern, topic.name)));
  }
  if (message.method === 'ros.selectTopic') {
    if (!rosPermissions?.selectTopic) throw new Error('Panel is not permitted to request ROS topic selection.');
    if (!options.requestRosTopicSelection) throw new Error('ROS topic selection is unavailable.');
    const ros = requireRos(options.ros);
    const response = await new Promise<{ topics?: string[]; types?: string[] }>((resolve, reject) => {
      ros.getTopics(resolve, reject);
    });
    const topics = (response.topics || []).map((name, index) => ({
      name,
      messageType: response.types?.[index] || '',
    }));
    const currentTopic = typeof params.currentTopic === 'string' ? params.currentTopic : undefined;
    const selected = await options.requestRosTopicSelection(topics, currentTopic);
    const verified = topics.find(topic => topic.name === selected.name && topic.messageType === selected.messageType);
    if (!verified) throw new Error('Selected ROS topic is no longer available.');
    resources.selectedTopics.set(verified.name, verified.messageType);
    options.onRosTopicSelected?.(verified);
    return verified;
  }
  if (message.method === 'ros.subscribe') {
    if (resources.subscriptions.size >= MAX_ROS_SUBSCRIPTIONS) {
      throw new Error('Panel ROS subscription limit reached.');
    }
    const ros = requireRos(options.ros);
    if (typeof params.topic !== 'string' || !params.topic.startsWith('/')) {
      throw new Error('Invalid ROS topic name.');
    }
    const name = params.topic;
    const staticallyAllowed = rosPermissions?.subscribe?.some(pattern => resourceMatches(pattern, name)) ?? false;
    const selectedMessageType = resources.selectedTopics.get(name);
    if (!staticallyAllowed && !selectedMessageType) {
      throw new Error(`Panel is not permitted to access ROS topic ${name}.`);
    }
    if (typeof params.messageType !== 'string' || !params.messageType.trim())
      throw new Error('ROS messageType is required.');
    if (selectedMessageType && selectedMessageType !== params.messageType) {
      throw new Error('ROS messageType does not match the user-selected topic.');
    }
    const subscriptionId = crypto.randomUUID();
    const topic = new ROSLIB.Topic({
      ros,
      name,
      messageType: params.messageType,
      throttle_rate: typeof params.throttleMs === 'number' ? Math.max(0, Math.min(60_000, params.throttleMs)) : 0,
      queue_length: typeof params.queueLength === 'number' ? Math.max(1, Math.min(100, params.queueLength)) : 1,
      compression: ['none', 'png', 'cbor', 'cbor-raw'].includes(String(params.compression))
        ? (params.compression as 'none')
        : 'none',
    });
    const listener = (value: unknown) => {
      const normalized = normalizeRosMessage(value);
      if (!normalized || normalized.byteLength > MAX_ROS_JSON_BYTES) {
        options.logger.warn(`Dropped invalid or oversized ROS message from ${name}.`);
        return;
      }
      port.postMessage({
        type: 'ros-message',
        subscriptionId,
        value: normalized.value,
      } satisfies PanelHostToSandboxMessage);
    };
    topic.subscribe(listener);
    resources.subscriptions.set(subscriptionId, { topic, listener });
    return { subscriptionId };
  }
  if (message.method === 'ros.unsubscribe') {
    const subscriptionId = params.subscriptionId;
    if (typeof subscriptionId !== 'string') throw new Error('ROS subscription ID is invalid.');
    const subscription = resources.subscriptions.get(subscriptionId);
    if (subscription) {
      subscription.topic.unsubscribe();
      resources.subscriptions.delete(subscriptionId);
    }
    return undefined;
  }
  if (message.method === 'ros.publish') {
    const ros = requireRos(options.ros);
    const name = requireResourcePermission(rosPermissions?.publish, params.topic, 'topic');
    if (typeof params.messageType !== 'string') {
      throw new Error('ROS publish request is invalid.');
    }
    const payload = requireJsonPayload(params.message, 'ROS publish message');
    const key = `${name}:${params.messageType}`;
    let topic = resources.publishers.get(key);
    if (!topic) {
      if (resources.publishers.size >= MAX_ROS_PUBLISHERS) throw new Error('Panel ROS publisher limit reached.');
      topic = new ROSLIB.Topic({ ros, name, messageType: params.messageType });
      topic.advertise();
      resources.publishers.set(key, topic);
    }
    topic.publish(new ROSLIB.Message(payload));
    return undefined;
  }
  if (message.method === 'ros.callService') {
    const ros = requireRos(options.ros);
    const name = requireResourcePermission(rosPermissions?.services, params.service, 'service');
    if (typeof params.serviceType !== 'string') {
      throw new Error('ROS service request is invalid.');
    }
    const request = requireJsonPayload(params.request, 'ROS service request');
    const key = `${name}:${params.serviceType}`;
    let service = resources.services.get(key);
    if (!service) {
      if (resources.services.size >= MAX_ROS_SERVICES) throw new Error('Panel ROS service limit reached.');
      service = new ROSLIB.Service({ ros, name, serviceType: params.serviceType });
      resources.services.set(key, service);
    }
    const result = await new Promise<unknown>((resolve, reject) => {
      service!.callService(new ROSLIB.ServiceRequest(request), resolve, reject);
    });
    return requireJsonPayload(result, 'ROS service response');
  }
  if (message.method === 'network.fetch') {
    if (resources.requests.size >= MAX_NETWORK_REQUESTS) throw new Error('Panel network request limit reached.');
    const url = allowedNetworkUrl(options.manifest, options.runtimeEndpoints, params.url);
    const method = typeof params.method === 'string' ? params.method.toUpperCase() : 'GET';
    if (!ALLOWED_NETWORK_METHODS.has(method)) throw new Error(`Network method ${method} is not permitted.`);
    if (params.body !== undefined && typeof params.body !== 'string') throw new Error('Network body must be text.');
    if (params.cache !== undefined && !['default', 'no-store'].includes(String(params.cache))) {
      throw new Error('Network cache mode is invalid.');
    }
    if (typeof params.body === 'string' && new TextEncoder().encode(params.body).byteLength > MAX_NETWORK_BYTES) {
      throw new Error('Network request body is too large.');
    }
    const controller = new AbortController();
    resources.requests.set(message.requestId, controller);
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, NETWORK_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method,
        headers: normalizeHeaders(params.headers),
        body: method === 'GET' ? undefined : (params.body as string | undefined),
        cache: params.cache === 'no-store' ? 'no-store' : 'default',
        credentials: 'omit',
        redirect: 'follow',
        signal: controller.signal,
      });
      allowedNetworkUrl(options.manifest, options.runtimeEndpoints, response.url);
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_NETWORK_BYTES) {
        throw new Error('Network response is too large.');
      }
      const body = await readBoundedResponseText(response);
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(
          [...response.headers.entries()]
            .filter(([name]) => EXPOSED_RESPONSE_HEADERS.has(name.toLowerCase()))
            .map(([name, value]) => [name.toLowerCase(), value])
        ),
        body,
      };
    } catch (error) {
      if (timedOut) throw new Error('Panel network request timed out.');
      throw error;
    } finally {
      window.clearTimeout(timeout);
      resources.requests.delete(message.requestId);
    }
  }
  throw new Error(`Unknown panel broker method ${message.method}.`);
};

export const connectPanelCapabilityBroker = (
  port: MessagePort,
  options: CapabilityBrokerOptions,
  onMessage: (message: PanelSandboxToHostMessage) => void
): (() => void) => {
  const resources: BrokerResources = {
    subscriptions: new Map(),
    publishers: new Map(),
    services: new Map(),
    requests: new Map(),
    selectedTopics: options.userSelectedRosTopics ?? new Map(),
  };
  port.onmessage = event => {
    const message = event.data as PanelSandboxToHostMessage;
    if (
      !message ||
      typeof message !== 'object' ||
      typeof message.type !== 'string' ||
      !SANDBOX_MESSAGE_TYPES.has(message.type)
    ) {
      options.logger.warn('Rejected malformed panel sandbox message.');
      return;
    }
    if (
      (message.type === 'request' || message.type === 'cancel') &&
      (typeof message.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(message.requestId))
    ) {
      options.logger.warn('Rejected panel sandbox message with an invalid request ID.');
      return;
    }
    if (message.type === 'request' && typeof message.method !== 'string') {
      options.logger.warn('Rejected panel sandbox request without a method.');
      return;
    }
    if (
      (message.type === 'error' && (typeof message.message !== 'string' || message.message.length > 4096)) ||
      (message.type === 'log' &&
        (!['debug', 'info', 'warn', 'error'].includes(message.level) ||
          typeof message.message !== 'string' ||
          message.message.length > 4096 ||
          !Array.isArray(message.details) ||
          message.details.length > 20 ||
          message.details.some(detail => typeof detail !== 'string' || detail.length > 4096))) ||
      (message.type === 'storage' && !isJsonObject(message.values))
    ) {
      options.logger.warn('Rejected malformed panel sandbox message payload.');
      return;
    }
    onMessage(message);
    if (message.type === 'request') {
      void handleRequest(port, message, options, resources).then(
        value => respond(port, message.requestId, value),
        error => respond(port, message.requestId, undefined, error)
      );
    } else if (message.type === 'cancel') {
      resources.requests.get(message.requestId)?.abort();
    }
  };
  port.start();
  return () => {
    resources.requests.forEach(controller => controller.abort());
    resources.subscriptions.forEach(({ topic }) => topic.unsubscribe());
    resources.publishers.forEach(topic => {
      try {
        topic.unadvertise();
      } catch {
        // Best-effort cleanup of a disconnected ROS bridge.
      }
    });
    resources.requests.clear();
    resources.subscriptions.clear();
    resources.publishers.clear();
    resources.services.clear();
    port.close();
  };
};

export const getGrantedPanelEndpoints = (
  manifest: ResolvedPanelManifest,
  runtimeEndpoints: { videoStream?: string }
): Record<string, string> =>
  Object.fromEntries(
    (manifest.permissions?.network?.hostEndpoints || [])
      .map(endpoint => {
        const value = runtimeEndpoints[endpoint];
        return [endpoint, value ? new URL(value, document.baseURI).href : undefined];
      })
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
