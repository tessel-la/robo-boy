type XrPresentationListener = (isPresenting: boolean) => void;

const listeners = new Set<XrPresentationListener>();
let presenting = false;

/**
 * A one-bit broadcast: is an immersive session on screen right now?
 *
 * It exists so the 2D 3D panels can stand down while a headset is presenting. Those viewers are
 * invalidation-driven, not looping, but TF keeps arriving and every arriving transform invalidates
 * them — so without this they keep drawing frames to a page nobody is looking at, competing with the
 * session for the same GPU. VR frame stability is the one thing that cannot be traded away.
 *
 * Deliberately a module-level bus rather than React context: the 3D viewers are owned by hooks deep
 * inside per-connection subtrees, and threading a provider through them would be a far larger change
 * to the 2D path than the behaviour warrants. With nothing publishing, it is inert.
 */
export const subscribeToXrPresentation = (listener: XrPresentationListener): (() => void) => {
  listeners.add(listener);
  // Late subscribers need the current value, not just the next change.
  listener(presenting);
  return () => {
    listeners.delete(listener);
  };
};

export const setXrPresenting = (value: boolean): void => {
  if (presenting === value) return;
  presenting = value;
  for (const listener of listeners) {
    try {
      listener(value);
    } catch {
      // A failing listener must not stop the session from starting or the others from being told.
    }
  }
};

export const isXrPresenting = (): boolean => presenting;

/** Test seam. */
export const resetXrPresentation = (): void => {
  listeners.clear();
  presenting = false;
};
