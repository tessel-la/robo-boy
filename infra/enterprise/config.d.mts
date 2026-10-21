import type { CustomTheme } from '../../src/features/theme/themeUtils';
export interface Branding {
  version: 1;
  name: string;
  logo: string;
  accent: string;
  loginTitle: string;
  loginMessage: string;
  supportUrl: string;
  logoWordmark: boolean;
  theme: CustomTheme | null;
}
export const defaultBranding: Branding;
export function branding(value?: unknown): typeof defaultBranding;
export function loadBranding(file?: string): typeof defaultBranding;
export function enabled(value?: string): boolean;
export function secureOrigin(value: string): string;

export function robots(value: unknown, fallback?: string): { id: string; name: string; upstream: string }[];
