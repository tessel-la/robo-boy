import { readFileSync } from 'node:fs';

export const defaultBranding = Object.freeze({
  version: 1,
  name: 'Robo-Boy',
  logo: '',
  accent: '',
  loginEyebrow: 'Your robotics workspace',
  loginTitle: 'Sign in to Robo-Boy',
  loginMessage: 'Use your company account to access your robot workspace.',
  loginSlides: [],
  supportUrl: '',
  logoWordmark: false,
  theme: null,
});

const validBrandingText = (value, limit) =>
  typeof value === 'string' && value.length <= limit && !/[\x00-\x1f]/.test(value);

export function branding(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Branding must be an object.');
  if (Object.keys(value).some(key => !Object.hasOwn(defaultBranding, key)))
    throw new Error('Unknown branding setting.');
  const result = { ...defaultBranding, ...value };
  if (result.version !== 1) throw new Error('Unsupported branding version.');
  for (const key of ['name', 'loginEyebrow', 'loginTitle', 'loginMessage', 'logo', 'accent', 'supportUrl']) {
    if (!validBrandingText(result[key], key === 'loginMessage' ? 500 : 200))
      throw new Error(`Invalid branding ${key}.`);
  }
  if (!result.name.trim() || !result.loginTitle.trim()) throw new Error('Brand name and login title cannot be empty.');
  if (!Array.isArray(result.loginSlides) || result.loginSlides.length > 8)
    throw new Error('Configure at most eight login slides.');
  for (const slide of result.loginSlides) {
    if (
      !slide ||
      typeof slide !== 'object' ||
      Array.isArray(slide) ||
      Object.keys(slide).some(key => !['title', 'message'].includes(key)) ||
      !validBrandingText(slide.title, 200) ||
      !slide.title.trim() ||
      !validBrandingText(slide.message, 500)
    )
      throw new Error('Invalid login slide. Supply a title and message as plain text.');
  }
  if (typeof result.logoWordmark !== 'boolean') throw new Error('logoWordmark must be a boolean.');
  if (result.theme !== null) {
    const theme = result.theme;
    if (
      !theme ||
      typeof theme !== 'object' ||
      Array.isArray(theme) ||
      Object.keys(theme).some(key => !['id', 'name', 'fontFamily', 'colors'].includes(key)) ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(theme.id ?? '') ||
      ['light', 'dark', 'solarized'].includes(theme.id) ||
      typeof theme.name !== 'string' ||
      !theme.name.trim() ||
      theme.name.length > 64 ||
      (theme.fontFamily !== undefined &&
        ![
          "'Courier New', Courier, monospace",
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
          "Arial, 'Helvetica Neue', Helvetica, sans-serif",
        ].includes(theme.fontFamily)) ||
      !theme.colors ||
      typeof theme.colors !== 'object' ||
      Array.isArray(theme.colors) ||
      Object.keys(theme.colors).some(
        key => !['primary', 'secondary', 'background', 'text', 'border', 'cardBg', 'buttonText'].includes(key)
      ) ||
      !['primary', 'secondary', 'background'].every(key => Object.hasOwn(theme.colors, key)) ||
      Object.values(theme.colors).some(color => typeof color !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(color))
    )
      throw new Error('Invalid company theme. Use a named theme and six-digit hex colors.');
  }
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

/** Deployment-owned registry. Never accept a client-provided robot upstream. */
export function robots(value, fallback) {
  const entries = value ?? [];
  if (!Array.isArray(entries) || entries.length > 64) throw new Error('Configure at most 64 robots.');
  const ids = new Set();
  return entries.map(item => {
    if (
      !item ||
      typeof item !== 'object' ||
      Object.keys(item).some(key => !['id', 'name', 'upstream'].includes(key)) ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(item.id ?? '') ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      item.name.length > 100 ||
      /[\x00-\x1f]/.test(item.name)
    )
      throw new Error('Invalid robot registry entry.');
    ids.add(item.id);
    const upstream = new URL(item.upstream ?? fallback);
    if (
      upstream.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname) ||
      upstream.username ||
      upstream.password ||
      upstream.pathname !== '/' ||
      upstream.search ||
      upstream.hash
    )
      throw new Error('Robot upstream must be private loopback HTTP.');
    return { id: item.id, name: item.name, upstream: upstream.origin };
  });
}
