// visualizationState.ts
// Utility to store and restore 3D panel visualization state

interface VisualizationConfig {
  id: string;
  type: string;
  topic: string;
  options?: any;
}

// Complete state for the visualization panel
export interface VisualizationPanelState {
  visualizations: VisualizationConfig[];
  fixedFrame: string;
  displayedTfFrames: string[];
  showTfFrameLabels: boolean;
  tfAxesScale: number;
}

export const DEFAULT_VISUALIZATION_STATE: VisualizationPanelState = {
  visualizations: [],
  fixedFrame: 'odom',
  displayedTfFrames: [],
  showTfFrameLabels: true,
  tfAxesScale: 0.5,
};

const DEFAULT_STORAGE_KEY = 'roboboy_3d_visualization_state';

// Keep an explicit flag because an empty visualization list is still valid saved state.
const inMemoryState = new Map<string, VisualizationPanelState>();

const normalizeVisualizationState = (
  state: Partial<VisualizationPanelState> | null | undefined
): VisualizationPanelState => ({
  visualizations: Array.isArray(state?.visualizations) ? state.visualizations : [],
  fixedFrame: state?.fixedFrame || DEFAULT_VISUALIZATION_STATE.fixedFrame,
  displayedTfFrames: Array.isArray(state?.displayedTfFrames) ? state.displayedTfFrames : [],
  showTfFrameLabels: state?.showTfFrameLabels ?? DEFAULT_VISUALIZATION_STATE.showTfFrameLabels,
  tfAxesScale: typeof state?.tfAxesScale === 'number' && Number.isFinite(state.tfAxesScale)
    ? state.tfAxesScale
    : DEFAULT_VISUALIZATION_STATE.tfAxesScale,
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
      const parsedState = normalizeVisualizationState(JSON.parse(savedStateStr));
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
