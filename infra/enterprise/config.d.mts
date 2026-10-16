export const defaultBranding: Record<string, string | number>;
export function branding(value?: unknown): typeof defaultBranding;
export function loadBranding(file?: string): typeof defaultBranding;
export function enabled(value?: string): boolean;
export function secureOrigin(value: string): string;
