import { LoadingManager } from 'three';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getDesktopBridge } from './desktopBridge';
import { isRobotResourceUrl } from './robotResourceScope';

/**
 * Three's file AND image loaders use this manager, including nested MTL/Collada textures.
 * Keep their original URLs for relative-path resolution; only the final request goes through
 * the native, read-only asset transport. Browsers keep using their normal same-origin proxy.
 */
export function createRobotResourceManager(baseUrl: string): LoadingManager {
  const manager = new LoadingManager();
  const electron = getDesktopBridge()?.robotResourceProtocol;
  const tauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!electron && !tauri) return manager;

  const endpoint = electron ? 'robot-resource://localhost/resource' : convertFileSrc('resource', 'robot-resource');
  manager.setURLModifier(url => {
    if (!isRobotResourceUrl(baseUrl, url)) return url;
    return `${endpoint}?${new URLSearchParams({ base: baseUrl, url })}`;
  });
  return manager;
}
