/**
 * Stands in for Tauri's core and event APIs outside the Tauri shell.
 *
 * Web and Electron builds resolve `@tauri-apps/api/core` and `@tauri-apps/api/event` to this module
 * (see the aliases in config/vite.config.ts and the path mappings in tsconfig.json). Nothing reaches
 * it there: the updater only asks Tauri for commands once it knows it runs in Tauri.
 */
export const invoke = <T,>(command: string, _args?: Record<string, unknown>): Promise<T> =>
  Promise.reject(new Error(`${command} is only available in the Tauri desktop app.`));

export const listen = (event: string, _handler: (event: never) => void): Promise<() => void> =>
  Promise.reject(new Error(`${event} is only available in the Tauri desktop app.`));

export const convertFileSrc = (_path: string, _protocol?: string): string => {
  throw new Error('Custom protocols are only available in the Tauri app.');
};
