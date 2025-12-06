import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import CameraView from './CameraView';

// Mock ROSLIB.Ros
const createMockRos = (isConnected: boolean = true) => ({
    isConnected,
    on: vi.fn(),
    close: vi.fn(),
});

describe('CameraView', () => {
    const defaultProps = {
        ros: createMockRos(true) as any,
        cameraTopic: '/camera/image_raw',
        availableTopics: ['/camera/image_raw', '/camera/depth'],
        onTopicChange: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('rendering', () => {
        it('should render the camera view container', () => {
            const { container } = render(<CameraView {...defaultProps} />);

            expect(container.querySelector('.camera-view')).toBeInTheDocument();
        });

        it('should render stream container', () => {
            const { container } = render(<CameraView {...defaultProps} />);

            expect(container.querySelector('.camera-stream-container')).toBeInTheDocument();
        });

        it('should render image element when connected', () => {
            render(<CameraView {...defaultProps} />);

            const img = screen.getByRole('img');
            expect(img).toBeInTheDocument();
        });

        it('should construct correct stream URL', () => {
            render(<CameraView {...defaultProps} />);

            const img = screen.getByRole('img');
            expect(img).toHaveAttribute('src', '/video_stream/stream?topic=/camera/image_raw&type=mjpeg');
        });
    });

    describe('topic selector', () => {
        it('should render topic selector when topics available', () => {
            render(<CameraView {...defaultProps} />);

            expect(screen.getByRole('combobox')).toBeInTheDocument();
        });

        it('should show all available topics in dropdown', () => {
            render(<CameraView {...defaultProps} />);

            const options = screen.getAllByRole('option');
            expect(options).toHaveLength(2);
            expect(options[0]).toHaveValue('/camera/image_raw');
            expect(options[1]).toHaveValue('/camera/depth');
        });

        it('should have current topic selected', () => {
            render(<CameraView {...defaultProps} />);

            const select = screen.getByRole('combobox');
            expect(select).toHaveValue('/camera/image_raw');
        });

        it('should call onTopicChange when topic selected', () => {
            const mockOnTopicChange = vi.fn();
            render(<CameraView {...defaultProps} onTopicChange={mockOnTopicChange} />);

            const select = screen.getByRole('combobox');
            fireEvent.change(select, { target: { value: '/camera/depth' } });

            expect(mockOnTopicChange).toHaveBeenCalledWith('/camera/depth');
        });

        it('should not render selector when no topics available', () => {
            render(<CameraView {...defaultProps} availableTopics={[]} />);

            expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        });
    });

    describe('stream URL construction', () => {
        it('should include width when provided', () => {
            render(<CameraView {...defaultProps} streamWidth={640} />);

            const img = screen.getByRole('img');
            expect(img.getAttribute('src')).toContain('width=640');
        });

        it('should include height when provided', () => {
            render(<CameraView {...defaultProps} streamHeight={480} />);

            const img = screen.getByRole('img');
            expect(img.getAttribute('src')).toContain('height=480');
        });

        it('should include custom stream type', () => {
            render(<CameraView {...defaultProps} streamType="ros_compressed" />);

            const img = screen.getByRole('img');
            expect(img.getAttribute('src')).toContain('type=ros_compressed');
        });
    });

    describe('connection states', () => {
        it('should show error when ROS not connected', () => {
            const disconnectedRos = createMockRos(false);
            render(<CameraView {...defaultProps} ros={disconnectedRos as any} />);

            expect(screen.getByText('Connecting...')).toBeInTheDocument();
        });

        it('should show message when no camera topic selected', () => {
            render(<CameraView {...defaultProps} cameraTopic="" />);

            expect(screen.getByText('No camera topic selected.')).toBeInTheDocument();
        });
    });

    describe('error handling', () => {
        it('should display error message when error state', () => {
            const { container } = render(<CameraView {...defaultProps} cameraTopic="" />);

            expect(container.querySelector('.error-message')).toBeInTheDocument();
        });
    });

    describe('alt text', () => {
        it('should have descriptive alt text for image', () => {
            render(<CameraView {...defaultProps} />);

            const img = screen.getByRole('img');
            expect(img).toHaveAttribute('alt', 'Stream for /camera/image_raw');
        });
    });
});
