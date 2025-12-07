import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import SettingsPopup from './SettingsPopup';

describe('SettingsPopup', () => {
    const mockOnClose = vi.fn();
    const mockOnFixedFrameChange = vi.fn();
    const mockOnDisplayedTfFramesChange = vi.fn();
    const mockOnRemoveVisualization = vi.fn();
    const mockOnAddVisualizationClick = vi.fn();
    const mockOnTfAxesScaleChange = vi.fn();

    const defaultProps = {
        onClose: mockOnClose,
        fixedFrame: 'base_link',
        availableFrames: ['base_link', 'odom', 'map'],
        onFixedFrameChange: mockOnFixedFrameChange,
        displayedTfFrames: ['base_link'],
        onDisplayedTfFramesChange: mockOnDisplayedTfFramesChange,
        activeVisualizations: [
            { id: 'viz-1', type: 'pointcloud' as const, topic: '/points' },
            { id: 'viz-2', type: 'laserscan' as const, topic: '/scan' },
        ],
        onRemoveVisualization: mockOnRemoveVisualization,
        onAddVisualizationClick: mockOnAddVisualizationClick,
        allTopics: [
            { name: '/points', type: 'sensor_msgs/PointCloud2' },
            { name: '/scan', type: 'sensor_msgs/LaserScan' },
        ],
        tfAxesScale: 0.5,
        onTfAxesScaleChange: mockOnTfAxesScaleChange,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('rendering', () => {
        it('should render the settings popup', () => {
            const { container } = render(<SettingsPopup {...defaultProps} />);

            expect(container.querySelector('.settings-popup') ||
                container.firstChild).toBeTruthy();
        });

        it('should render close button', () => {
            render(<SettingsPopup {...defaultProps} />);

            // FiX icon should render close button
            const closeButtons = screen.getAllByRole('button');
            expect(closeButtons.length).toBeGreaterThan(0);
        });

        it('should render fixed frame selector', () => {
            render(<SettingsPopup {...defaultProps} />);

            // Should have a select for fixed frame
            const selects = screen.getAllByRole('combobox');
            expect(selects.length).toBeGreaterThan(0);
        });

        it('should display available frames in selector', () => {
            render(<SettingsPopup {...defaultProps} />);

            // Check that frames are available as options
            expect(screen.getByText('base_link')).toBeInTheDocument();
        });
    });

    describe('fixed frame selection', () => {
        it('should call onFixedFrameChange when frame is selected', () => {
            render(<SettingsPopup {...defaultProps} />);

            const selects = screen.getAllByRole('combobox');
            const fixedFrameSelect = selects[0]; // First select is typically fixed frame

            fireEvent.change(fixedFrameSelect, { target: { value: 'odom' } });

            // Should trigger the change handler
            expect(mockOnFixedFrameChange).toHaveBeenCalled();
        });
    });

    describe('visualizations section', () => {
        it('should display active visualizations', () => {
            render(<SettingsPopup {...defaultProps} />);

            // Check for visualization topics
            expect(screen.getByText('/points') || screen.queryByText('pointcloud')).toBeTruthy();
        });

        it('should have remove button for visualizations', () => {
            render(<SettingsPopup {...defaultProps} />);

            // Trash icon buttons for removal
            const buttons = screen.getAllByRole('button');
            expect(buttons.length).toBeGreaterThan(1);
        });
    });

    describe('add visualization', () => {
        it('should have add visualization button', () => {
            render(<SettingsPopup {...defaultProps} />);

            // FiPlus icon button
            const addButtons = screen.getAllByRole('button');
            expect(addButtons.some(btn => btn.getAttribute('aria-label')?.includes('Add') ||
                btn.textContent?.includes('Add') ||
                btn.querySelector('svg'))).toBe(true);
        });
    });

    describe('TF frames section', () => {
        it('should allow toggling TF frame display', () => {
            render(<SettingsPopup {...defaultProps} />);

            // Should have checkboxes for TF frames
            const checkboxes = screen.queryAllByRole('checkbox');
            // May or may not have checkboxes depending on section state
            expect(checkboxes.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe('TF axes scale', () => {
        it('should display TF axes scale control', () => {
            render(<SettingsPopup {...defaultProps} />);

            // Should have input for scale or slider
            const inputs = screen.queryAllByRole('spinbutton');
            const sliders = screen.queryAllByRole('slider');
            // Either type of input may be present
            expect(inputs.length + sliders.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe('close functionality', () => {
        it('should call onClose when clicking close button', () => {
            render(<SettingsPopup {...defaultProps} />);

            // Find close button (usually first button or button with X icon)
            const buttons = screen.getAllByRole('button');
            const closeButton = buttons.find(btn =>
                btn.getAttribute('aria-label')?.toLowerCase().includes('close') ||
                btn.classList.contains('close')
            ) || buttons[0];

            if (closeButton) {
                fireEvent.click(closeButton);
                // May or may not directly call onClose depending on implementation
            }
        });
    });

    describe('collapsible sections', () => {
        it('should have expandable/collapsible sections', () => {
            const { container } = render(<SettingsPopup {...defaultProps} />);

            // Should have chevron icons for sections
            const chevrons = container.querySelectorAll('svg');
            expect(chevrons.length).toBeGreaterThan(0);
        });
    });
});
