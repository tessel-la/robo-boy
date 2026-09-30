import { useLayoutEffect, useRef } from 'react';
import { createPanelPresentationRegistry } from '../../panels/presentationRegistry';
import type { CustomGamepadLayout } from './types';

export interface PadPresentation {
  layoutId: string;
  layouts: readonly { id: string; name: string }[];
  selectLayout(id: string): void;
  readonly layout?: CustomGamepadLayout;
  readonly isDefault?: boolean;
  setEditing?(editing: boolean): void;
  saveLayout?(layout: CustomGamepadLayout): boolean;
}
const registry = createPanelPresentationRegistry<PadPresentation>();
export const getPadPresentation = registry.get;
export const registerPadPresentation = registry.register;

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
        get layout() {
          return latest.current.layout;
        },
        get isDefault() {
          return latest.current.isDefault;
        },
        setEditing: editing => latest.current.setEditing?.(editing),
        saveLayout: layout => latest.current.saveLayout?.(layout) ?? false,
      },
      storageScope
    );
  }, [id, storageScope]);
}
