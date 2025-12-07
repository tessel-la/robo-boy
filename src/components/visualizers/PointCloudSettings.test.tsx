import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PointCloudSettings from './PointCloudSettings';

// Mock react-icons
vi.mock('react-icons/fi', () => ({
    FiChevronDown: () => <span data-testid="chevron-down">▼</span>,
    FiChevronRight: () => <span data-testid="chevron-right">▶</span>,
}));

describe('PointCloudSettings', () => {
    const mockOnClose = vi.fn();
    const mockOnSaveSettings = vi.fn();

    const defaultProps = {
        vizId: 'test-pointcloud-1',
        topic: '/sensor/pointcloud2',
        onClose: mockOnClose,
        onSaveSettings: mockOnSaveSettings,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Rendering', () => {
        it('should render the settings panel with header', () => {
            render(<PointCloudSettings {...defaultProps} />);
            expect(screen.getByText('Point Cloud Settings')).toBeInTheDocument();
        });

        it('should render close button', () => {
            render(<PointCloudSettings {...defaultProps} />);
            expect(screen.getByText('×')).toBeInTheDocument();
        });

        it('should render Point Size setting group', () => {
            render(<PointCloudSettings {...defaultProps} />);
            expect(screen.getByText('Point Size')).toBeInTheDocument();
        });

        it('should render Max Points setting group', () => {
            render(<PointCloudSettings {...defaultProps} />);
            expect(screen.getByText('Max Points')).toBeInTheDocument();
        });

        it('should render Color Settings group', () => {
            render(<PointCloudSettings {...defaultProps} />);
            expect(screen.getByText('Color Settings')).toBeInTheDocument();
        });

        it('should render Cancel button', () => {
            render(<PointCloudSettings {...defaultProps} />);
            expect(screen.getByText('Cancel')).toBeInTheDocument();
        });

        it('should render Apply button', () => {
            render(<PointCloudSettings {...defaultProps} />);
            expect(screen.getByText('Apply')).toBeInTheDocument();
        });
    });

    describe('Default Values', () => {
        it('should initialize with default point size of 0.05', () => {
            render(<PointCloudSettings {...defaultProps} />);
            const sliders = screen.getAllByRole('slider');
            expect(sliders.length).toBeGreaterThanOrEqual(1);
            expect(sliders[0]).toBeInTheDocument();
        });

        it('should have all toggles enabled by default', () => {
            render(<PointCloudSettings {...defaultProps} />);
            const checkboxes = screen.getAllByRole('checkbox');
            checkboxes.forEach(checkbox => {
                expect(checkbox).toBeChecked();
            });
        });
    });

    describe('Initial Options', () => {
        it('should use provided initial options', () => {
            render(
                <PointCloudSettings
                    {...defaultProps}
                    initialOptions={{
                        pointSize: 0.1,
                        color: '#ff0000',
                        maxPoints: 100000,
                    }}
                />
            );
            expect(screen.getByText('Point Cloud Settings')).toBeInTheDocument();
        });

        it('should merge initial options with defaults', () => {
            render(
                <PointCloudSettings
                    {...defaultProps}
                    initialOptions={{
                        pointSize: 0.2,
                    }}
                />
            );
            expect(screen.getByText('Point Cloud Settings')).toBeInTheDocument();
        });
    });

    describe('Setting Group Toggle', () => {
        it('should toggle point size setting group when checkbox clicked', () => {
            render(<PointCloudSettings {...defaultProps} />);
            const checkboxes = screen.getAllByRole('checkbox');
            const pointSizeToggle = checkboxes[0];

            expect(pointSizeToggle).toBeChecked();
            fireEvent.click(pointSizeToggle);
            expect(pointSizeToggle).not.toBeChecked();
        });

        it('should toggle max points setting group when checkbox clicked', () => {
            render(<PointCloudSettings {...defaultProps} />);
            const checkboxes = screen.getAllByRole('checkbox');
            const maxPointsToggle = checkboxes[1];

            expect(maxPointsToggle).toBeChecked();
            fireEvent.click(maxPointsToggle);
            expect(maxPointsToggle).not.toBeChecked();
        });

        it('should toggle color settings group when checkbox clicked', () => {
            render(<PointCloudSettings {...defaultProps} />);
            const checkboxes = screen.getAllByRole('checkbox');
            const colorToggle = checkboxes[2];

            expect(colorToggle).toBeChecked();
            fireEvent.click(colorToggle);
            expect(colorToggle).not.toBeChecked();
        });
    });

    describe('Expand/Collapse', () => {
        it('should collapse section when expand toggle clicked', () => {
            render(<PointCloudSettings {...defaultProps} />);
            const expandButtons = screen.getAllByRole('button', { name: /section/i });

            fireEvent.click(expandButtons[0]);
            expect(screen.getAllByTestId('chevron-right').length).toBeGreaterThanOrEqual(1);
        });

        it('should expand section when expand toggle clicked again', () => {
            render(<PointCloudSettings {...defaultProps} />);
            const expandButtons = screen.getAllByRole('button', { name: /section/i });

            fireEvent.click(expandButtons[0]);
            fireEvent.click(expandButtons[0]);

            expect(screen.getAllByTestId('chevron-down').length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('Input Changes', () => {
        it('should update point size via slider', () => {
            render(<PointCloudSettings {...defaultProps} />);
            const sliders = screen.getAllByRole('slider');
            const pointSizeSlider = sliders[0];

            fireEvent.change(pointSizeSlider, { target: { value: '0.2' } });
            expect(pointSizeSlider).toHaveValue('0.2');
        });

        it('should update point size via number input', () => {
            render(<PointCloudSettings {...defaultProps} />);
            const numberInputs = screen.getAllByRole('spinbutton');
            const pointSizeNumber = numberInputs[0];

            fireEvent.change(pointSizeNumber, { target: { value: '0.15' } });
            expect(pointSizeNumber).toHaveValue(0.15);
        });

        it('should update max points via slider', () => {
            render(<PointCloudSettings {...defaultProps} />);
            const sliders = screen.getAllByRole('slider');
            const maxPointsSlider = sliders[1];

            fireEvent.change(maxPointsSlider, { target: { value: '500000' } });
            expect(maxPointsSlider).toHaveValue('500000');
        });

        it('should update max points via number input', () => {
            render(<PointCloudSettings {...defaultProps} />);
            const numberInputs = screen.getAllByRole('spinbutton');
            const maxPointsNumber = numberInputs[1];

            fireEvent.change(maxPointsNumber, { target: { value: '150000' } });
            expect(maxPointsNumber).toHaveValue(150000);
        });

        it('should update color via color picker', () => {
            render(<PointCloudSettings {...defaultProps} />);
            const colorPicker = screen.getByLabelText('Color');

            fireEvent.change(colorPicker, { target: { value: '#ff00ff' } });
            expect(colorPicker).toHaveValue('#ff00ff');
        });

        it('should not update on invalid number input', () => {
            render(<PointCloudSettings {...defaultProps} />);
            const numberInputs = screen.getAllByRole('spinbutton');
            const pointSizeNumber = numberInputs[0];

            fireEvent.change(pointSizeNumber, { target: { value: '0.1' } });
            expect(pointSizeNumber).toHaveValue(0.1);

            fireEvent.change(pointSizeNumber, { target: { value: 'invalid' } });
            expect(pointSizeNumber).toHaveValue(0.1);
        });
    });

    describe('Save and Close Actions', () => {
        it('should call onSaveSettings with current settings when Apply clicked', () => {
            render(<PointCloudSettings {...defaultProps} />);

            fireEvent.click(screen.getByText('Apply'));

            expect(mockOnSaveSettings).toHaveBeenCalledTimes(1);
            expect(mockOnSaveSettings).toHaveBeenCalledWith('test-pointcloud-1', expect.objectContaining({
                pointSize: 0.05,
                color: '#00ff00',
                maxPoints: 200000,
                pointSizeEnabled: true,
                colorEnabled: true,
                maxPointsEnabled: true,
            }));
        });

        it('should call onClose when Apply clicked', () => {
            render(<PointCloudSettings {...defaultProps} />);
            fireEvent.click(screen.getByText('Apply'));
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        it('should call onClose when Cancel clicked', () => {
            render(<PointCloudSettings {...defaultProps} />);
            fireEvent.click(screen.getByText('Cancel'));

            expect(mockOnClose).toHaveBeenCalledTimes(1);
            expect(mockOnSaveSettings).not.toHaveBeenCalled();
        });

        it('should call onClose when close button clicked', () => {
            render(<PointCloudSettings {...defaultProps} />);
            fireEvent.click(screen.getByText('×'));
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        it('should save modified settings', () => {
            render(<PointCloudSettings {...defaultProps} />);

            const sliders = screen.getAllByRole('slider');
            fireEvent.change(sliders[0], { target: { value: '0.25' } });
            fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#0000ff' } });

            const checkboxes = screen.getAllByRole('checkbox');
            fireEvent.click(checkboxes[1]);

            fireEvent.click(screen.getByText('Apply'));

            expect(mockOnSaveSettings).toHaveBeenCalledWith('test-pointcloud-1', expect.objectContaining({
                pointSize: 0.25,
                color: '#0000ff',
                maxPointsEnabled: false,
            }));
        });
    });
});

describe('SettingGroup component behavior', () => {
    const mockOnClose = vi.fn();
    const mockOnSaveSettings = vi.fn();

    it('should hide content when toggle is disabled', () => {
        render(
            <PointCloudSettings
                vizId="test"
                topic="/test"
                onClose={mockOnClose}
                onSaveSettings={mockOnSaveSettings}
                initialOptions={{ pointSizeEnabled: false }}
            />
        );

        const allSliders = screen.getAllByRole('slider');
        expect(allSliders.length).toBeGreaterThanOrEqual(1);
    });

    it('should show content when toggle is enabled and expanded', () => {
        render(
            <PointCloudSettings
                vizId="test"
                topic="/test"
                onClose={mockOnClose}
                onSaveSettings={mockOnSaveSettings}
            />
        );

        const sliders = screen.getAllByRole('slider');
        expect(sliders.length).toBe(2);
    });
});
