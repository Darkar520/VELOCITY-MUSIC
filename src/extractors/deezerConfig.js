/**
 * Deezer configuration loader and validator.
 *
 * ARL credentials are read at call time, kept in memory, and never logged.
 * Calling loadDeezerConfig() again reloads the current process.env values, so
 * credential rotation does not require a process restart.
 */

const DEFAULT_QUALITY = 'MP3_320';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_ENABLED = false;
const DEFAULT_BASE_URL = 'https://api.deezer.com';
const VALID_QUALITIES = Object.freeze(['MP3_128', 'MP3_320', 'FLAC']);
const QUALITY_ALIASES = Object.freeze({
  '128': 'MP3_128',
  '320': 'MP3_320',
  MP3: 'MP3_128',
  MP3128: 'MP3_128',
  MP3320: 'MP3_320',
  MP3_LOW: 'MP3_128',
  MP3_HIGH: 'MP3_320',
  MP3_HQ: 'MP3_320',
  FLAC_1411: 'FLAC',
  LOSSLESS: 'FLAC',
});

/**
 * Loads the current Deezer environment configuration.
 *
 * DEEZER_ARL_TOKEN may contain one token or a comma/newline/semicolon
 * separated rotation list. DEEZER_ARL_TOKENS and numbered variables such as
 * DEEZER_ARL_TOKEN_2 are also accepted for deployments that prefer explicit
 * credential slots. The first unique token is exposed as arlToken and the
 * complete rotation list as arlTokens.
 *
 * @param {NodeJS.ProcessEnv|object} [env=process.env] Environment source.
 * @returns {{enabled:boolean, arlToken:string, arlTokens:string[], credentials:object[], quality:string, timeoutMs:number, baseUrl:string}}
 */
export function loadDeezerConfig(env = process.env) {
  const source = env && typeof env === 'object' ? env : process.env;
  const arlTokens = readArlTokens(source);
  const quality = normalizeQuality(source.DEEZER_QUALITY) || normalizeRawQuality(source.DEEZER_QUALITY);
  const timeoutMs = parsePositiveInteger(source.DEEZER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const enabled = parseBoolean(source.DEEZER_ENABLED, DEFAULT_ENABLED);

  return {
    enabled,
    arlToken: arlTokens[0] || '',
    arlTokens,
    credentials: arlTokens.map((arlToken) => ({ arlToken })),
    quality: quality || DEFAULT_QUALITY,
    timeoutMs,
    baseUrl: DEFAULT_BASE_URL,
  };
}

/**
 * Validates a Deezer configuration without exposing credential values.
 *
 * @param {object} config Configuration returned by loadDeezerConfig().
 * @returns {string[]} Human-readable validation errors; an empty array means valid.
 */
export function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['Deezer configuration must be an object.'];
  }

  if (typeof config.enabled !== 'boolean') {
    errors.push('DEEZER_ENABLED must be a boolean (true/false, 1/0, yes/no).');
  }

  const tokens = collectConfigTokens(config);
  const usableTokens = tokens.filter((token) => typeof token === 'string' && token.trim());
  if (config.enabled === true && usableTokens.length === 0) {
    errors.push('DEEZER_ARL_TOKEN is required when Deezer is enabled.');
  }
  const malformedTokens = tokens.some((token) =>
    typeof token !== 'string' || (!token.trim() && tokens.length > 1));
  if (malformedTokens) {
    errors.push('DEEZER_ARL_TOKEN credentials must be non-empty strings.');
  }

  if (!isValidQuality(config.quality)) {
    errors.push('DEEZER_QUALITY must be one of MP3_128, MP3_320, or FLAC.');
  }

  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0) {
    errors.push('DEEZER_TIMEOUT_MS must be a positive integer in milliseconds.');
  }

  return errors;
}

/** Explicit alias for callers that want to document a runtime reload. */
export function reloadDeezerConfig(env = process.env) {
  return loadDeezerConfig(env);
}

export { DEFAULT_BASE_URL, DEFAULT_ENABLED, DEFAULT_QUALITY, DEFAULT_TIMEOUT_MS, VALID_QUALITIES };
export default loadDeezerConfig;

function readArlTokens(env) {
  const values = [env.DEEZER_ARL_TOKEN, env.DEEZER_ARL_TOKENS];
  const numberedKeys = Object.keys(env)
    .filter((key) => /^DEEZER_ARL_TOKEN_\d+$/.test(key))
    .sort((a, b) => Number(a.slice(a.lastIndexOf('_') + 1)) - Number(b.slice(b.lastIndexOf('_') + 1)));
  for (const key of numberedKeys) values.push(env[key]);

  const result = [];
  const seen = new Set();
  for (const value of values) {
    for (const token of splitCredentialValue(value)) {
      if (!seen.has(token)) {
        seen.add(token);
        result.push(token);
      }
    }
  }
  return result;
}

function splitCredentialValue(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(splitCredentialValue);
  const text = String(value).trim();
  if (!text) return [];

  // Permit a JSON array for secret managers that serialize lists this way.
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.flatMap(splitCredentialValue);
    } catch {
      // Fall through and treat malformed input as one value for validation.
    }
  }
  return text.split(/[,;\r\n]+/).map((token) => token.trim()).filter(Boolean);
}

function collectConfigTokens(config) {
  const values = [config.arlToken, config.arlTokens, config.credentials];
  const tokens = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          tokens.push(item.arlToken ?? item.arl ?? item.token ?? '');
        } else {
          tokens.push(item);
        }
      }
    } else if (value !== undefined && value !== null) {
      tokens.push(value);
    }
  }
  return tokens;
}

function normalizeQuality(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const key = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
  return VALID_QUALITIES.includes(key) ? key : QUALITY_ALIASES[key] || null;
}

function normalizeRawQuality(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function isValidQuality(value) {
  return Boolean(normalizeQuality(value));
}

function parsePositiveInteger(value, fallback) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function parseBoolean(value, fallback) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}
