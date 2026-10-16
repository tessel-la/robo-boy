import { readFileSync } from 'node:fs';

export const defaultBranding = Object.freeze({
  version: 1,
  name: 'Robo-Boy',
  logo: '',
  accent: '',
  loginTitle: 'Sign in to Robo-Boy',
  loginMessage: 'Use your company account to access your robot workspace.',
  supportUrl: '',
});

export function branding(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Branding must be an object.');
  if (Object.keys(value).some(key => !Object.hasOwn(defaultBranding, key)))
    throw new Error('Unknown branding setting.');
  const result = { ...defaultBranding, ...value };
  if (result.version !== 1) throw new Error('Unsupported branding version.');
  for (const key of ['name', 'loginTitle', 'loginMessage', 'logo', 'accent', 'supportUrl']) {
    if (
      typeof result[key] !== 'string' ||
      result[key].length > (key === 'loginMessage' ? 500 : 200) ||
      /[\x00-\x1f]/.test(result[key])
    )
      throw new Error(`Invalid branding ${key}.`);
  }
  if (!result.name.trim() || !result.loginTitle.trim()) throw new Error('Brand name and login title cannot be empty.');
  if (result.logo && !/^\/branding\/[a-zA-Z0-9_-]+\.(svg|png|jpg|jpeg|webp)$/.test(result.logo))
    throw new Error('Logo must be a file under /branding/.');
  if (result.accent && !/^#[a-fA-F0-9]{6}$/.test(result.accent))
    throw new Error('Accent must be a six-digit hex color.');
  if (result.supportUrl) {
    const url = new URL(result.supportUrl);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Support URL must use HTTPS without credentials.');
  }
  return result;
}

export function loadBranding(file) {
  if (!file) return branding();
  let value;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error('Could not read the branding configuration. Supply a valid branding JSON file.');
  }
  return branding(value);
}

export function enabled(value) {
  if (value !== undefined && value !== 'true' && value !== 'false')
    throw new Error('Enterprise login flag must be true or false.');
  return value === 'true';
}

export function secureOrigin(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
  )
    throw new Error('Enterprise origin must be HTTPS (HTTP is allowed on loopback for tests).');
  return url.origin;
}
