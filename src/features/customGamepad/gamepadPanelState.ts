import type { CustomGamepadLayout } from './types';

export type GamepadSaveMode = 'create' | 'template' | 'edit';

export interface CustomGamepadPanel {
  id: string;
  name: string;
  layoutId?: string;
}

export function applySavedGamepadToPanels<T extends CustomGamepadPanel>({
  panels,
  selectedPanelId,
  layout,
  mode,
  createPanel,
}: {
  panels: T[];
  selectedPanelId: string | null;
  layout: CustomGamepadLayout;
  mode: GamepadSaveMode;
  createPanel: (layout: CustomGamepadLayout) => T;
}): { panels: T[]; selectedPanelId: string | null } {
  const matchingPanel = panels.find(panel => panel.layoutId === layout.id);

  if (mode === 'edit') {
    return {
      panels: panels.map(panel =>
        panel.layoutId === layout.id ? { ...panel, name: layout.name } : panel
      ),
      selectedPanelId,
    };
  }

  if (matchingPanel) {
    return { panels, selectedPanelId: matchingPanel.id };
  }

  const panel = createPanel(layout);
  return { panels: [...panels, panel], selectedPanelId: panel.id };
}
