const TRUSTED_DIRECT_HOSTS = {
  youtube: /(?:^|\.)googlevideo\.com$/i,
  deezer: /(?:^|\.)dzcdn\.net$/i,
};

export const DIRECT_URL_MAX_CACHE_SECONDS = 300;
export const DIRECT_URL_DEFAULT_CACHE_SECONDS = 60;
const DIRECT_URL_EXPIRY_MARGIN_SECONDS = 15;

export function directPlaybackProvider(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return Object.entries(TRUSTED_DIRECT_HOSTS)
      .find(([, pattern]) => pattern.test(url.hostname))?.[0] || null;
  } catch {
    return null;
  }
}

export function isTrustedDirectPlaybackUrl(value, provider) {
  return Boolean(provider) && directPlaybackProvider(value) === provider;
}

/**
 * Keep a direct source only until its advertised expiry, with a short bounded
 * cache lifetime. Sources without a parseable expiry are usable briefly and
 * rely on the signed proxy recovery path if the origin expires sooner.
 */
export function directPlaybackExpiresAt(value, nowMs = Date.now()) {
  const provider = directPlaybackProvider(value);
  if (!provider) return null;

  const nowSeconds = Math.floor(nowMs / 1000);
  let sourceExpiry = null;
  try {
    const rawExpiry = new URL(value).searchParams.get('expire');
    const parsedExpiry = Number(rawExpiry);
    if (rawExpiry && Number.isFinite(parsedExpiry) && parsedExpiry > 0) {
      sourceExpiry = parsedExpiry > 1e12
        ? Math.floor(parsedExpiry / 1000)
        : Math.floor(parsedExpiry);
    }
  } catch { return null; }

  const boundedExpiry = Math.min(
    sourceExpiry ?? (nowSeconds + DIRECT_URL_DEFAULT_CACHE_SECONDS),
    nowSeconds + DIRECT_URL_MAX_CACHE_SECONDS,
  );
  return boundedExpiry > nowSeconds + DIRECT_URL_EXPIRY_MARGIN_SECONDS
    ? boundedExpiry
    : null;
}
