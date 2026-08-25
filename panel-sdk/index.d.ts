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
  compatibility: RoboBoyPanelCompatibility;
  capabilities?: RoboBoyPanelCapability[];
  author: RoboBoyPanelAuthor;
  repository: string;
  tags?: string[];
  icon?: string;
  preview?: string;
}

export interface RoboBoyPanelStorage {
  get<T extends RoboBoyJsonValue>(key: string, fallback: T): T;
  set(key: string, value: RoboBoyJsonValue): void;
  remove(key: string): void;
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
  readonly logger: RoboBoyPanelLogger;
}

export interface RoboBoyPanelInstance {
  mount(container: HTMLElement): void | Promise<void>;
  setActive?(isActive: boolean): void | Promise<void>;
  unmount?(): void | Promise<void>;
}

export interface RoboBoyPanelDefinition {
  apiVersion: '1.0.0';
  id: string;
  activate(context: RoboBoyPanelContext): RoboBoyPanelInstance | Promise<RoboBoyPanelInstance>;
}

export interface RoboBoyPanelModule {
  default: RoboBoyPanelDefinition;
}
