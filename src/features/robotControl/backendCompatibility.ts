import { valid } from 'semver';
import { version as appVersion } from '../../../package.json';

export { appVersion };

export interface BackendInfo {
  stackVersion: string | null;
  rosDistro: string | null;
  rosbridgeVersion: string | null;
}

/** Optional diagnostics must never invalidate the control lease status. */
export function parseBackendInfo(value: unknown): BackendInfo | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const info = value as Record<string, unknown>;
  const text = (field: unknown) =>
    typeof field === 'string' && field.length <= 128 && /^[a-zA-Z0-9.+_-]+$/.test(field) ? field : null;
  return {
    stackVersion: text(info.stackVersion),
    rosDistro: text(info.rosDistro),
    rosbridgeVersion: text(info.rosbridgeVersion),
  };
}

export function backendCompatibility(info: BackendInfo | undefined, frontendVersion = appVersion) {
  const stack = info?.stackVersion;
  if (!stack || !valid(stack) || !valid(frontendVersion)) {
    return {
      state: 'unknown' as const,
      label: 'Unverified',
      message: 'Update the ROS stack to report its version.',
    };
  }
  if (stack !== frontendVersion) {
    return {
      state: 'mismatch' as const,
      label: 'Version mismatch',
      message: 'Use the same release for the app and ROS stack.',
    };
  }
  return {
    state: 'matched' as const,
    label: 'Versions match',
    message: '',
  };
}
