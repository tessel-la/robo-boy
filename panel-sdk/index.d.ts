import type { Ros } from 'roslib';

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
  readonly hostVersion: string;
  readonly capabilities: readonly RoboBoyPanelCapability[];
  readonly ros: Ros | null;
  readonly storage: RoboBoyPanelStorage | null;
  readonly runtime: RoboBoyPanelRuntime;
  readonly connection: RoboBoyPanelConnection;
  readonly viewport: RoboBoyPanelViewport;
  readonly logger: RoboBoyPanelLogger;
}

export interface RoboBoyPanelRuntime {
  readonly target: 'web' | 'desktop';
  readonly endpoints: {
    readonly rosbridge: string;
    readonly videoStream: string;
    readonly meshResources: string;
    readonly ollama: string;
  };
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
