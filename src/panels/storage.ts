import { isJsonObject, isJsonValue } from './types';
import type { RoboBoyJsonObject, RoboBoyJsonValue } from './types';

export const PANEL_STORAGE_SCHEMA_VERSION = 1 as const;
export const PANEL_STORAGE_QUOTA_BYTES = 64 * 1024;
const PANEL_STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class PanelStorageError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid-key' | 'invalid-value' | 'quota-exceeded'
  ) {
    super(message);
    this.name = 'PanelStorageError';
  }
}

export const getPanelStateSizeBytes = (state: RoboBoyJsonObject): number => {
  return new TextEncoder().encode(JSON.stringify(state)).byteLength;
};

export const validatePanelState = (value: unknown): value is RoboBoyJsonObject => {
  return isJsonObject(value) && getPanelStateSizeBytes(value) <= PANEL_STORAGE_QUOTA_BYTES;
};

export const validatePanelStorageKey = (key: string): void => {
  if (typeof key === 'string' && PANEL_STORAGE_KEY_PATTERN.test(key)) return;
  throw new PanelStorageError(
    'Panel storage keys must be 1–128 characters and contain only letters, numbers, dots, underscores, or dashes.',
    'invalid-key'
  );
};

export const setPanelStateValue = (
  state: RoboBoyJsonObject,
  key: string,
  value: RoboBoyJsonValue
): RoboBoyJsonObject => {
  validatePanelStorageKey(key);
  if (!isJsonValue(value)) {
    throw new PanelStorageError(
      'Panel storage accepts only finite, acyclic JSON values up to 20 levels deep.',
      'invalid-value'
    );
  }

  const nextState = { ...state, [key]: value };
  const size = getPanelStateSizeBytes(nextState);
  if (size > PANEL_STORAGE_QUOTA_BYTES) {
    throw new PanelStorageError(
      `Panel storage quota exceeded (${size} of ${PANEL_STORAGE_QUOTA_BYTES} bytes).`,
      'quota-exceeded'
    );
  }
  return nextState;
};

export const removePanelStateValue = (state: RoboBoyJsonObject, key: string): RoboBoyJsonObject => {
  validatePanelStorageKey(key);
  const nextState = { ...state };
  delete nextState[key];
  return nextState;
};
