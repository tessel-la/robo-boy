import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLaserScanClient } from './useLaserScanClient';
import * as ROS3D from '../utils/ros3d';

// Mock dependencies
vi.mock('../utils/ros3d', () => ({
    LaserScan: vi.fn(),
    Viewer: vi.fn(),
}));

describe('useLaserScanClient', () => {
    let props: any;
    let laserScanMock: any;
    let unsubscribeMock: any;

    beforeEach(() => {
        vi.clearAllMocks();

        unsubscribeMock = vi.fn();
        laserScanMock = {
            unsubscribe: unsubscribeMock,
            topicName: '/scan',
            fixedFrame: 'binary_link' // Typo intentional to check update logic if needed, initially matches props
        };

        // Mock Constructor correctly
        (ROS3D.LaserScan as any).mockImplementation(function () {
            return laserScanMock;
        });

        props = {
            ros: { isRos: true },
            isRosConnected: true,
            ros3dViewer: { current: { scene: {} } },
            customTFProvider: { current: {} },
            fixedFrame: 'base_link',
            selectedLaserScanTopic: '/scan',
            clientRef: { current: null },
            material: { pointSize: 2, pointColor: 0xff0000 },
            options: { maxRange: 10 }
        };
        // Align mock state
        laserScanMock.fixedFrame = props.fixedFrame;
    });

    it('should initialize LaserScan when connected and valid', () => {
        renderHook(() => useLaserScanClient(props));

        expect(ROS3D.LaserScan).toHaveBeenCalledWith(expect.objectContaining({
            ros: props.ros,
            topic: props.selectedLaserScanTopic,
            rootObject: props.ros3dViewer.current.scene,
            fixedFrame: props.fixedFrame,
            maxRange: 10
        }));

        expect(props.clientRef.current).toBe(laserScanMock);
    });

    it('should not initialize if disconnected', () => {
        props.isRosConnected = false;
        renderHook(() => useLaserScanClient(props));
        expect(ROS3D.LaserScan).not.toHaveBeenCalled();
    });

    it('should recreate client if topic changes', () => {
        const { rerender } = renderHook((p) => useLaserScanClient(p), { initialProps: props });

        expect(ROS3D.LaserScan).toHaveBeenCalledTimes(1);

        // Change topic
        laserScanMock.topicName = props.selectedLaserScanTopic; // ensure current mock matches old prop

        rerender({
            ...props,
            selectedLaserScanTopic: '/scan_new'
        });

        expect(unsubscribeMock).toHaveBeenCalled();
        expect(ROS3D.LaserScan).toHaveBeenCalledTimes(2);
        // Verify second call args
        expect(ROS3D.LaserScan).toHaveBeenLastCalledWith(expect.objectContaining({
            topic: '/scan_new'
        }));
    });

    it('should recreate client if fixedFrame changes', () => {
        const { rerender } = renderHook((p) => useLaserScanClient(p), { initialProps: props });

        // Change frame
        rerender({
            ...props,
            fixedFrame: 'map'
        });

        expect(unsubscribeMock).toHaveBeenCalled();
        expect(ROS3D.LaserScan).toHaveBeenCalledTimes(2);
        expect(ROS3D.LaserScan).toHaveBeenLastCalledWith(expect.objectContaining({
            fixedFrame: 'map'
        }));
    });

    it('should cleanup on unmount', () => {
        const { unmount } = renderHook(() => useLaserScanClient(props));
        unmount();
        expect(unsubscribeMock).toHaveBeenCalled();
        expect(props.clientRef.current).toBeNull();
    });

    it('should cleanup if dependencies become invalid', () => {
        const { rerender } = renderHook((p) => useLaserScanClient(p), { initialProps: props });

        rerender({ ...props, isRosConnected: false });
        expect(unsubscribeMock).toHaveBeenCalled();
    });
});
