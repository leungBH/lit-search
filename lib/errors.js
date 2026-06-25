/**
 * lit-search - Structured errors
 *
 * All errors surfaced through MCP tools should be LitSearchError instances.
 * `wrapError` normalizes upstream / fetch / unknown errors into the same shape
 * so that LLM clients see a predictable error code + retryable flag.
 */

export const ErrorCode = {
  // Input
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED: 'MISSING_REQUIRED',

  // Resource
  NOT_FOUND: 'NOT_FOUND',

  // Network / upstream
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  SOURCE_ERROR: 'SOURCE_ERROR',
  ALL_SOURCES_FAILED: 'ALL_SOURCES_FAILED',
  CANCELLED: 'CANCELLED',

  // Auth
  AUTH_REQUIRED: 'AUTH_REQUIRED',

  // Internal
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

const RETRYABLE_CODES = new Set([
  'RATE_LIMITED',
  'TIMEOUT',
  'NETWORK_ERROR',
  'SOURCE_ERROR',
  'ALL_SOURCES_FAILED',
]);

export class LitSearchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LitSearchError';
    this.code = code;
    this.details = details || {};
    this.retryable = RETRYABLE_CODES.has(code);
  }

  toJSON() {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...this.details,
      },
    };
  }
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function wrapError(err) {
  if (err instanceof LitSearchError) return err;
  if (!err) return new LitSearchError('INTERNAL_ERROR', 'Unknown error');

  const status = err.status ?? err.statusCode ?? asNumber(err?.response?.status);
  const source = err.source || err?.details?.source || null;

  if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
    return new LitSearchError('CANCELLED', 'Request cancelled', { source });
  }

  const msg = String(err.message || '');

  if (msg.includes('超时') || msg.toLowerCase().includes('timeout')) {
    return new LitSearchError('TIMEOUT', msg || 'Request timeout', { source });
  }

  if (status === 429) {
    const retryAfter = err?.response?.headers?.get?.('retry-after') || err.retryAfter || null;
    return new LitSearchError('RATE_LIMITED', 'Upstream rate limited', { source, retryAfter });
  }

  if (status === 404) {
    return new LitSearchError('NOT_FOUND', 'Paper not found in source', { source });
  }

  if (status === 401 || status === 403) {
    return new LitSearchError('AUTH_REQUIRED', `Upstream auth error (${status})`, { source });
  }

  if (status >= 500) {
    return new LitSearchError('SOURCE_ERROR', `Upstream error (${status})`, { source });
  }

  if (
    msg.includes('fetch failed') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('网络连接失败')
  ) {
    return new LitSearchError('NETWORK_ERROR', msg, { source });
  }

  return new LitSearchError('INTERNAL_ERROR', msg || 'Unknown error', { source });
}
