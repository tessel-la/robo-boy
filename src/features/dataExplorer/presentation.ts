import { useLayoutEffect, useState } from 'react';
import { createPanelPresentationRegistry } from '../../panels/presentationRegistry';

// The mounted Explorer owns its inspection lease in both desktop and immersive presentations.
const registry = createPanelPresentationRegistry<(presented: boolean) => void>();
export const getDataExplorerPresentation = registry.get;
export function useDataExplorerPresentation(id?: string, scope?: string) {
  const [presented, setPresented] = useState(false);
  useLayoutEffect(() => (id ? registry.register(id, setPresented, scope) : undefined), [id, scope]);
  return presented;
}
