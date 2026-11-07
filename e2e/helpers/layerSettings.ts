import type { Locator } from '@playwright/test';

/** Opens one layer's settings view from the 3D menu's Visualizations list. */
export const openLayerSettings = (panel: Locator, type: string, topic: string) =>
  panel.getByRole('button', { name: `Edit ${type} visualization for topic ${topic}`, exact: true }).click();

/** Returns from a layer's settings view to the Visualizations list. */
export const backToLayers = (panel: Locator) =>
  panel.getByRole('button', { name: 'Back to 3D view settings', exact: true }).click();
