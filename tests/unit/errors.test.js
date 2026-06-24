// Unit tests for lib/errors.js
//
// Pure-function tests for LitSearchError, ErrorCode, and wrapError.
// No network access required.

import {
  LitSearchError, ErrorCode, wrapError
} from '../../lib/errors.js';
import {
  suite, test, assertEqual, assertDeepEqual, assertOk, assertFalsy, assertTruthy
} from '../test-runner.js';

suite('errors: LitSearchError construction', () => {
  test('basic construction sets code, message, name', () => {
    const e = new LitSearchError('NOT_FOUND', 'paper not found');
    assertEqual(e.code, 'NOT_FOUND');
    assertEqual(e.message, 'paper not found');
    assertEqual(e.name, 'LitSearchError');
  });

  test('retryable=true for RATE_LIMITED, TIMEOUT, NETWORK_ERROR, SOURCE_ERROR, ALL_SOURCES_FAILED', () => {
    for (const code of ['RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'SOURCE_ERROR', 'ALL_SOURCES_FAILED']) {
      const e = new LitSearchError(code, 'msg');
      assertEqual(e.retryable, true, `${code} should be retryable`);
    }
  });

  test('retryable=false for INVALID_INPUT, MISSING_REQUIRED, NOT_FOUND, CANCELLED, AUTH_REQUIRED, INTERNAL_ERROR', () => {
    for (const code of ['INVALID_INPUT', 'MISSING_REQUIRED', 'NOT_FOUND', 'CANCELLED', 'AUTH_REQUIRED', 'INTERNAL_ERROR']) {
      const e = new LitSearchError(code, 'msg');
      assertEqual(e.retryable, false, `${code} should NOT be retryable`);
    }
  });

  test('details are stored and surfaced in toJSON', () => {
    const e = new LitSearchError('NOT_FOUND', 'not found', { source: 'openalex', target: '10.1/x' });
    const out = e.toJSON();
    assertEqual(out.ok, false);
    assertEqual(out.error.code, 'NOT_FOUND');
    assertEqual(out.error.message, 'not found');
    assertEqual(out.error.retryable, false);
    assertEqual(out.error.source, 'openalex');
    assertEqual(out.error.target, '10.1/x');
  });
});

suite('errors: wrapError normalization', () => {
  test('returns the same instance when already a LitSearchError', () => {
    const original = new LitSearchError('NOT_FOUND', 'msg');
    const wrapped = wrapError(original);
    assertEqual(wrapped, original);
  });

  test('null / undefined → INTERNAL_ERROR', () => {
    const e1 = wrapError(null);
    const e2 = wrapError(undefined);
    assertEqual(e1.code, 'INTERNAL_ERROR');
    assertEqual(e2.code, 'INTERNAL_ERROR');
  });

  test('AbortError → CANCELLED', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const wrapped = wrapError(abort);
    assertEqual(wrapped.code, 'CANCELLED');
    assertEqual(wrapped.retryable, false);
  });

  test('error with code ABORT_ERR → CANCELLED', () => {
    const abort = Object.assign(new Error('aborted'), { code: 'ABORT_ERR' });
    const wrapped = wrapError(abort);
    assertEqual(wrapped.code, 'CANCELLED');
  });

  test('timeout message → TIMEOUT (retryable)', () => {
    const wrapped = wrapError(new Error('请求超时（15秒）'));
    assertEqual(wrapped.code, 'TIMEOUT');
    assertEqual(wrapped.retryable, true);
  });

  test('status 429 → RATE_LIMITED with source attached', () => {
    const e = Object.assign(new Error('rate limited'), { status: 429, source: 'openalex' });
    const wrapped = wrapError(e);
    assertEqual(wrapped.code, 'RATE_LIMITED');
    assertEqual(wrapped.retryable, true);
    assertEqual(wrapped.details.source, 'openalex');
  });

  test('status 404 → NOT_FOUND (not retryable)', () => {
    const e = Object.assign(new Error('not found'), { status: 404, source: 'crossref' });
    const wrapped = wrapError(e);
    assertEqual(wrapped.code, 'NOT_FOUND');
    assertEqual(wrapped.retryable, false);
    assertEqual(wrapped.details.source, 'crossref');
  });

  test('status 401 / 403 → AUTH_REQUIRED', () => {
    const e1 = Object.assign(new Error('forbidden'), { status: 401 });
    const e2 = Object.assign(new Error('forbidden'), { status: 403 });
    assertEqual(wrapError(e1).code, 'AUTH_REQUIRED');
    assertEqual(wrapError(e2).code, 'AUTH_REQUIRED');
  });

  test('status 500 → SOURCE_ERROR (retryable)', () => {
    const e = Object.assign(new Error('upstream broken'), { status: 500 });
    const wrapped = wrapError(e);
    assertEqual(wrapped.code, 'SOURCE_ERROR');
    assertEqual(wrapped.retryable, true);
  });

  test('statusCode/statusCode/status aliases all work', () => {
    const e1 = Object.assign(new Error('x'), { statusCode: 503 });
    const e2 = Object.assign(new Error('x'), { response: { status: 503 } });
    assertEqual(wrapError(e1).code, 'SOURCE_ERROR');
    assertEqual(wrapError(e2).code, 'SOURCE_ERROR');
  });

  test('fetch failed / ECONNREFUSED / ENOTFOUND → NETWORK_ERROR', () => {
    assertEqual(wrapError(new Error('fetch failed')).code, 'NETWORK_ERROR');
    assertEqual(wrapError(new Error('connect ECONNREFUSED 127.0.0.1:443')).code, 'NETWORK_ERROR');
    assertEqual(wrapError(new Error('getaddrinfo ENOTFOUND api.x.com')).code, 'NETWORK_ERROR');
    assertEqual(wrapError(new Error('网络连接失败（可能需要代理）')).code, 'NETWORK_ERROR');
  });

  test('unknown error message → INTERNAL_ERROR', () => {
    const wrapped = wrapError(new Error('something weird happened'));
    assertEqual(wrapped.code, 'INTERNAL_ERROR');
    assertEqual(wrapped.retryable, false);
  });

  test('preserves original source if provided', () => {
    const e = Object.assign(new Error('fetch failed'), { source: 'semantic-scholar' });
    const wrapped = wrapError(e);
    assertEqual(wrapped.details.source, 'semantic-scholar');
  });
});

suite('errors: ErrorCode registry', () => {
  test('contains all expected codes', () => {
    const expected = [
      'INVALID_INPUT', 'MISSING_REQUIRED', 'NOT_FOUND',
      'RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'SOURCE_ERROR',
      'ALL_SOURCES_FAILED', 'CANCELLED',
      'AUTH_REQUIRED', 'INTERNAL_ERROR'
    ];
    for (const code of expected) {
      assertOk(ErrorCode[code], `ErrorCode.${code} should exist`);
    }
  });
});
