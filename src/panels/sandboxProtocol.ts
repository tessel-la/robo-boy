import type {
  RoboBoyJsonObject,
  RoboBoyPanelCapability,
  RoboBoyPanelConnectionSnapshot,
  RoboBoyPanelRuntime,
  RoboBoyPanelThemeSnapshot,
  RoboBoyPanelViewportSnapshot,
} from './types';

export interface PanelSandboxInitialization {
  panelId: string;
  instanceId: string;
  apiVersion: string;
  bundleSource: string;
  capabilities: readonly RoboBoyPanelCapability[];
  runtime: RoboBoyPanelRuntime;
  endpoints: Record<string, string>;
  connection: RoboBoyPanelConnectionSnapshot;
  viewport: RoboBoyPanelViewportSnapshot;
  theme: RoboBoyPanelThemeSnapshot;
  storage: {
    enabled: boolean;
    schemaVersion: number;
    quotaBytes: number;
    values: RoboBoyJsonObject;
  };
}

export type PanelSandboxToHostMessage =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string; details: string[] }
  | { type: 'storage'; values: RoboBoyJsonObject }
  | { type: 'request'; requestId: string; method: string; params?: unknown }
  | { type: 'cancel'; requestId: string };

export type PanelHostToSandboxMessage =
  | { type: 'initialize'; value: PanelSandboxInitialization }
  | { type: 'connection'; value: RoboBoyPanelConnectionSnapshot }
  | { type: 'viewport'; value: RoboBoyPanelViewportSnapshot }
  | { type: 'theme'; value: RoboBoyPanelThemeSnapshot }
  | { type: 'response'; requestId: string; value?: unknown; error?: string }
  | { type: 'ros-message'; subscriptionId: string; value: RoboBoyJsonObject }
  | { type: 'dispose' };
