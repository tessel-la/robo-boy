import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VisualizationPanel from './VisualizationPanel';
import { clearVisualizationState } from '../utils/visualizationState';

vi.mock('../hooks/useRos3dViewer', () => ({
  useRos3dViewer: () => ({ ros3dViewer: { current: null } }),
}));

vi.mock('../hooks/useTfProvider', () => ({
  useTfProvider: () => ({
    customTFProvider: { current: null },
    ensureProviderFunctionality: vi.fn(),
    isProviderReady: false,
  }),
}));

vi.mock('../hooks/useTfVisualizer', () => ({
  useTfVisualizer: vi.fn(),
}));

describe('VisualizationPanel state restoration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearVisualizationState();
    localStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores settings before the initial save when there are no visualizations', () => {
    const savedState = {
      visualizations: [],
      fixedFrame: 'map',
      displayedTfFrames: ['base_link'],
      showTfFrameLabels: false,
      tfAxesScale: 1.2,
    };
    localStorage.setItem('roboboy_3d_visualization_state', JSON.stringify(savedState));

    const ros = {
      isConnected: true,
      getTopics: (onSuccess: (response: { topics: string[]; types: string[] }) => void) => {
        onSuccess({ topics: [], types: [] });
      },
    };

    render(<VisualizationPanel ros={ros as any} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: /Displayed TF Frames/i }));

    expect(screen.getByLabelText('Fixed Frame:')).toHaveValue('map');
    expect(screen.getByLabelText('TF Axes Size:')).toHaveValue('1.2');
    expect(screen.getByLabelText('Show frame labels')).not.toBeChecked();
    expect(JSON.parse(localStorage.getItem('roboboy_3d_visualization_state')!)).toEqual(savedState);
  });
});
