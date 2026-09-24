import type { BuiltInPanelCatalogEntry, BuiltInPanelId, PanelCatalogEntry, ResolvedPanelManifest } from './types';

export const LEGACY_TIME_SERIES_ID = 'la.tessel.roboboy.timeseries';

export const BUILT_IN_PANELS: readonly BuiltInPanelCatalogEntry[] = [
  {
    id: 'camera',
    name: 'Camera',
    menuLabel: 'Camera',
    description: 'Stream a ROS image topic.',
    version: 'built-in',
    capabilities: ['ros', 'network'],
    icon: 'camera',
    source: 'built-in',
  },
  {
    id: '3d',
    name: '3D view',
    menuLabel: '3D panel',
    description: 'Visualize ROS topics, TF, URDF, and point clouds in 3D.',
    version: 'built-in',
    capabilities: ['ros', 'network', 'storage'],
    icon: '3d',
    source: 'built-in',
  },
  {
    id: 'behaviorTree',
    name: 'Behavior tree',
    menuLabel: 'Behavior tree',
    description: 'Create, run, and monitor robot behavior trees.',
    version: 'built-in',
    capabilities: ['ros', 'network', 'storage'],
    icon: 'behaviorTree',
    source: 'built-in',
  },
  {
    id: 'tfTree',
    name: 'TF tree',
    menuLabel: 'TF tree',
    description: 'Inspect the live ROS transform tree.',
    version: 'built-in',
    capabilities: ['ros'],
    icon: 'tfTree',
    source: 'built-in',
  },
  {
    id: 'pad',
    name: 'Pad controls',
    menuLabel: 'Pad controls',
    description: 'Use a configurable robot control pad.',
    version: 'built-in',
    capabilities: ['ros', 'storage'],
    icon: 'pad',
    source: 'built-in',
  },
  {
    id: 'timeSeries',
    name: 'Time Series',
    menuLabel: 'Time Series',
    description: 'Plot and analyze live ROS signals.',
    version: 'built-in',
    capabilities: ['ros', 'storage'],
    icon: 'timeSeries',
    source: 'built-in',
  },
  {
    id: 'recordReplay',
    name: 'Record & Replay',
    menuLabel: 'Record & Replay',
    description: 'Record ROS topics and replay local MCAP files across visualization panels.',
    version: 'built-in',
    capabilities: ['ros', 'storage'],
    icon: 'recordReplay',
    source: 'built-in',
  },
];

const builtInPanelIds = new Set<string>(BUILT_IN_PANELS.map(panel => panel.id));

export const isBuiltInPanelId = (id: string): id is BuiltInPanelId => builtInPanelIds.has(id);

export const createPanelCatalog = (externalPanels: readonly ResolvedPanelManifest[]): PanelCatalogEntry[] => [
  ...BUILT_IN_PANELS,
  ...externalPanels
    .filter(panel => panel.id !== LEGACY_TIME_SERIES_ID)
    .map(
      (manifest): PanelCatalogEntry => ({
        id: manifest.id,
        name: manifest.name,
        menuLabel: manifest.name,
        description: manifest.description,
        version: manifest.version,
        capabilities: manifest.capabilities || [],
        icon: 'external',
        source: 'external',
        manifest,
      })
    ),
];
