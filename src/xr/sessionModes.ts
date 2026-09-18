import type { XrSessionMode } from './types';

/**
 * Per-mode session configuration.
 *
 * VR and AR are not one feature behind a flag. They ask the runtime for different things, and the
 * scene has to be built differently for each, so the differences live here as data rather than as
 * conditionals scattered through the scene manager.
 */
export interface XrSessionModeDescriptor {
  readonly mode: XrSessionMode;
  readonly requiredFeatures: readonly string[];
  readonly optionalFeatures: readonly string[];
  /** Human-readable, used by the entry control and by error messages. */
  readonly label: string;
}

/**
 * VR requires a floor-relative space: an enclosed scene with no floor reference puts the horizon in
 * the wrong place and is actively unpleasant to stand in. `bounded-floor` is requested optionally so
 * a room-scale runtime can offer play-area bounds, and `layers` so a runtime that supports the
 * layers API can composite more cheaply where it is available.
 */
const VR: XrSessionModeDescriptor = {
  mode: 'immersive-vr',
  label: 'VR',
  requiredFeatures: ['local-floor'],
  optionalFeatures: ['bounded-floor', 'hand-tracking', 'layers'],
};

/**
 * AR requires nothing, deliberately. Handheld AR commonly offers only `local`, and making
 * `local-floor` required there turns a working device into an unsupported one. The reference space
 * fallback below copes with whatever is actually granted.
 *
 * `dom-overlay` is requested because it is the one thing AR can do that VR structurally cannot —
 * real interactive DOM composited over the scene. Nothing in this phase depends on it being
 * granted; the scene manager only records whether it was.
 */
const AR: XrSessionModeDescriptor = {
  mode: 'immersive-ar',
  label: 'AR',
  requiredFeatures: [],
  optionalFeatures: ['local-floor', 'hand-tracking', 'dom-overlay', 'hit-test', 'anchors'],
};

const DESCRIPTORS: Record<XrSessionMode, XrSessionModeDescriptor> = {
  'immersive-vr': VR,
  'immersive-ar': AR,
};

export const getSessionModeDescriptor = (mode: XrSessionMode): XrSessionModeDescriptor =>
  DESCRIPTORS[mode];

/**
 * Build the init object for `navigator.xr.requestSession`.
 *
 * `domOverlayRoot` is only attached for AR, and only when a root was supplied: passing a
 * `domOverlay` init to a runtime that did not grant the feature is harmless, but passing one with
 * no element is not.
 */
export const buildSessionInit = (
  mode: XrSessionMode,
  domOverlayRoot?: Element | null
): XRSessionInit => {
  const descriptor = getSessionModeDescriptor(mode);
  const init: XRSessionInit = {
    requiredFeatures: [...descriptor.requiredFeatures],
    optionalFeatures: [...descriptor.optionalFeatures],
  };
  if (mode === 'immersive-ar' && domOverlayRoot) {
    init.domOverlay = { root: domOverlayRoot };
  }
  return init;
};

/**
 * Reference spaces to try, best first.
 *
 * A runtime that advertises a feature can still refuse the matching reference space, so this is a
 * fallback chain rather than a single request. `viewer` is the last resort — it tracks the head
 * only, which makes for a poor control room but is better than failing to enter at all.
 */
export const REFERENCE_SPACE_PREFERENCE: readonly XRReferenceSpaceType[] = [
  'local-floor',
  'local',
  'viewer',
];

/**
 * Resolve the best reference space the session will actually give us.
 *
 * Returns the space and which type produced it, because the caller needs the type: `local` puts the
 * origin at the head rather than the floor, so content has to be offset downwards to sit at a
 * plausible height.
 */
export const requestBestReferenceSpace = async (
  session: Pick<XRSession, 'requestReferenceSpace'>,
  preference: readonly XRReferenceSpaceType[] = REFERENCE_SPACE_PREFERENCE
): Promise<{ space: XRReferenceSpace; type: XRReferenceSpaceType }> => {
  const failures: string[] = [];
  for (const type of preference) {
    try {
      const space = await session.requestReferenceSpace(type);
      return { space, type };
    } catch (error) {
      failures.push(`${type}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No usable XR reference space. Tried ${failures.join('; ')}`);
};

/**
 * How far below the origin the floor sits, per reference space type.
 *
 * `local-floor` and `bounded-floor` already place the origin on the floor. `local` and `viewer`
 * place it at the head, so anything meant to rest on the ground needs moving down by roughly a
 * standing eye height.
 */
export const getFloorOffset = (type: XRReferenceSpaceType): number =>
  type === 'local-floor' || type === 'bounded-floor' ? 0 : -1.6;

/**
 * Whether the runtime is compositing over a view of the real world.
 *
 * `opaque` is enclosed VR and wants a background and a ground plane. Everything else is passthrough,
 * where drawing either of those paints over the room the user is standing in.
 */
export const isPassthroughBlendMode = (blendMode: XREnvironmentBlendMode | undefined): boolean =>
  blendMode !== undefined && blendMode !== 'opaque';
