import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { useTfProvider } from './useTfProvider';
import { CustomTFProvider } from '../utils/tfUtils';
import { subscribeToTfStream } from '../utils/tfStream';

const streamMock = vi.hoisted(() => ({
  listener: null as null | ((update: unknown) => void),
  unsubscribe: vi.fn(),
}));

vi.mock('../utils/tfStream', () => ({
  subscribeToTfStream: vi.fn((_ros, listener) => {
    streamMock.listener = listener;
    listener({ transforms: {}, changedFrames: new Set() });
    return streamMock.unsubscribe;
  }),
}));

vi.mock('../utils/tfUtils', async () => {
  const actual = await vi.importActual<typeof import('../utils/tfUtils')>('../utils/tfUtils');
  return {
    ...actual,
    CustomTFProvider: vi.fn(function CustomTFProvider(fixedFrame: string) {
      return {
        fixedFrame,
        updateTransforms: vi.fn(),
        updateFixedFrame: vi.fn(function updateFixedFrame(this: { fixedFrame: string }, next: string) {
          this.fixedFrame = next;
        }),
        dispose: vi.fn(),
        lookupTransform: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      };
    }),
  };
});

describe('useTfProvider', () => {
  let ros: any;
  let viewer: any;

  beforeEach(() => {
    vi.clearAllMocks();
    streamMock.listener = null;
    ros = {};
    viewer = { fixedFrame: '', requestRender: vi.fn() };
  });

  const renderProvider = (overrides: Record<string, unknown> = {}) => renderHook(
    props => useTfProvider(props as any),
    {
      initialProps: {
        ros,
        isRosConnected: true,
        ros3dViewer: { current: viewer },
        viewerGeneration: 1,
        fixedFrame: 'map',
        ...overrides,
      },
    }
  );

  it('initializes the provider and shared TF stream while connected', () => {
    const { result } = renderProvider();

    expect(CustomTFProvider).toHaveBeenCalledWith('map', {});
    expect(subscribeToTfStream).toHaveBeenCalledWith(ros, expect.any(Function));
    expect(result.current.customTFProvider.current).toBeTruthy();
    expect(result.current.isProviderReady).toBe(true);
  });

  it('starts before delayed viewer creation and synchronizes each viewer generation', () => {
    const viewerRef = { current: null as typeof viewer | null };
    const { result, rerender } = renderProvider({ ros3dViewer: viewerRef, viewerGeneration: 0 });

    expect(result.current.customTFProvider.current).toBeTruthy();
    expect(result.current.isProviderReady).toBe(true);

    viewerRef.current = viewer;
    rerender({
      ros,
      isRosConnected: true,
      ros3dViewer: viewerRef,
      viewerGeneration: 1,
      fixedFrame: 'map',
    });

    expect(viewer.fixedFrame).toBe('map');
    expect(viewer.requestRender).toHaveBeenCalled();
  });

  it('applies stream snapshots to the provider and exposed panel state', () => {
    const { result } = renderProvider({ trackTransformUpdates: true });
    const provider = result.current.customTFProvider.current as any;
    const transforms = {
      base_link: {
        parentFrame: 'map',
        transform: {
          translation: new THREE.Vector3(1, 2, 3),
          rotation: new THREE.Quaternion(),
        },
        isStatic: false,
      },
    };

    act(() => {
      streamMock.listener?.({ transforms, changedFrames: new Set(['base_link']) });
    });

    expect(provider.updateTransforms).toHaveBeenLastCalledWith(transforms, new Set(['base_link']));
    expect(result.current.transforms).toBe(transforms);
    expect(result.current.availableFrames).toEqual(['base_link', 'map']);

    // A pose-only update keeps the same frame list identity so "show all frames" consumers do
    // not rebuild their scene objects on every TF message.
    const framesBeforePoseUpdate = result.current.availableFrames;
    const movedTransforms = {
      base_link: { ...transforms.base_link, transform: { ...transforms.base_link.transform, translation: new THREE.Vector3(4, 5, 6) } },
    };
    act(() => {
      streamMock.listener?.({ transforms: movedTransforms, changedFrames: new Set(['base_link']) });
    });
    expect(result.current.transforms).toBe(movedTransforms);
    expect(result.current.availableFrames).toBe(framesBeforePoseUpdate);
  });

  it('updates the provider and viewer fixed frame without rebuilding subscriptions', () => {
    const { result, rerender } = renderProvider({ fixedFrame: 'odom' });
    const provider = result.current.customTFProvider.current as any;

    rerender({
      ros,
      isRosConnected: true,
      ros3dViewer: { current: viewer },
      viewerGeneration: 1,
      fixedFrame: '/map',
    });

    expect(provider.updateFixedFrame).toHaveBeenCalledWith('map');
    expect(viewer.fixedFrame).toBe('map');
    expect(subscribeToTfStream).toHaveBeenCalledTimes(1);
  });

  it('anchors an automatic fixed frame to the live tree, preferring map once it appears', () => {
    const { result } = renderProvider({ fixedFrame: '' });
    const provider = result.current.customTFProvider.current as any;
    const entry = (parentFrame: string) => ({
      parentFrame,
      transform: { translation: new THREE.Vector3(), rotation: new THREE.Quaternion() },
      isStatic: false,
    });

    expect(result.current.fixedFrame).toBe('map');

    act(() => {
      streamMock.listener?.({ transforms: { base_link: entry('odom') }, changedFrames: new Set(['base_link']) });
    });
    expect(result.current.fixedFrame).toBe('odom');
    expect(provider.updateFixedFrame).toHaveBeenLastCalledWith('odom');
    expect(viewer.fixedFrame).toBe('odom');

    act(() => {
      streamMock.listener?.({
        transforms: { base_link: entry('odom'), odom: entry('map') },
        changedFrames: new Set(['odom']),
      });
    });
    expect(result.current.fixedFrame).toBe('map');
    expect(viewer.fixedFrame).toBe('map');
    expect(result.current.availableFrames).toEqual(['base_link', 'map', 'odom']);
  });

  it('releases the shared stream and provider on unmount', () => {
    const { result, unmount } = renderProvider();
    const provider = result.current.customTFProvider.current as any;

    unmount();

    expect(streamMock.unsubscribe).toHaveBeenCalledOnce();
    expect(provider.dispose).toHaveBeenCalledOnce();
    expect(result.current.customTFProvider.current).toBeNull();
  });

  it('isolates a replacement ROS connection from the previous provider', () => {
    const { result, rerender } = renderProvider();
    const firstProvider = result.current.customTFProvider.current as any;
    const replacementRos = {};

    rerender({
      ros: replacementRos,
      isRosConnected: true,
      ros3dViewer: { current: viewer },
      viewerGeneration: 2,
      fixedFrame: 'map',
    });

    expect(streamMock.unsubscribe).toHaveBeenCalledOnce();
    expect(firstProvider.dispose).toHaveBeenCalledOnce();
    expect(subscribeToTfStream).toHaveBeenLastCalledWith(replacementRos, expect.any(Function));
    expect(result.current.customTFProvider.current).not.toBe(firstProvider);
  });

  it('does not initialize while disconnected', () => {
    const { result } = renderProvider({ isRosConnected: false });

    expect(CustomTFProvider).not.toHaveBeenCalled();
    expect(subscribeToTfStream).not.toHaveBeenCalled();
    expect(result.current.customTFProvider.current).toBeNull();
    expect(result.current.isProviderReady).toBe(false);
  });
});
