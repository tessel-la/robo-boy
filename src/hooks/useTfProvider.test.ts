
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTfProvider } from './useTfProvider';
import * as ROSLIB from 'roslib';
import { CustomTFProvider } from '../utils/tfUtils';

// Mock dependencies
vi.mock('roslib', () => {
    return {
        Ros: vi.fn(),
        Topic: vi.fn(function () {
            return {
                subscribe: vi.fn(),
                unsubscribe: vi.fn()
            }
        })
    };
});

vi.mock('../utils/tfUtils', () => ({
    CustomTFProvider: vi.fn(function () {
        return {
            fixedFrame: 'map',
            updateFixedFrame: vi.fn(),
            dispose: vi.fn(),
            lookupTransform: vi.fn(),
            subscribe: vi.fn(),
            unsubscribe: vi.fn()
        }
    })
}));

describe('useTfProvider', () => {
    let mockRos: any;
    let mockViewer: any;
    let handleTFMessage: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRos = {};
        mockViewer = {
            fixedFrame: 'odom',
            renderer: { render: vi.fn() },
            scene: {},
            camera: {}
        };
        handleTFMessage = vi.fn();
    });

    it('should initialize provider when connected', () => {
        const { result } = renderHook(() => useTfProvider({
            ros: mockRos,
            isRosConnected: true,
            ros3dViewer: { current: mockViewer },
            fixedFrame: 'map',
            initialTransforms: {},
            handleTFMessage
        }));

        expect(CustomTFProvider).toHaveBeenCalledWith('map', {});
        expect(result.current.customTFProvider.current).toBeTruthy();
    });

    it('should not initialize provider if disconnected', () => {
        const { result } = renderHook(() => useTfProvider({
            ros: mockRos,
            isRosConnected: false,
            ros3dViewer: { current: mockViewer },
            fixedFrame: 'map',
            initialTransforms: {},
            handleTFMessage
        }));

        expect(CustomTFProvider).not.toHaveBeenCalled();
        expect(result.current.customTFProvider.current).toBeNull();
    });

    it('should update fixed frame when prop changes', () => {
        const updateFixedFrameMock = vi.fn();
        (CustomTFProvider as any).mockImplementation(function () {
            return {
                fixedFrame: 'odom',
                updateFixedFrame: updateFixedFrameMock,
                dispose: vi.fn(),
                lookupTransform: vi.fn(),
                subscribe: vi.fn(),
                unsubscribe: vi.fn()
            }
        });

        const { rerender } = renderHook((props) => useTfProvider(props), {
            initialProps: {
                ros: mockRos,
                isRosConnected: true,
                ros3dViewer: { current: mockViewer },
                fixedFrame: 'odom',
                initialTransforms: {},
                handleTFMessage
            }
        });

        // Change frame
        rerender({
            ros: mockRos,
            isRosConnected: true,
            ros3dViewer: { current: mockViewer },
            fixedFrame: 'map',
            initialTransforms: {},
            handleTFMessage
        });

        // NOTE: Our mock state 'fixedFrame' is hardcoded in the re-render if using default mock,
        // so effectively the internal check `if (currentProviderFixedFrame !== normalizedNewFixedFrame)` 
        // works because our initial 'fixedFrame' in mock is 'odom' (or whatever we set).

        expect(updateFixedFrameMock).toHaveBeenCalledWith('map');
        expect(mockViewer.fixedFrame).toBe('map');
        expect(mockViewer.renderer.render).toHaveBeenCalled();
    });

    it('should subscribe to TF topics when provider is ready', () => {
        const subscribeMock = vi.fn();
        (ROSLIB.Topic as any).mockImplementation(function () {
            return {
                subscribe: subscribeMock,
                unsubscribe: vi.fn()
            }
        });

        renderHook(() => useTfProvider({
            ros: mockRos,
            isRosConnected: true,
            ros3dViewer: { current: mockViewer },
            fixedFrame: 'map',
            initialTransforms: {},
            handleTFMessage
        }));

        expect(ROSLIB.Topic).toHaveBeenCalledTimes(2); // /tf and /tf_static
        expect(subscribeMock).toHaveBeenCalledTimes(2);
    });

    it('should cleanup subscriptions on unmount', () => {
        const unsubscribeMock = vi.fn();
        (ROSLIB.Topic as any).mockImplementation(function () {
            return {
                subscribe: vi.fn(),
                unsubscribe: unsubscribeMock
            }
        });

        const { unmount } = renderHook(() => useTfProvider({
            ros: mockRos,
            isRosConnected: true,
            ros3dViewer: { current: mockViewer },
            fixedFrame: 'map',
            initialTransforms: {},
            handleTFMessage
        }));

        unmount();

        expect(unsubscribeMock).toHaveBeenCalled();
    });

    it('should ensure provider functionality methods', () => {
        const { result } = renderHook(() => useTfProvider({
            ros: mockRos,
            isRosConnected: true,
            ros3dViewer: { current: mockViewer },
            fixedFrame: 'map',
            initialTransforms: {},
            handleTFMessage
        }));

        const isValid = result.current.ensureProviderFunctionality();
        expect(isValid).toBe(true);
    });
});
