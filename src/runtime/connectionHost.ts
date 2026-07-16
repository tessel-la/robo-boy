const HOST_SEPARATOR_TYPO_PATTERN = /,/g;

export const normalizeConnectionHost = (value: string, fallback = ''): string => {
  const candidate = value.trim().replace(HOST_SEPARATOR_TYPO_PATTERN, '.');
  if (!candidate) return fallback;

  try {
    const parsed = new URL(candidate.includes('://') ? candidate : `http://${candidate}`);
    return parsed.hostname.replace(/^\[|\]$/g, '') || fallback;
  } catch {
    const withoutIpv6Brackets = candidate.replace(/^\[|\]$/g, '');
    return /^[^\s/]+$/.test(withoutIpv6Brackets) ? withoutIpv6Brackets : fallback;
  }
};
