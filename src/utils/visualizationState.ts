// visualizationState.ts
// Utility to store and restore 3D panel visualization state

interface VisualizationConfig {
  id: string;
  type: string;
  topic: string;
  options?: any;
}

// Complete state for the visualization panel
interface VisualizationPanelState {
  visualizations: VisualizationConfig[];
  fixedFrame: string;
  displayedTfFrames: string[];
}

// Global state to store visualizations
let savedState: VisualizationPanelState = {
  visualizations: [],
  fixedFrame: 'odom',
  displayedTfFrames: []
};

/**
 * Save the current state of the visualization panel
 * @param state Current visualization panel state
 */
export const saveVisualizationState = (state: VisualizationPanelState): void => {
  savedState = { ...state };
  
  // Also save to localStorage for persistence across sessions
  try {
    localStorage.setItem('roboboy_3d_visualization_state', JSON.stringify(state));
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
  if (savedState.visualizations.length > 0) {
    return { ...savedState };
  }
  
  // Otherwise try to load from localStorage
  try {
    const savedStateStr = localStorage.getItem('roboboy_3d_visualization_state');
    if (savedStateStr) {
      const parsedState = JSON.parse(savedStateStr);
      savedState = parsedState; // Update in-memory state
      return parsedState;
    }
  } catch (error) {
    console.error('Failed to load visualization state from localStorage:', error);
  }
  
  // Return default state if nothing is saved
  return {
    visualizations: [],
    fixedFrame: 'odom',
    displayedTfFrames: []
  };
};

/**
 * Clear the saved visualization state
 */
export const clearVisualizationState = (): void => {
  savedState = {
    visualizations: [],
    fixedFrame: 'odom',
    displayedTfFrames: []
  };
  
  try {
    localStorage.removeItem('roboboy_3d_visualization_state');
  } catch (error) {
    console.error('Failed to clear visualization state from localStorage:', error);
  }
}; 