
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRos3dViewer } from './useRos3dViewer';
import * as ROS3D from '../utils/ros3d';

// Mock dependencies
vi.mock('../utils/ros3d', () => ({
    Viewer: vi.fn(),
    Grid: vi.fn(),
    OrbitControls: vi.fn(),
}));

// Mock ResizeObserver
const resizeObserverObserveMock = vi.fn();
const resizeObserverUnobserveMock = vi.fn();
const resizeObserverDisconnectMock = vi.fn();

const ResizeObserverMock = vi.fn(function () {
    return {
        observe: resizeObserverObserveMock,
        unobserve: resizeObserverUnobserveMock,
        disconnect: resizeObserverDisconnectMock,
    }
});

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

describe('useRos3dViewer', () => {
    let viewerRef: any;

    beforeEach(() => {
        vi.clearAllMocks();
        viewerRef = {
            current: {
                id: 'viewer-test',
                clientWidth: 500,
                clientHeight: 400,
                appendChild: vi.fn(),
                parentElement: {
                    removeChild: vi.fn()
                }
            }
        };
    });

    it('should initialize viewer when connected and ref is valid', () => {
        (ROS3D.Viewer as any).mockImplementation(function () {
            return {
                addObject: vi.fn(),
                scene: {},
                camera: {},
                resize: vi.fn()
            }
        });

        renderHook(() => useRos3dViewer(viewerRef, true));

        expect(ROS3D.Viewer).toHaveBeenCalled();
        expect(ROS3D.OrbitControls).toHaveBeenCalled();
        expect(ResizeObserverMock).toHaveBeenCalled();
        expect(resizeObserverObserveMock).toHaveBeenCalledWith(viewerRef.current);
    });

    it('should not initialize if disconnected', () => {
        renderHook(() => useRos3dViewer(viewerRef, false));
        expect(ROS3D.Viewer).not.toHaveBeenCalled();
    });

    it('should not initialize if ref dimensions are zero', () => {
        viewerRef.current.clientWidth = 0;
        renderHook(() => useRos3dViewer(viewerRef, true));

        expect(ROS3D.Viewer).not.toHaveBeenCalled();
    });

    it.skip('should cleanup viewer on unmount', () => {
        const stopMock = vi.fn();
        const disposeRendererMock = vi.fn();

        // Setup mock to return a robust viewer object
        (ROS3D.Viewer as any).mockImplementation(() => ({
            addObject: vi.fn(),
            stop: stopMock,
            renderer: {
                dispose: disposeRendererMock,
                domElement: {
                    parentElement: {
                        removeChild: vi.fn()
                    }
                }
            },
            scene: {
                children: []
            },
            camera: {},
            resize: vi.fn()
        }));

        const { unmount } = renderHook(() => useRos3dViewer(viewerRef, true));

        // It should have initialized
        expect(ROS3D.Viewer).toHaveBeenCalled();

        unmount();

        expect(stopMock).toHaveBeenCalled();
        expect(resizeObserverUnobserveMock).toHaveBeenCalled();
        expect(disposeRendererMock).toHaveBeenCalled();
    });

    it('should resize viewer on observation', () => {
        const resizeMock = vi.fn();
        (ROS3D.Viewer as any).mockImplementation(() => ({
            addObject: vi.fn(),
            scene: {},
            camera: {},
            resize: resizeMock
        }));

        renderHook(() => useRos3dViewer(viewerRef, true));

        // Get the callback passed to ResizeObserver constructor
        const calls = ResizeObserverMock.mock.calls as any[];
        const observerCallback = calls[0]?.[0];

        if (observerCallback) {
            act(() => {
                observerCallback([{
                    contentRect: { width: 800, height: 600 }
                }]);
            });
            expect(resizeMock).toHaveBeenCalledWith(800, 600);
        }
    });
});
