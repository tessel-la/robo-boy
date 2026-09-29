import { createPanelPresentationRegistry } from '../../panels/presentationRegistry';
import type { TfTreeState } from './tfTreeModel';

export interface TfTreeViewSettings {
  filter: string;
  showStatic: boolean;
  highlightStale: boolean;
}

export interface TfTreePresentation {
  readonly state: TfTreeState;
  readonly settings: TfTreeViewSettings;
  configure(patch: Partial<TfTreeViewSettings>): void;
  refresh(): void;
  setPresented(presented: boolean): void;
}

const registry = createPanelPresentationRegistry<TfTreePresentation>();
export const registerTfTreePresentation = registry.register;
export const getTfTreePresentation = registry.get;
