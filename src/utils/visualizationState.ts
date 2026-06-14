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

// Keep an explicit flag because an empty visualization list is still valid saved state.
let hasSavedStateInMemory = false;
let savedState: VisualizationPanelState = { ...DEFAULT_VISUALIZATION_STATE };

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
  savedState = normalizeVisualizationState(state);
  hasSavedStateInMemory = true;
  
  // Also save to localStorage for persistence across sessions
  try {
    localStorage.setItem('roboboy_3d_visualization_state', JSON.stringify(savedState));
  } catch (error) {
    console.error('Failed to save visualization state to localStorage:', error);
  }
};

/**
 * Get the saved visualization state
 * @returns The saved visualization panel state
 */
export const getVisualizationState = (): VisualizationPanelState => {
  // If we have in-memory state, return that
  if (hasSavedStateInMemory) {
    return { ...savedState };
  }
  
  // Otherwise try to load from localStorage
  try {
    const savedStateStr = localStorage.getItem('roboboy_3d_visualization_state');
    if (savedStateStr) {
      const parsedState = normalizeVisualizationState(JSON.parse(savedStateStr));
      savedState = parsedState; // Update in-memory state
      hasSavedStateInMemory = true;
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
  savedState = { ...DEFAULT_VISUALIZATION_STATE };
  hasSavedStateInMemory = false;
  
  try {
    localStorage.removeItem('roboboy_3d_visualization_state');
  } catch (error) {
    console.error('Failed to clear visualization state from localStorage:', error);
  }
};
