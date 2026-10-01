import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import CameraView from './CameraView';
import { clearCameraSourceSizes } from '../utils/cameraStreamQuality';

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
    // These cases check the URL web_video_server is given as-is; the presets are covered below.
    streamQuality: 'original' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearCameraSourceSizes();
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

      expect(screen.getByLabelText('Camera topic')).toBeInTheDocument();
    });

    it('should show all available topics in dropdown', () => {
      render(<CameraView {...defaultProps} />);

      const options = screen.getByLabelText('Camera topic').querySelectorAll('option');
      expect(options).toHaveLength(2);
      expect(options[0]).toHaveValue('/camera/image_raw');
      expect(options[1]).toHaveValue('/camera/depth');
    });

    it('should have current topic selected', () => {
      render(<CameraView {...defaultProps} />);

      const select = screen.getByLabelText('Camera topic');
      expect(select).toHaveValue('/camera/image_raw');
    });

    it('should call onTopicChange when topic selected', () => {
      const mockOnTopicChange = vi.fn();
      render(<CameraView {...defaultProps} onTopicChange={mockOnTopicChange} />);

      const select = screen.getByLabelText('Camera topic');
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

    it('should reject invalid topic query delimiters', () => {
      const hostileTopic = '/camera/image_raw&x=<img src=x onerror=alert(1)>';
      // Offered as available, so the URL builder is what has to reject it.
      render(
        <CameraView {...defaultProps} cameraTopic={hostileTopic} availableTopics={[hostileTopic]} />
      );

      expect(screen.getByText('Failed to construct stream URL.')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('does not stream a topic that is not being published', () => {
      // A saved layout outlives its topics; streaming one anyway crashes the WebKitGTK renderer.
      render(<CameraView {...defaultProps} cameraTopic="/focus_calibration_node/focus_image" />);

      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.getByText('Camera topic is not being published.')).toBeInTheDocument();
    });

    it('streams again once the topic is published', () => {
      const { rerender } = render(
        <CameraView {...defaultProps} cameraTopic="/camera/late" availableTopics={[]} />
      );
      expect(screen.queryByRole('img')).not.toBeInTheDocument();

      rerender(<CameraView {...defaultProps} cameraTopic="/camera/late" availableTopics={['/camera/late']} />);

      expect(screen.getByRole('img')).toBeInTheDocument();
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

  describe('stream quality', () => {
    let source: { width: number; height: number } | null;
    let probes: string[];
    let panelSize: { width: number; height: number } | null;

    beforeEach(() => {
      source = { width: 1920, height: 1080 };
      probes = [];
      panelSize = null;
      // The snapshot that reveals the camera's frame size.
      vi.stubGlobal(
        'Image',
        class {
          naturalWidth = 0;
          naturalHeight = 0;
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;
          removeAttribute() {}
          set src(value: string) {
            probes.push(value);
            setTimeout(() => {
              if (!source) return this.onerror?.();
              this.naturalWidth = source.width;
              this.naturalHeight = source.height;
              this.onload?.();
            });
          }
        }
      );
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(private readonly callback: ResizeObserverCallback) {}
          observe() {
            if (panelSize) this.callback([{ contentRect: panelSize } as ResizeObserverEntry], this as never);
          }
          disconnect() {}
        }
      );
    });

    afterEach(() => vi.unstubAllGlobals());

    const props = { ...defaultProps, streamQuality: undefined };

    it('offers the presets and starts at Auto', () => {
      render(<CameraView {...props} />);

      const select = screen.getByLabelText('Stream quality');
      expect(select).toHaveValue('auto');
      expect([...select.querySelectorAll('option')].map(option => option.value)).toEqual([
        'auto',
        'low',
        'medium',
        'high',
        'original',
      ]);
    });

    it('sizes an Auto stream to the panel, in the camera aspect ratio', async () => {
      panelSize = { width: 600, height: 400 };
      render(<CameraView {...props} />);

      await waitFor(() =>
        expect(screen.getByRole('img')).toHaveAttribute(
          'src',
          '/video_stream/stream?topic=/camera/image_raw&type=mjpeg&width=640&height=360&quality=60'
        )
      );
      expect(probes).toEqual(['/video_stream/snapshot?topic=/camera/image_raw&quality=20']);
    });

    it('waits for the frame size instead of streaming a stretched picture', () => {
      render(<CameraView {...props} streamQuality="low" onStreamQualityChange={vi.fn()} />);

      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.getByText('Sizing stream...')).toBeInTheDocument();
    });

    it('caps a preset at its width and never upscales a smaller camera', async () => {
      const { unmount } = render(<CameraView {...props} streamQuality="low" onStreamQualityChange={vi.fn()} />);
      await waitFor(() =>
        expect(screen.getByRole('img').getAttribute('src')).toMatch(/&width=640&height=360&quality=40$/)
      );
      unmount();

      clearCameraSourceSizes();
      source = { width: 640, height: 480 };
      render(<CameraView {...props} streamQuality="high" onStreamQualityChange={vi.fn()} />);
      await waitFor(() =>
        expect(screen.getByRole('img')).toHaveAttribute(
          'src',
          '/video_stream/stream?topic=/camera/image_raw&type=mjpeg&quality=80'
        )
      );
    });

    it('still lowers the JPEG quality when the frame size cannot be read', async () => {
      source = null;
      render(<CameraView {...props} streamQuality="medium" onStreamQualityChange={vi.fn()} />);

      await waitFor(() =>
        expect(screen.getByRole('img')).toHaveAttribute(
          'src',
          '/video_stream/stream?topic=/camera/image_raw&type=mjpeg&quality=60'
        )
      );
    });

    it('reports a new preset to its owner', () => {
      const onStreamQualityChange = vi.fn();
      render(<CameraView {...props} streamQuality="auto" onStreamQualityChange={onStreamQualityChange} />);

      fireEvent.change(screen.getByLabelText('Stream quality'), { target: { value: 'original' } });

      expect(onStreamQualityChange).toHaveBeenCalledWith('original');
    });
  });
});
