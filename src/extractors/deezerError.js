/**
 * Pure error classification helpers for the Deezer integration.
 *
 * Educational/testing use only. This module intentionally uses a whitelist of
 * scalar error fields and never serializes an error, request, headers, cookies,
 * or URL. It has no logging or network side effects.
 */

export const DEEZER_ERROR_CATEGORIES = Object.freeze({
  AUTH: 'AUTH',
  RATE_LIMIT: 'RATE_LIMIT',
  NETWORK: 'NETWORK',
  API_CHANGE: 'API_CHANGE',
  NOT_FOUND: 'NOT_FOUND',
  UNKNOWN: 'UNKNOWN',
});

// Short aliases make the category contract convenient for callers and tests.
export const ERROR_CATEGORIES = DEEZER_ERROR_CATEGORIES;
export const DeezerErrorCategory = DEEZER_ERROR_CATEGORIES;

const {
  AUTH,
  RATE_LIMIT,
  NETWORK,
  API_CHANGE,
  NOT_FOUND,
  UNKNOWN,
} = DEEZER_ERROR_CATEGORIES;

const RETRYABLE_CATEGORIES = new Set([RATE_LIMIT, NETWORK]);
const AUTH_REFRESH_CATEGORIES = new Set([AUTH]);
const CATEGORY_LOG_LEVELS = Object.freeze({
  [AUTH]: 'WARN',
  [RATE_LIMIT]: 'WARN',
  [NETWORK]: 'ERROR',
  [API_CHANGE]: 'ERROR',
  [NOT_FOUND]: 'INFO',
  [UNKNOWN]: 'ERROR',
});

/**
 * Classify an Error-like value without mutating or retaining it.
 * Supports status/name/code/message fields and common HTTP response nesting.
 */
export function classifyDeezerError(errorLike) {
  const input = normalizeErrorInput(errorLike);
  const status = readStatus(input);
  const code = readSignal(input, 'code');
  const name = readSignal(input, 'name');
  const message = readSignal(input, 'message');

  const statusCategory = classifyStatus(status);
  if (statusCategory !== null) return statusCategory;

  const codeCategory = classifySignal(code);
  if (codeCategory !== null) return codeCategory;

  return classifySignal(`${name} ${message}`) || UNKNOWN;
}

/** Return whether a category can be retried by the caller's retry policy. */
export function isRetryable(errorOrCategory) {
  const category = isCategory(errorOrCategory)
    ? errorOrCategory
    : classifyDeezerError(errorOrCategory);
  return RETRYABLE_CATEGORIES.has(category);
}

/** Return whether an authentication failure should trigger token refresh. */
export function shouldRefreshAuth(errorOrCategory) {
  const category = isCategory(errorOrCategory)
    ? errorOrCategory
    : classifyDeezerError(errorOrCategory);
  return AUTH_REFRESH_CATEGORIES.has(category);
}

/** Return the prescribed log level without logging anything. */
export function getDeezerErrorLogLevel(errorOrCategory) {
  const category = isCategory(errorOrCategory)
    ? errorOrCategory
    : classifyDeezerError(errorOrCategory);
  return CATEGORY_LOG_LEVELS[category] || CATEGORY_LOG_LEVELS[UNKNOWN];
}
/**
 * Produce a bounded, JSON-safe context for logs/metrics.
 * Only status, name, code, message, category, retryability and log level are
 * returned; headers, cookies, URLs and all unknown fields are discarded.
 */
export function safeErrorContext(errorLike) {
  const input = normalizeErrorInput(errorLike);
  const context = {};
  const status = readStatus(input);
  const name = sanitizeLabel(readSignal(input, 'name'));
  const code = sanitizeLabel(readSignal(input, 'code'));
  const message = sanitizeMessage(readSignal(input, 'message'));
  const category = classifyDeezerError(input);

  if (status !== null) context.status = status;
  if (name) context.name = name;
  if (code) context.code = code;
  if (message) context.message = message;
  context.category = category;
  context.retryable = isRetryable(category);
  context.logLevel = getDeezerErrorLogLevel(category);
  return context;
}

export default {
  DEEZER_ERROR_CATEGORIES,
  ERROR_CATEGORIES,
  DeezerErrorCategory,
  classifyDeezerError,
  isRetryable,
  shouldRefreshAuth,
  getDeezerErrorLogLevel,
  safeErrorContext,
};

function normalizeErrorInput(value) {
  if (value !== null && typeof value === 'object') return value;
  if (value === undefined || value === null) return {};
  return { message: safeString(value) };
}

function readSignal(input, field) {
  for (const candidate of [input, safeRead(input, 'error'), safeRead(input, 'cause')]) {
    const value = safeRead(candidate, field);
    if (value !== undefined && value !== null && value !== '') return safeString(value);
  }
  return '';
}

function readStatus(input) {
  const candidates = [
    safeRead(input, 'status'),
    safeRead(input, 'statusCode'),
    safeRead(safeRead(input, 'response'), 'status'),
    safeRead(safeRead(input, 'response'), 'statusCode'),
    safeRead(safeRead(input, 'error'), 'status'),
    safeRead(safeRead(input, 'error'), 'statusCode'),
  ];
  for (const candidate of candidates) {
    const status = parseStatus(candidate);
    if (status !== null) return status;
  }
  return parseStatus(readSignal(input, 'code'));
}

function parseStatus(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999) {
    return value;
  }
  if (typeof value !== 'string') return null;
  const match = /^\s*(?:HTTP[_ -]?)?([0-9]{3})\s*$/i.exec(value);
  return match ? Number(match[1]) : null;
}

function classifyStatus(status) {
  if (status === 401 || status === 403) return AUTH;
  if (status === 429) return RATE_LIMIT;
  if (status === 404) return NOT_FOUND;
  if (status === 0 || status === 408 || status === 425) return NETWORK;
  if (status !== null && status >= 500 && status <= 599) return API_CHANGE;
  return null;
}

function classifySignal(signal) {
  const value = safeString(signal).toLowerCase();
  if (!value) return null;

  if (matches(value, AUTH_PATTERNS)) return AUTH;
  if (matches(value, RATE_LIMIT_PATTERNS)) return RATE_LIMIT;
  if (matches(value, NETWORK_PATTERNS)) return NETWORK;
  if (matches(value, NOT_FOUND_PATTERNS)) return NOT_FOUND;
  if (matches(value, API_CHANGE_PATTERNS)) return API_CHANGE;
  return null;
}

const AUTH_PATTERNS = [
  /\bauth(?:entication|orization)?\b/,
  /\bunauthori[sz]ed\b/,
  /\bforbidden\b/,
  /\baccess[ _-]?denied\b/,
  /\binvalid[ _-]?(?:auth|credential|token|arl)\b/,
  /\b(?:token|session)[ _-]?(?:expired|invalid|missing)\b/,
  /\b(?:oauth|eauth|auth_error|invalid_token)\b/,
];

const RATE_LIMIT_PATTERNS = [
  /\brate[ _-]?limit(?:ed|ing)?\b/,
  /\btoo[ _-]?many[ _-]?requests\b/,
  /\bthrottl(?:ed|e|ing)\b/,
  /\bquota[ _-]?exceed(?:ed)?\b/,
  /\b(?:429|e_rate_limit)\b/,
];

const NETWORK_PATTERNS = [
  /\bnetwork\b/,
  /\b(?:fetch|request)[ _-]?failed\b/,
  /\b(?:timeout|timed[ _-]?out)\b/,
  /\b(?:connection|socket)[ _-]?(?:reset|refused|closed|aborted)\b/,
  /\b(?:dns|name[ _-]?resolution)[ _-]?(?:failed|error)\b/,
  /\b(?:abort(?:ed|error)?|eai_again|econn(?:reset|refused|aborted)|enotfound|etimedout|esockettimedout|err_network)\b/,
];

const NOT_FOUND_PATTERNS = [
  /\bnot[ _-]?found\b/,
  /\b(?:missing|unknown|non[ _-]?existent)[ _-]?(?:track|resource|album|artist)\b/,
  /\b(?:track|resource|album|artist)[ _-]?(?:does[ _-]?not[ _-]?exist|not[ _-]?found)\b/,
  /\b404\b/,
];

const API_CHANGE_PATTERNS = [
  /\bapi[ _-]?(?:change|changed|version|error)\b/,
  /\b(?:schema|endpoint|response)[ _-]?(?:change|changed|mismatch|invalid|unexpected)\b/,
  /\b(?:invalid|malformed|unexpected)[ _-]?(?:api[ _-]?)?(?:response|payload|json|field)\b/,
  /\b(?:parse|parsing)[ _-]?error\b/,
  /\b(?:not[ _-]?implemented|bad[ _-]?gateway|bad[ _-]?response|service[ _-]?unavailable)\b/,
  /\b5(?:00|01|02|03|04|05|06|07|08|09)\b/,
];
function isCategory(value) {
  return Object.values(DEEZER_ERROR_CATEGORIES).includes(value);
}

function safeRead(value, field) {
  if (value === null || typeof value !== 'object') return undefined;
  try { return value[field]; } catch { return undefined; }
}

function safeString(value) {
  try { return String(value); } catch { return ''; }
}

function sanitizeLabel(value) {
  const text = sanitizeMessage(value);
  if (!text || isSensitiveLabel(text)) return '';
  return text.replace(/[^a-z0-9_.:/ -]/gi, '_').slice(0, 80);
}

function sanitizeMessage(value) {
  let text = safeString(value).trim();
  if (!text) return '';

  // Remove complete URLs before any other transformation so query secrets do
  // not survive in logs. Header/cookie values are also redacted by key.
  text = text
    .replace(/\b(?:https?|ftp):\/\/[^\s<>"']+/gi, '[REDACTED_URL]')
    .replace(/\bwww\.[^\s<>"']+/gi, '[REDACTED_URL]')
    .replace(/\b(?:authorization|cookie|set-cookie|x-api-key)\s*[:=]\s*[^,;\s]+/gi, '$1=[REDACTED]')
    .replace(/\b(?:access[_-]?token|refresh[_-]?token|arl|api[_-]?key|secret|password|session|jwt|bearer)\s*[:=]\s*[^,;\s]+/gi, '$1=[REDACTED]')
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');

  return text.slice(0, 256);
}

function isSensitiveLabel(value) {
  return /(?:token|secret|password|cookie|authorization|api[_-]?key|bearer)/i.test(value);
}

function matches(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}
