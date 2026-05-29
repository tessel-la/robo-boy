import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUrdfClient } from './useUrdfClient';
import * as ROS3D from '../utils/ros3d';

// Mock dependencies
vi.mock('../utils/ros3d', () => ({
    UrdfClient: vi.fn(),
    Viewer: vi.fn(),
}));

describe('useUrdfClient', () => {
    let props: any;
    let urdfClientMock: any;
    let disposeMock: any;

    beforeEach(() => {
        vi.clearAllMocks();

        disposeMock = vi.fn();
        urdfClientMock = {
            dispose: disposeMock
        };

        (ROS3D.UrdfClient as any).mockImplementation(function () { return urdfClientMock; });

        props = {
            ros: { isRos: true },
            isRosConnected: true,
            ros3dViewer: { current: { scene: {} } },
            tfClient: { current: {} },
            robotDescriptionTopic: '/robot_description'
        };
    });

    it('should initialize UrdfClient when connected and dependencies exist', () => {
        renderHook(() => useUrdfClient(props));

        expect(ROS3D.UrdfClient).toHaveBeenCalledWith(expect.objectContaining({
            ros: props.ros,
            tfClient: props.tfClient.current,
            rootObject: props.ros3dViewer.current.scene,
            robotDescriptionTopic: props.robotDescriptionTopic
        }));
    });

    it('should not initialize if ros is disconnected', () => {
        props.isRosConnected = false;
        renderHook(() => useUrdfClient(props));
        expect(ROS3D.UrdfClient).not.toHaveBeenCalled();
    });

    it('should not initialize if viewer is missing', () => {
        props.ros3dViewer = { current: null };
        renderHook(() => useUrdfClient(props));
        expect(ROS3D.UrdfClient).not.toHaveBeenCalled();
    });

    it('should cleanup on disconnect', () => {
        const { rerender } = renderHook((p) => useUrdfClient(p), { initialProps: props });

        expect(ROS3D.UrdfClient).toHaveBeenCalled();

        // Disconnect
        rerender({
            ...props,
            isRosConnected: false
        });

        expect(disposeMock).toHaveBeenCalled();
    });

    it('should cleanup on unmount', () => {
        const { unmount } = renderHook(() => useUrdfClient(props));
        unmount();
        expect(disposeMock).toHaveBeenCalled();
    });

    it('should set loaded state when loading completes', () => {
        let onCompleteCallback: any;
        (ROS3D.UrdfClient as any).mockImplementation(function (options: any) {
            onCompleteCallback = options.onComplete;
            return urdfClientMock;
        });

        const { result } = renderHook(() => useUrdfClient(props));

        act(() => {
            onCompleteCallback({});
        });

        expect(result.current.isUrdfLoaded).toBe(true);
    });
});
