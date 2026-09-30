import { useLayoutEffect, useRef } from 'react';
import { createPanelPresentationRegistry } from '../../panels/presentationRegistry';

export interface PadPresentation {
  layoutId: string;
  layouts: readonly { id: string; name: string }[];
  selectLayout(id: string): void;
}
const registry = createPanelPresentationRegistry<PadPresentation>();
export const getPadPresentation = registry.get;

export function usePadPresentation(id: string | undefined, storageScope: string | undefined, state: PadPresentation) {
  const latest = useRef(state);
  latest.current = state;
  useLayoutEffect(() => {
    if (!id) return;
    return registry.register(
      id,
      {
        get layoutId() {
          return latest.current.layoutId;
        },
        get layouts() {
          return latest.current.layouts;
        },
        selectLayout: layoutId => latest.current.selectLayout(layoutId),
      },
      storageScope
    );
  }, [id, storageScope]);
}
