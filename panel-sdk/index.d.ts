export type RoboBoyJsonPrimitive = string | number | boolean | null;
export type RoboBoyJsonValue = RoboBoyJsonPrimitive | RoboBoyJsonValue[] | RoboBoyJsonObject;

export interface RoboBoyJsonObject {
  [key: string]: RoboBoyJsonValue;
}

export type RoboBoyPanelCapability =
  | 'ros'
  | 'storage'
  | 'network'
  | 'web-bluetooth'
  | 'web-usb'
  | 'web-serial'
  | 'camera'
  | 'microphone';

export type RoboBoyHostEndpoint = 'videoStream';

export interface RoboBoyPanelRosPermissions {
  discover?: boolean;
  /** Allow a trusted Robo-Boy picker to grant individual subscription topics selected by the user. */
  selectTopic?: boolean;
  subscribe?: string[];
  publish?: string[];
  services?: string[];
}

export interface RoboBoyPanelNetworkPermissions {
  /** Exact HTTPS origins, `self` for Robo-Boy, or `https:` for any HTTPS origin. */
  origins?: string[];
  /** Named host services whose broker grants only service-specific routes. */
  hostEndpoints?: RoboBoyHostEndpoint[];
}

export interface RoboBoyPanelPermissions {
  ros?: RoboBoyPanelRosPermissions;
  network?: RoboBoyPanelNetworkPermissions;
}

export interface RoboBoyPanelAuthor {
  name: string;
  url?: string;
}

export interface RoboBoyPanelCompatibility {
  panelApi: string;
  roboboy: string;
}

export interface RoboBoyPanelManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  version: string;
  entryPoint: string;
  integrity: string;
  assets?: RoboBoyPanelAsset[];
  compatibility: RoboBoyPanelCompatibility;
  capabilities?: RoboBoyPanelCapability[];
  permissions?: RoboBoyPanelPermissions;
  author: RoboBoyPanelAuthor;
  repository: string;
  tags?: string[];
  icon?: string;
  preview?: string;
}

export interface RoboBoyPanelAsset {
  path: string;
  integrity: string;
  offline?: boolean;
}

export interface RoboBoyPanelStorage {
  readonly schemaVersion: 1;
  readonly quotaBytes: number;
  get<T extends RoboBoyJsonValue>(key: string, fallback: T): T;
  set(key: string, value: RoboBoyJsonValue): void;
  remove(key: string): void;
  sizeBytes(): number;
}

export interface RoboBoyPanelLogger {
  debug(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

export interface RoboBoyPanelContext {
  readonly panelId: string;
  readonly instanceId: string;
  readonly capabilities: readonly RoboBoyPanelCapability[];
  readonly ros: RoboBoyPanelRos | null;
  readonly storage: RoboBoyPanelStorage | null;
  readonly network: RoboBoyPanelNetwork | null;
  readonly runtime: RoboBoyPanelRuntime;
  readonly connection: RoboBoyPanelConnection;
  readonly viewport: RoboBoyPanelViewport;
  readonly theme: RoboBoyPanelTheme;
  readonly logger: RoboBoyPanelLogger;
}

export type RoboBoyPanelThemeToken =
  | '--primary-color'
  | '--primary-hover-color'
  | '--primary-darker-color'
  | '--secondary-color'
  | '--background-color'
  | '--background-secondary'
  | '--text-color'
  | '--text-secondary'
  | '--border-color'
  | '--border-color-light'
  | '--card-bg'
  | '--card-border'
  | '--button-text-color'
  | '--error-color'
  | '--success-color'
  | '--warning-color'
  | '--font-family-ui';

export interface RoboBoyPanelThemeSnapshot {
  readonly colorScheme: 'light' | 'dark';
  readonly tokens: Readonly<Partial<Record<RoboBoyPanelThemeToken, string>>>;
}

export interface RoboBoyPanelTheme {
  getSnapshot(): RoboBoyPanelThemeSnapshot;
  subscribe(listener: (snapshot: RoboBoyPanelThemeSnapshot) => void): () => void;
}

export interface RoboBoyPanelRuntime {
  readonly target: 'web' | 'desktop';
}

export interface RoboBoyPanelConnectionSnapshot {
  readonly status: 'disconnected' | 'connecting' | 'connected';
  readonly generation: number;
}

export interface RoboBoyPanelConnection {
  getSnapshot(): RoboBoyPanelConnectionSnapshot;
  subscribe(listener: (snapshot: RoboBoyPanelConnectionSnapshot) => void): () => void;
}

export interface RoboBoyPanelViewportSnapshot {
  readonly width: number;
  readonly height: number;
  readonly isIntersecting: boolean;
  readonly isDocumentVisible: boolean;
  readonly isActive: boolean;
}

export interface RoboBoyPanelViewport {
  getSnapshot(): RoboBoyPanelViewportSnapshot;
  subscribe(listener: (snapshot: RoboBoyPanelViewportSnapshot) => void): () => void;
  requestFullscreen(): Promise<void>;
}

export interface RoboBoyRosTopic {
  readonly name: string;
  readonly messageType: string;
}

export interface RoboBoyRosTopicSelectionOptions {
  currentTopic?: string;
}

export interface RoboBoyRosSubscriptionOptions {
  topic: string;
  messageType: string;
  throttleMs?: number;
  queueLength?: number;
  compression?: 'none' | 'png' | 'cbor' | 'cbor-raw';
}

export interface RoboBoyRosSubscription {
  unsubscribe(): Promise<void>;
}

export interface RoboBoyRosPublishOptions {
  topic: string;
  messageType: string;
  message: RoboBoyJsonObject;
}

export interface RoboBoyRosServiceOptions {
  service: string;
  serviceType: string;
  request: RoboBoyJsonObject;
}

export interface RoboBoyPanelRos {
  getTopics(): Promise<RoboBoyRosTopic[]>;
  /** Opens Robo-Boy's trusted topic picker and grants only the topic selected by the user. */
  selectTopic(options?: RoboBoyRosTopicSelectionOptions): Promise<RoboBoyRosTopic>;
  subscribe(
    options: RoboBoyRosSubscriptionOptions,
    listener: (message: RoboBoyJsonObject) => void
  ): Promise<RoboBoyRosSubscription>;
  publish(options: RoboBoyRosPublishOptions): Promise<void>;
  callService(options: RoboBoyRosServiceOptions): Promise<RoboBoyJsonObject>;
}

export interface RoboBoyPanelNetworkRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: string;
  cache?: 'default' | 'no-store';
  signal?: AbortSignal;
}

export interface RoboBoyPanelNetworkResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
  json<T extends RoboBoyJsonValue = RoboBoyJsonValue>(): Promise<T>;
}

export interface RoboBoyPanelNetwork {
  readonly endpoints: Partial<Record<RoboBoyHostEndpoint, string>>;
  fetch(url: string, request?: RoboBoyPanelNetworkRequest): Promise<RoboBoyPanelNetworkResponse>;
}

export interface RoboBoyPanelInstance {
  mount(container: HTMLElement): void | Promise<void>;
  setActive?(isActive: boolean): void | Promise<void>;
  unmount(): void | Promise<void>;
}

export interface RoboBoyPanelDefinition {
  apiVersion: string;
  id: string;
  activate(context: RoboBoyPanelContext): RoboBoyPanelInstance | Promise<RoboBoyPanelInstance>;
}

export interface RoboBoyPanelModule {
  default: RoboBoyPanelDefinition;
}
