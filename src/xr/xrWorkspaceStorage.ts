import {
  readConnectionStorage,
  removeConnectionStorage,
  writeConnectionStorage,
} from '../runtime/connectionStorage';
import type { XrAttachMode, XrPanelPlacement, XrPose, XrWorkspaceState } from './types';

/**
 * XR placements live under their own key, never inside the 2D workspace records.
 *
 * Keeping them separate is what stops an XR layout from corrupting a desktop or mobile one: the two
 * describe the same panels but in incompatible terms, and a parser for either would have to discard
 * the other's fields. It is routed through connectionStorage like every other workspace key, so an
 * XR room is per-robot in exactly the way a 2D workspace already is.
 */
export const XR_WORKSPACE_STORAGE_KEY = 'robo-boy-xr-workspace-v1';

const DEFAULT_STATE: XrWorkspaceState = { version: 1, panels: {} };

export const createDefaultXrWorkspaceState = (): XrWorkspaceState => ({ version: 1, panels: {} });

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const normalizeTuple = <N extends number>(value: unknown, length: N): number[] | null => {
  if (!Array.isArray(value) || value.length !== length) return null;
  if (!value.every(isFiniteNumber)) return null;
  return [...(value as number[])];
};

/**
 * A pose is only usable if every component survived the round trip.
 *
 * A partially valid pose is worse than none: it would place a panel at a plausible-looking but wrong
 * position, which in a headset means hunting for a panel that is behind you or inside the floor.
 * Anything malformed is dropped so the caller falls back to a fresh default placement.
 */
export const normalizeXrPose = (value: unknown): XrPose | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<XrPose>;

  const position = normalizeTuple(candidate.position, 3);
  const quaternion = normalizeTuple(candidate.quaternion, 4);
  if (!position || !quaternion) return null;

  // A zero-length quaternion cannot be normalized into a rotation.
  const quaternionLength = Math.hypot(...quaternion);
  if (quaternionLength < 1e-6) return null;

  // Clamped rather than rejected: an out-of-range scale is recoverable, and the useful range is
  // bounded by what a person can actually read and reach.
  const scale = isFiniteNumber(candidate.scale) ? Math.min(Math.max(candidate.scale, 0.05), 20) : 1;

  return {
    position: position as [number, number, number],
    quaternion: quaternion as [number, number, number, number],
    scale,
  };
};

const normalizeAttach = (value: unknown): XrAttachMode =>
  value === 'viewer' ? 'viewer' : 'world';

const normalizePlacement = (value: unknown): XrPanelPlacement | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<XrPanelPlacement>;
  const pose = normalizeXrPose(candidate.pose);
  if (!pose) return null;
  return {
    pose,
    pinned: candidate.pinned === true,
    attach: normalizeAttach(candidate.attach),
  };
};

/**
 * Parse whatever is in storage into something safe to render.
 *
 * Follows the same contract as normalizeWorkspaceLayout in src/components/workspaceLayout.ts: a
 * version discriminant, per-field guards, and silent repair rather than throwing. An unreadable XR
 * layout must never stop the application from starting, and the worst case here — every panel
 * falling back to a default placement — is recoverable by the user in seconds.
 */
export const normalizeXrWorkspaceState = (value: unknown): XrWorkspaceState => {
  if (!value || typeof value !== 'object') return createDefaultXrWorkspaceState();
  const candidate = value as Partial<XrWorkspaceState>;
  if (candidate.version !== 1) return createDefaultXrWorkspaceState();

  const panels: Record<string, XrPanelPlacement> = {};
  if (candidate.panels && typeof candidate.panels === 'object') {
    for (const [panelId, placement] of Object.entries(candidate.panels as Record<string, unknown>)) {
      if (!panelId) continue;
      const normalized = normalizePlacement(placement);
      if (normalized) panels[panelId] = normalized;
    }
  }

  const state: XrWorkspaceState = { version: 1, panels };
  const world = normalizeXrPose(candidate.world);
  if (world) state.world = world;
  const desk = normalizeXrPose(candidate.desk);
  if (desk) state.desk = desk;
  return state;
};

export const loadXrWorkspaceState = (storageScope?: string): XrWorkspaceState => {
  try {
    const stored = readConnectionStorage(XR_WORKSPACE_STORAGE_KEY, storageScope);
    if (!stored) return createDefaultXrWorkspaceState();
    return normalizeXrWorkspaceState(JSON.parse(stored));
  } catch {
    // Unparseable storage is reported nowhere on purpose: it is indistinguishable from a first run
    // as far as the user is concerned, and the recovery is identical.
    return createDefaultXrWorkspaceState();
  }
};

export const saveXrWorkspaceState = (state: XrWorkspaceState, storageScope?: string): void => {
  try {
    writeConnectionStorage(XR_WORKSPACE_STORAGE_KEY, JSON.stringify(state), storageScope);
  } catch {
    // A quota failure must not interrupt a live session; the placement simply is not remembered.
  }
};

export const clearXrWorkspaceState = (storageScope?: string): void => {
  removeConnectionStorage(XR_WORKSPACE_STORAGE_KEY, storageScope);
};

/** Immutably record one placement, leaving the rest of the state alone. */
export const withPanelPlacement = (
  state: XrWorkspaceState,
  panelId: string,
  placement: XrPanelPlacement
): XrWorkspaceState => ({
  ...state,
  panels: { ...state.panels, [panelId]: placement },
});

export const withWorldPose = (state: XrWorkspaceState, pose: XrPose): XrWorkspaceState => ({
  ...state,
  world: pose,
});

/**
 * Drop placements for panels that no longer exist.
 *
 * Called when the XR workspace opens rather than on every 2D edit, so that removing a panel and
 * adding it back within one session does not lose where it was.
 */
export const pruneXrWorkspaceState = (
  state: XrWorkspaceState,
  livePanelIds: readonly string[]
): XrWorkspaceState => {
  const live = new Set(livePanelIds);
  const panels: Record<string, XrPanelPlacement> = {};
  for (const [panelId, placement] of Object.entries(state.panels)) {
    if (live.has(panelId)) panels[panelId] = placement;
  }
  return { ...state, panels };
};

export const DEFAULT_XR_WORKSPACE_STATE = DEFAULT_STATE;
