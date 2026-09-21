// visualizationState.ts
// Utility to store and restore 3D panel visualization state

interface VisualizationConfig {
  id: string;
  type: string;
  topic: string;
  options?: any;
}

/** How displayed TF frames are drawn — the "Frame display" settings of the 3D menu. */
export interface TfDisplaySettings {
  showTfAxes: boolean;
  showTfFrameLabels: boolean;
  showTfConnections: boolean;
  tfAxesScale: number;
  /** Label height in scene metres, independent of the axes so small axes can keep readable names. */
  tfLabelScale: number;
  tfAxesOpacity: number;
  tfLabelOpacity: number;
  /** Draw the dark pill behind frame names; off leaves outlined text over the scene. */
  showTfLabelBackground: boolean;
}

export const DEFAULT_TF_DISPLAY_SETTINGS: TfDisplaySettings = {
  showTfAxes: true,
  showTfFrameLabels: true,
  showTfConnections: true,
  // Microduck is only ~0.25 m tall; 0.5 m axes overwhelm compact robots.
  tfAxesScale: 0.1,
  tfLabelScale: 0.12,
  tfAxesOpacity: 1,
  tfLabelOpacity: 1,
  showTfLabelBackground: true,
};

// Complete state for the visualization panel
export interface VisualizationPanelState extends TfDisplaySettings {
  visualizations: VisualizationConfig[];
  /** '' means auto: the panel picks a frame from the live TF tree (see `resolveFixedFrame`). */
  fixedFrame: string;
  displayedTfFrames: string[];
  /** Show every frame in the TF tree, including ones that appear later; `displayedTfFrames` is
   * then only the snapshot to fall back to when the toggle is switched off again. */
  showAllTfFrames: boolean;
}

export const DEFAULT_VISUALIZATION_STATE: VisualizationPanelState = {
  visualizations: [],
  fixedFrame: '',
  displayedTfFrames: [],
  showAllTfFrames: false,
  ...DEFAULT_TF_DISPLAY_SETTINGS,
};

export const pickTfDisplaySettings = (state: TfDisplaySettings): TfDisplaySettings => ({
  showTfAxes: state.showTfAxes,
  showTfFrameLabels: state.showTfFrameLabels,
  showTfConnections: state.showTfConnections,
  tfAxesScale: state.tfAxesScale,
  tfLabelScale: state.tfLabelScale,
  tfAxesOpacity: state.tfAxesOpacity,
  tfLabelOpacity: state.tfLabelOpacity,
  showTfLabelBackground: state.showTfLabelBackground,
});

const DEFAULT_STORAGE_KEY = 'roboboy_3d_visualization_state';

// Keep an explicit flag because an empty visualization list is still valid saved state.
const inMemoryState = new Map<string, VisualizationPanelState>();

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const normalizeVisualizationState = (
  state: Partial<VisualizationPanelState> | null | undefined,
  migrateLegacyAxesScale = false
): VisualizationPanelState => ({
  visualizations: Array.isArray(state?.visualizations) ? state.visualizations : [],
  fixedFrame: typeof state?.fixedFrame === 'string' ? state.fixedFrame : DEFAULT_VISUALIZATION_STATE.fixedFrame,
  displayedTfFrames: Array.isArray(state?.displayedTfFrames) ? state.displayedTfFrames : [],
  showAllTfFrames: state?.showAllTfFrames ?? DEFAULT_VISUALIZATION_STATE.showAllTfFrames,
  showTfAxes: state?.showTfAxes ?? DEFAULT_VISUALIZATION_STATE.showTfAxes,
  showTfFrameLabels: state?.showTfFrameLabels ?? DEFAULT_VISUALIZATION_STATE.showTfFrameLabels,
  showTfConnections: state?.showTfConnections ?? DEFAULT_VISUALIZATION_STATE.showTfConnections,
  tfAxesScale: migrateLegacyAxesScale && state?.tfAxesScale === 0.5
    ? DEFAULT_VISUALIZATION_STATE.tfAxesScale
    : finiteOr(state?.tfAxesScale, DEFAULT_VISUALIZATION_STATE.tfAxesScale),
  tfLabelScale: finiteOr(state?.tfLabelScale, DEFAULT_VISUALIZATION_STATE.tfLabelScale),
  tfAxesOpacity: finiteOr(state?.tfAxesOpacity, DEFAULT_VISUALIZATION_STATE.tfAxesOpacity),
  tfLabelOpacity: finiteOr(state?.tfLabelOpacity, DEFAULT_VISUALIZATION_STATE.tfLabelOpacity),
  showTfLabelBackground: state?.showTfLabelBackground ?? DEFAULT_VISUALIZATION_STATE.showTfLabelBackground,
});

/**
 * Save the current state of the visualization panel
 * @param state Current visualization panel state
 */
export const saveVisualizationState = (state: VisualizationPanelState): void => {
  saveVisualizationStateForKey(DEFAULT_STORAGE_KEY, state);
};

export const saveVisualizationStateForKey = (storageKey: string, state: VisualizationPanelState): void => {
  const normalizedState = normalizeVisualizationState(state);
  inMemoryState.set(storageKey, normalizedState);
  
  // Also save to localStorage for persistence across sessions
  try {
    localStorage.setItem(storageKey, JSON.stringify(normalizedState));
  } catch (error) {
    console.error('Failed to save visualization state to localStorage:', error);
  }
};

/**
 * Get the saved visualization state
 * @returns The saved visualization panel state
 */
export const getVisualizationState = (): VisualizationPanelState => {
  return getVisualizationStateForKey(DEFAULT_STORAGE_KEY);
};

export const getVisualizationStateForKey = (storageKey: string): VisualizationPanelState => {
  // If we have in-memory state, return that
  const savedState = inMemoryState.get(storageKey);
  if (savedState) {
    return { ...savedState };
  }
  
  // Otherwise try to load from localStorage
  try {
    const savedStateStr = localStorage.getItem(storageKey);
    if (savedStateStr) {
      // 0.5 m was the old default and overwhelms 0.25 m-class robots. Migrate
      // persisted panels once; newly chosen scales remain untouched on save.
      const parsedState = normalizeVisualizationState(JSON.parse(savedStateStr), true);
      inMemoryState.set(storageKey, parsedState);
      return parsedState;
    }
  } catch (error) {
    console.error('Failed to load visualization state from localStorage:', error);
  }
  
  // Return default state if nothing is saved
  return { ...DEFAULT_VISUALIZATION_STATE };
};

/**
 * Clear the saved visualization state
 */
export const clearVisualizationState = (): void => {
  clearVisualizationStateForKey(DEFAULT_STORAGE_KEY);
};

export const clearVisualizationStateForKey = (storageKey: string): void => {
  inMemoryState.delete(storageKey);
  
  try {
    localStorage.removeItem(storageKey);
  } catch (error) {
    console.error('Failed to clear visualization state from localStorage:', error);
  }
};
