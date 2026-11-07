export function createThirdPartyNotices(moduleIds: readonly string[]): Promise<string>;
export function thirdPartyNoticesPlugins(): { app: import('vite').Plugin; worker: import('vite').Plugin };
