import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LaserScanSettings from './LaserScanSettings';

// Mock react-icons
vi.mock('react-icons/fi', () => ({
    FiChevronDown: () => <span data-testid="chevron-down">▼</span>,
    FiChevronRight: () => <span data-testid="chevron-right">▶</span>,
}));

describe('LaserScanSettings', () => {
    const mockOnClose = vi.fn();
    const mockOnSaveSettings = vi.fn();

    const defaultProps = {
        vizId: 'test-viz-1',
        topic: '/scan/laser_scan',
        onClose: mockOnClose,
        onSaveSettings: mockOnSaveSettings,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Rendering', () => {
        it('should render the settings panel', () => {
            render(<LaserScanSettings {...defaultProps} />);
            expect(screen.getByText(/LaserScan Settings/)).toBeInTheDocument();
        });

        it('should display the short topic name', () => {
            render(<LaserScanSettings {...defaultProps} />);
            expect(screen.getByText('laser_scan')).toBeInTheDocument();
        });

        it('should display full topic name if no slash', () => {
            render(<LaserScanSettings {...defaultProps} topic="laser_scan" />);
            expect(screen.getByText('laser_scan')).toBeInTheDocument();
        });

        it('should render point size slider', () => {
            render(<LaserScanSettings {...defaultProps} />);
            expect(screen.getByLabelText(/Point Size/)).toBeInTheDocument();
        });

        it('should render point color picker', () => {
            render(<LaserScanSettings {...defaultProps} />);
            expect(screen.getByLabelText(/Point Color/)).toBeInTheDocument();
        });

        it('should render min range input', () => {
            render(<LaserScanSettings {...defaultProps} />);
            expect(screen.getByLabelText(/Min Range/)).toBeInTheDocument();
        });

        it('should render max range input', () => {
            render(<LaserScanSettings {...defaultProps} />);
            expect(screen.getByLabelText(/Max Range/)).toBeInTheDocument();
        });

        it('should render Save & Close button', () => {
            render(<LaserScanSettings {...defaultProps} />);
            expect(screen.getByText('Save & Close')).toBeInTheDocument();
        });

        it('should render Cancel button', () => {
            render(<LaserScanSettings {...defaultProps} />);
            expect(screen.getByText('Cancel')).toBeInTheDocument();
        });

        it('should render close button with X', () => {
            render(<LaserScanSettings {...defaultProps} />);
            expect(screen.getByLabelText('Close settings')).toBeInTheDocument();
        });
    });

    describe('Initial Values', () => {
        it('should use default values when no initial options provided', () => {
            render(<LaserScanSettings {...defaultProps} />);
            const pointSizeInput = screen.getByRole('slider');
            expect(pointSizeInput).toHaveValue('1');
        });

        it('should use provided initial options', () => {
            render(
                <LaserScanSettings
                    {...defaultProps}
                    initialOptions={{
                        pointSize: 2.5,
                        pointColor: '#ff0000',
                        minRange: 0.5,
                        maxRange: 50.0,
                    }}
                />
            );
            const pointSizeInput = screen.getByRole('slider');
            expect(pointSizeInput).toHaveValue('2.5');
        });
    });

    describe('User Interactions', () => {
        it('should update point size when slider changes', () => {
            render(<LaserScanSettings {...defaultProps} />);
            const slider = screen.getByRole('slider');
            fireEvent.change(slider, { target: { value: '2.5' } });
            expect(slider).toHaveValue('2.5');
        });

        it('should update color when color picker changes', () => {
            render(<LaserScanSettings {...defaultProps} />);
            const colorPicker = screen.getByLabelText(/Point Color/);
            fireEvent.change(colorPicker, { target: { value: '#ff0000' } });
            expect(colorPicker).toHaveValue('#ff0000');
        });

        it('should update min range when input changes', () => {
            render(<LaserScanSettings {...defaultProps} />);
            const minRangeInput = screen.getByLabelText(/Min Range/);
            fireEvent.change(minRangeInput, { target: { value: '1.5' } });
            expect(minRangeInput).toHaveValue(1.5);
        });

        it('should update max range when input changes', () => {
            render(<LaserScanSettings {...defaultProps} />);
            const maxRangeInput = screen.getByLabelText(/Max Range/);
            fireEvent.change(maxRangeInput, { target: { value: '75.0' } });
            expect(maxRangeInput).toHaveValue(75);
        });

        it('should handle empty string for number inputs', () => {
            render(<LaserScanSettings {...defaultProps} />);
            const minRangeInput = screen.getByLabelText(/Min Range/);
            fireEvent.change(minRangeInput, { target: { value: '' } });
            expect(minRangeInput).toHaveValue(null);
        });
    });

    describe('Save and Close Actions', () => {
        it('should call onSaveSettings and onClose when Save & Close clicked', () => {
            render(<LaserScanSettings {...defaultProps} />);
            const saveButton = screen.getByText('Save & Close');
            fireEvent.click(saveButton);

            expect(mockOnSaveSettings).toHaveBeenCalledTimes(1);
            expect(mockOnSaveSettings).toHaveBeenCalledWith('test-viz-1', expect.objectContaining({
                pointSize: 1.0,
                pointColor: '#0000ff',
                minRange: 0.0,
                maxRange: 100.0,
            }));
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        it('should call onClose when Cancel clicked', () => {
            render(<LaserScanSettings {...defaultProps} />);
            const cancelButton = screen.getByText('Cancel');
            fireEvent.click(cancelButton);

            expect(mockOnClose).toHaveBeenCalledTimes(1);
            expect(mockOnSaveSettings).not.toHaveBeenCalled();
        });

        it('should call onClose when X button clicked', () => {
            render(<LaserScanSettings {...defaultProps} />);
            const closeButton = screen.getByLabelText('Close settings');
            fireEvent.click(closeButton);

            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        it('should save modified values', () => {
            render(<LaserScanSettings {...defaultProps} />);

            fireEvent.change(screen.getByRole('slider'), { target: { value: '3.0' } });
            fireEvent.change(screen.getByLabelText(/Point Color/), { target: { value: '#00ff00' } });

            fireEvent.click(screen.getByText('Save & Close'));

            expect(mockOnSaveSettings).toHaveBeenCalledWith('test-viz-1', expect.objectContaining({
                pointSize: 3.0,
                pointColor: '#00ff00',
            }));
        });
    });

    describe('Point Size Display', () => {
        it('should display point size value with 2 decimal places', () => {
            render(<LaserScanSettings {...defaultProps} initialOptions={{ pointSize: 2.5 }} />);
            expect(screen.getByText(/2\.50/)).toBeInTheDocument();
        });
    });
});
