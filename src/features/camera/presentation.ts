import { useEffect, useRef } from 'react';
import { createPanelPresentationRegistry } from '../../panels/presentationRegistry';

export interface CameraSnapshot {
  topic: string;
  topics: readonly string[];
  source: HTMLImageElement | HTMLCanvasElement | null;
  /** null for MJPEG: browsers do not expose a per-frame counter for an image stream. */
  revision: number | null;
  message: string;
  recorded: boolean;
}
export interface CameraPresentation {
  snapshot(): CameraSnapshot;
  selectTopic(topic: string): void;
  retry(): void;
  setPresented(active: boolean): void;
}
const registry = createPanelPresentationRegistry<CameraPresentation>();
export const getCameraPresentation = registry.get;
export const registerCameraPresentation = registry.register;

/** The mounted tile owns acquisition and settings; XR only consumes its current decoded frame. */
export function useCameraPresentation(
  panelId: string | undefined,
  storageScope: string | undefined,
  presentation: CameraPresentation
) {
  const current = useRef(presentation);
  current.current = presentation;
  useEffect(() => {
    if (!panelId) return;
    return registerCameraPresentation(
      panelId,
      {
        snapshot: () => current.current.snapshot(),
        selectTopic: topic => current.current.selectTopic(topic),
        retry: () => current.current.retry(),
        setPresented: active => current.current.setPresented(active),
      },
      storageScope
    );
  }, [panelId, storageScope]);
}
