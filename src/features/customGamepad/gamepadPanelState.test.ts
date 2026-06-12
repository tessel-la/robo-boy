import { describe, expect, it } from 'vitest';
import { applySavedGamepadToPanels, CustomGamepadPanel } from './gamepadPanelState';
import type { CustomGamepadLayout } from './types';

const layout: CustomGamepadLayout = {
  id: 'custom-arm',
  name: 'Updated Arm Pad',
  gridSize: { width: 8, height: 4 },
  cellSize: 80,
  components: [],
  rosConfig: { defaultTopic: '/joy', defaultMessageType: 'sensor_msgs/msg/Joy' },
  metadata: { created: 'now', modified: 'now', version: '1.0.0' },
};

interface TestPanel extends CustomGamepadPanel {
  type: 'custom';
}

const existingPanels: TestPanel[] = [
  { id: 'panel-arm', type: 'custom', name: 'Arm Pad', layoutId: 'custom-arm' },
  { id: 'panel-drive', type: 'custom', name: 'Drive Pad', layoutId: 'custom-drive' },
];

describe('applySavedGamepadToPanels', () => {
  it('updates an open edited pad without adding or selecting another panel', () => {
    const result = applySavedGamepadToPanels({
      panels: existingPanels,
      selectedPanelId: 'panel-drive',
      layout,
      mode: 'edit',
      createPanel: () => ({ id: 'unused', type: 'custom' as const, name: layout.name, layoutId: layout.id }),
    });

    expect(result.panels).toHaveLength(2);
    expect(result.panels[0].name).toBe('Updated Arm Pad');
    expect(result.selectedPanelId).toBe('panel-drive');
  });

  it('saves an edited pad silently when it is not open', () => {
    const result = applySavedGamepadToPanels({
      panels: existingPanels.slice(1),
      selectedPanelId: 'panel-drive',
      layout,
      mode: 'edit',
      createPanel: () => ({ id: 'unused', type: 'custom' as const, name: layout.name, layoutId: layout.id }),
    });

    expect(result.panels).toEqual(existingPanels.slice(1));
    expect(result.selectedPanelId).toBe('panel-drive');
  });

  it.each(['create', 'template'] as const)('adds and selects one panel for %s saves', mode => {
    const result = applySavedGamepadToPanels({
      panels: existingPanels.slice(1),
      selectedPanelId: 'panel-drive',
      layout,
      mode,
      createPanel: () => ({ id: 'panel-new', type: 'custom' as const, name: layout.name, layoutId: layout.id }),
    });

    expect(result.panels).toHaveLength(2);
    expect(result.panels[1]).toMatchObject({ id: 'panel-new', layoutId: layout.id });
    expect(result.selectedPanelId).toBe('panel-new');
  });
});
