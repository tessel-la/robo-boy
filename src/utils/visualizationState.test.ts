import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveVisualizationState, getVisualizationState, clearVisualizationState } from './visualizationState';

describe('visualizationState', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    // Clear internal state by calling clear
    clearVisualizationState();
  });

  const mockState = {
    visualizations: [{ id: '1', type: 'scan', topic: '/scan' }],
    fixedFrame: 'map',
    displayedTfFrames: ['base_link'],
    showTfFrameLabels: false,
    tfAxesScale: 1.2,
  };

  it('should save state to memory and localStorage', () => {
    saveVisualizationState(mockState);

    // Check localStorage
    const stored = localStorage.getItem('roboboy_3d_visualization_state');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toEqual(mockState);

    // Check retrieval
    const retrieved = getVisualizationState();
    expect(retrieved).toEqual(mockState);
  });

  it('should return default state if nothing saved', () => {
    const state = getVisualizationState();
    expect(state).toEqual({
      visualizations: [],
      fixedFrame: 'odom',
      displayedTfFrames: [],
      showTfFrameLabels: true,
      tfAxesScale: 0.5,
    });
  });

  it('should load from localStorage if memory is empty', () => {
    localStorage.setItem('roboboy_3d_visualization_state', JSON.stringify(mockState));

    // Ensure memory is empty implicitly (beforeEach clears it, but the module variable persists across tests likely unless reset)
    // Actually the module var `savedState` is global to the module.
    // `clearVisualizationState()` in beforeEach handles this.

    const state = getVisualizationState();
    expect(state).toEqual(mockState);
  });

  it('should prioritize memory overly localStorage', () => {
    const memState = { ...mockState, fixedFrame: 'base_link' };
    saveVisualizationState(memState);

    // Verify it's returned
    expect(getVisualizationState()).toEqual(memState);

    // Even if we mess with local storage
    localStorage.setItem('roboboy_3d_visualization_state', JSON.stringify(mockState));
    expect(getVisualizationState()).toEqual(memState);
  });

  it('should keep empty-visualization state in memory', () => {
    const emptyState = {
      ...mockState,
      visualizations: [],
      fixedFrame: 'base_link',
    };
    saveVisualizationState(emptyState);

    localStorage.setItem('roboboy_3d_visualization_state', JSON.stringify(mockState));

    expect(getVisualizationState()).toEqual(emptyState);
  });

  it('should preserve URDF topic and options', () => {
    const urdfState = {
      ...mockState,
      visualizations: [{
        id: 'urdf-1',
        type: 'urdf',
        topic: '/robot/robot_description',
        options: {
          robotDescriptionTopic: '/robot/robot_description',
          urdfPath: '/robot_meshes/',
        },
      }],
    };

    saveVisualizationState(urdfState);

    expect(getVisualizationState()).toEqual(urdfState);
    expect(JSON.parse(localStorage.getItem('roboboy_3d_visualization_state')!)).toEqual(urdfState);
  });

  it('should clear state', () => {
    saveVisualizationState(mockState);
    clearVisualizationState();

    expect(localStorage.getItem('roboboy_3d_visualization_state')).toBeNull();
    expect(getVisualizationState().visualizations).toHaveLength(0);
  });

  it('should handle localStorage errors gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

    // Mock setItem to throw
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });

    saveVisualizationState(mockState);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should default old saved state to showing TF frame labels', () => {
    const oldState = {
      visualizations: [{ id: '1', type: 'scan', topic: '/scan' }],
      fixedFrame: 'map',
      displayedTfFrames: ['base_link']
    };

    localStorage.setItem('roboboy_3d_visualization_state', JSON.stringify(oldState));

    expect(getVisualizationState()).toEqual({
      ...oldState,
      showTfFrameLabels: true,
      tfAxesScale: 0.5,
    });
  });
});
