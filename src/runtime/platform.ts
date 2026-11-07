/** Platform facts without feature dependencies, safe for transports during startup. */
export const isDesktopRuntime = (): boolean =>
  typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || 'roboBoyDesktop' in window);
