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
      label: 'Backend version unverified',
      message: 'The backend does not report a valid Robo-Boy version. Update the ROS stack to verify compatibility.',
    };
  }
  if (stack !== frontendVersion) {
    return {
      state: 'mismatch' as const,
      label: 'App and ROS stack versions differ',
      message: 'Some features may be incompatible. Use the same Robo-Boy release for the app and ROS stack.',
    };
  }
  return {
    state: 'matched' as const,
    label: 'App and ROS stack versions match',
    message: 'The app and ROS stack report the same Robo-Boy release.',
  };
}
