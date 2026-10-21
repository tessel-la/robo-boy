import type { Branding } from '../../../infra/enterprise/config.mjs';
export type { Branding };
declare const __ROBOBOY_BRANDING__: Branding | undefined;
export const brand: Branding =
  typeof __ROBOBOY_BRANDING__ === 'undefined'
    ? {
        version: 1,
        name: 'Robo-Boy',
        logo: '',
        accent: '',
        loginTitle: 'Sign in to Robo-Boy',
        loginMessage: 'Use your company account to access your robot workspace.',
        supportUrl: '',
        logoWordmark: false,
        theme: null,
      }
    : __ROBOBOY_BRANDING__;

export const enterpriseEnabled = () => import.meta.env.VITE_ENTERPRISE_LOGIN === 'true';
export const managedGateway = () => enterpriseEnabled() || Boolean(import.meta.env.VITE_ENTERPRISE_SERVER_URL);
export const enterpriseOrigin = () => {
  const value = import.meta.env.VITE_ENTERPRISE_SERVER_URL || window.location.origin;
  const url = new URL(value);
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Configure a secure enterprise server URL for this build.');
  return url.origin;
};
