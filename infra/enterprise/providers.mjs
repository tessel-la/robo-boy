/** Sign-in providers for the enterprise gateway. Each is an OIDC issuer with its own access policy. */

const GOOGLE_ISSUER = 'https://accounts.google.com';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const list = value =>
  (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map(item => String(item).trim().toLowerCase())
    .filter(Boolean);

/**
 * Validates provider settings. A provider open to any Google account would admit the public,
 * so Google requires a Workspace domain or verified-email allowlist.
 */
export function normalizeProviders(options) {
  const providers = options.providers ?? [
    {
      id: 'company',
      oidc: options.oidc,
      issuer: options.issuer,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      requiredGroup: options.requiredGroup,
      groupsClaim: options.groupsClaim,
      scope: options.scope,
      prompt: options.prompt,
    },
  ];
  if (!Array.isArray(providers) || !providers.length || providers.length > 8)
    throw new Error('Configure one to eight sign-in providers.');
  const result = providers.map(provider => {
    const id = provider.id;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(id)) throw new Error('Invalid sign-in provider id.');
    const label =
      provider.label ??
      { company: 'your company account', google: 'Google', microsoft: 'Microsoft' }[id] ??
      id.replace(/-/g, ' ');
    if (typeof label !== 'string' || !label.trim() || label.length > 64 || /[\x00-\x1f<>]/.test(label))
      throw new Error(`Invalid label for sign-in provider ${id}.`);
    const prompt = provider.prompt || 'select_account';
    if (!/^[a-z_]+(?: [a-z_]+)*$/.test(prompt) || prompt.length > 64)
      throw new Error('OIDC prompt must be off or space-separated prompt values.');
    const allowedDomains = list(provider.allowedDomains);
    const allowedEmails = list(provider.allowedEmails);
    const issuer = provider.oidc ? provider.oidc.serverMetadata().issuer : provider.issuer;
    if (issuer === GOOGLE_ISSUER && !allowedDomains.length && !allowedEmails.length)
      throw new Error('Google sign-in needs allowed Workspace domains or allowed email addresses.');
    return {
      id,
      label: label.trim(),
      oidc: provider.oidc,
      issuer,
      clientId: provider.clientId,
      clientSecret: provider.clientSecret,
      requiredGroup: provider.requiredGroup || '',
      groupsClaim: provider.groupsClaim || 'groups',
      scope: provider.scope || 'openid profile email',
      prompt,
      allowedDomains,
      allowedEmails,
    };
  });
  if (new Set(result.map(provider => provider.id)).size !== result.length)
    throw new Error('Sign-in provider ids must be unique.');
  return result;
}

/** Keycloak's group mapper emits full paths such as "/robot-operators" unless reconfigured. */
export const memberOf = (value, group) =>
  (Array.isArray(value) ? value : typeof value === 'string' ? [value] : []).some(
    item => typeof item === 'string' && (item === group || item.replace(/^\//, '') === group)
  );

/**
 * Domains use Google's `hd` claim, which only a Workspace-managed account carries; a personal
 * Google account can verify any email address, so an email domain alone proves nothing.
 */
export function allowedAccount(provider, claims) {
  if (!provider.allowedDomains.length && !provider.allowedEmails.length) return true;
  const domain = typeof claims.hd === 'string' ? claims.hd.toLowerCase() : '';
  const email = claims.email_verified === true && typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  return Boolean(
    (domain && provider.allowedDomains.includes(domain)) || (email && provider.allowedEmails.includes(email))
  );
}

/** Reads company, Google and Microsoft providers from ROBOBOY_* settings. */
export function providersFromEnvironment(env, readSecret) {
  const secret = key => {
    if (!env[key]) throw new Error(`Missing ${key}`);
    const value = readSecret(env[key]).trim();
    if (!value) throw new Error(`Empty secret in ${key}`);
    return value;
  };
  const providers = [];
  if (env.ROBOBOY_OIDC_ISSUER || env.ROBOBOY_OIDC_CLIENT_ID)
    providers.push({
      id: 'company',
      label: env.ROBOBOY_OIDC_LABEL || undefined,
      issuer: env.ROBOBOY_OIDC_ISSUER,
      clientId: env.ROBOBOY_OIDC_CLIENT_ID,
      clientSecret: secret('ROBOBOY_OIDC_CLIENT_SECRET_FILE'),
      requiredGroup: env.ROBOBOY_OIDC_REQUIRED_GROUP,
      groupsClaim: env.ROBOBOY_OIDC_GROUPS_CLAIM,
      scope: env.ROBOBOY_OIDC_SCOPE,
      prompt: env.ROBOBOY_OIDC_PROMPT,
    });
  if (env.ROBOBOY_GOOGLE_CLIENT_ID)
    providers.push({
      id: 'google',
      issuer: GOOGLE_ISSUER,
      clientId: env.ROBOBOY_GOOGLE_CLIENT_ID,
      clientSecret: secret('ROBOBOY_GOOGLE_CLIENT_SECRET_FILE'),
      allowedDomains: env.ROBOBOY_GOOGLE_ALLOWED_DOMAINS,
      allowedEmails: env.ROBOBOY_GOOGLE_ALLOWED_EMAILS,
    });
  if (env.ROBOBOY_MICROSOFT_CLIENT_ID) {
    const tenant = env.ROBOBOY_MICROSOFT_TENANT ?? '';
    // Multi-tenant endpoints admit any Microsoft account and fail issuer validation.
    if (!GUID.test(tenant)) throw new Error('Set ROBOBOY_MICROSOFT_TENANT to the directory (tenant) ID.');
    providers.push({
      id: 'microsoft',
      issuer: `https://login.microsoftonline.com/${tenant.toLowerCase()}/v2.0`,
      clientId: env.ROBOBOY_MICROSOFT_CLIENT_ID,
      clientSecret: secret('ROBOBOY_MICROSOFT_CLIENT_SECRET_FILE'),
      // App roles are tenant-defined values; group claims carry object IDs and may overflow.
      requiredGroup: env.ROBOBOY_MICROSOFT_REQUIRED_ROLE,
      groupsClaim: 'roles',
    });
  }
  if (!providers.length)
    throw new Error('Configure a company OIDC, Google or Microsoft sign-in provider, or disable login.');
  return providers;
}
