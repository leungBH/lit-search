/**
 * Unit tests for lib/progress.js
 *
 * Verifies:
 *  - No-op behavior when no progressToken / sendNotification
 *  - report() forwards correctly to sendNotification with right payload
 *  - Deduplicates identical (progress, message) tuples
 *  - Respects AbortSignal: does not send when signal is aborted
 *  - throwIfCancelled throws LitSearchError('CANCELLED') when aborted
 *  - isCancellationFromSignal works as expected
 */

import {
  createProgressReporter,
  throwIfCancelled,
  isCancellationFromSignal,
} from '../../lib/progress.js';
import { LitSearchError } from '../../lib/errors.js';
import {
  suite,
  test,
  beforeEach,
  assertEqual,
  assertDeepEqual,
  assertOk,
  assertFalsy,
  assertTruthy,
  assertThrows,
  assertRejects,
} from './helpers.js';

// ──────────────────────────────────────────────────────────────────────
// createProgressReporter: no-op path
// ──────────────────────────────────────────────────────────────────────

suite('progress: no-op when MCP extras missing', () => {
  test('no extras at all → report is silent, isCancelled is false', async () => {
    const r = createProgressReporter(undefined);
    // 不应当抛
    await r.report(1, 10, 'hi');
    assertFalsy(r.isCancelled());
    assertEqual(r.signal, null);
  });

  test('only signal, no progressToken → silent', async () => {
    const ac = new AbortController();
    const r = createProgressReporter({ signal: ac.signal });
    await r.report(1, 10, 'hi');
    assertEqual(r.signal, ac.signal);
    assertFalsy(r.isCancelled());
  });

  test('progressToken but no sendNotification → silent', async () => {
    const r = createProgressReporter({ _meta: { progressToken: 't1' } });
    await r.report(1, 10, 'hi');
    // 不应当抛；不应当有副作用
  });
});

// ──────────────────────────────────────────────────────────────────────
// createProgressReporter: active path
// ──────────────────────────────────────────────────────────────────────

suite('progress: report() forwards to sendNotification', () => {
  let notifications;
  let sendNotification;

  beforeEach(() => {
    notifications = [];
    sendNotification = async (n) => {
      notifications.push(n);
    };
  });

  test('basic call sends one notification with correct payload', async () => {
    const r = createProgressReporter({
      _meta: { progressToken: 'tok-1' },
      sendNotification,
    });
    await r.report(3, 10, 'step 3');
    assertEqual(notifications.length, 1);
    assertDeepEqual(notifications[0], {
      method: 'notifications/progress',
      params: { progressToken: 'tok-1', progress: 3, total: 10, message: 'step 3' },
    });
  });

  test('no total → total field omitted', async () => {
    const r = createProgressReporter({
      _meta: { progressToken: 'tok-1' },
      sendNotification,
    });
    await r.report(5);
    assertEqual(notifications.length, 1);
    assertEqual(notifications[0].params.progress, 5);
    assertFalsy('total' in notifications[0].params);
  });

  test('progress is clamped to [0, total]', async () => {
    const r = createProgressReporter({
      _meta: { progressToken: 't' },
      sendNotification,
    });
    await r.report(99, 10, 'way over');
    assertEqual(notifications[0].params.progress, 10);
    await r.report(-3, 10, 'negative');
    assertEqual(notifications[1].params.progress, 0);
  });

  test('deduplicates identical (progress, message) tuples', async () => {
    const r = createProgressReporter({
      _meta: { progressToken: 't' },
      sendNotification,
    });
    await r.report(2, 10, 'same');
    await r.report(2, 10, 'same');
    await r.report(2, 10, 'same');
    assertEqual(notifications.length, 1);
  });

  test('different progress sends new notification', async () => {
    const r = createProgressReporter({
      _meta: { progressToken: 't' },
      sendNotification,
    });
    await r.report(1, 10, 'a');
    await r.report(2, 10, 'a');
    await r.report(3, 10, 'a');
    assertEqual(notifications.length, 3);
  });

  test('different message at same progress is treated as new', async () => {
    const r = createProgressReporter({
      _meta: { progressToken: 't' },
      sendNotification,
    });
    await r.report(2, 10, 'a');
    await r.report(2, 10, 'b');
    assertEqual(notifications.length, 2);
  });

  test('sendNotification throwing does not break caller', async () => {
    const broken = async () => {
      throw new Error('network blip');
    };
    const r = createProgressReporter({
      _meta: { progressToken: 't' },
      sendNotification: broken,
    });
    // 不应当把异常抛给上层 workflow
    await r.report(1, 10, 'still going');
  });
});

// ──────────────────────────────────────────────────────────────────────
// createProgressReporter: cancellation interaction
// ──────────────────────────────────────────────────────────────────────

suite('progress: cancellation interaction', () => {
  test('does not send when signal is already aborted', async () => {
    const notifications = [];
    const ac = new AbortController();
    ac.abort();
    const r = createProgressReporter({
      _meta: { progressToken: 't' },
      signal: ac.signal,
      sendNotification: async (n) => notifications.push(n),
    });
    await r.report(1, 10, 'too late');
    assertEqual(notifications.length, 0);
  });

  test('isCancelled() tracks signal correctly', () => {
    const ac = new AbortController();
    const r = createProgressReporter({
      _meta: { progressToken: 't' },
      signal: ac.signal,
      sendNotification: async () => {},
    });
    assertFalsy(r.isCancelled());
    ac.abort();
    assertTruthy(r.isCancelled());
  });

  test('exposes the same signal so caller can chain it', () => {
    const ac = new AbortController();
    const r = createProgressReporter({ signal: ac.signal });
    assertEqual(r.signal, ac.signal);
  });
});

// ──────────────────────────────────────────────────────────────────────
// throwIfCancelled
// ──────────────────────────────────────────────────────────────────────

suite('progress: throwIfCancelled', () => {
  test('null signal is a no-op', () => {
    // 不应当抛
    throwIfCancelled(null);
  });

  test('non-aborted signal is a no-op', () => {
    const ac = new AbortController();
    throwIfCancelled(ac.signal);
  });

  test('aborted signal throws LitSearchError(CANCELLED)', () => {
    const ac = new AbortController();
    ac.abort();
    assertThrows(
      () => throwIfCancelled(ac.signal, 'cancelled by client'),
      /cancelled by client/,
      'should throw with given message'
    );
    // 验证是 LitSearchError
    let caught;
    try {
      throwIfCancelled(ac.signal);
    } catch (e) {
      caught = e;
    }
    assertTruthy(caught instanceof LitSearchError);
    assertEqual(caught.code, 'CANCELLED');
    assertEqual(caught.retryable, false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// isCancellationFromSignal
// ──────────────────────────────────────────────────────────────────────

suite('progress: isCancellationFromSignal', () => {
  test('returns false for non-aborted signal', () => {
    const ac = new AbortController();
    const err = new Error('boom');
    err.name = 'AbortError';
    assertEqual(isCancellationFromSignal(err, ac.signal), false);
  });

  test('returns true for AbortError when signal aborted', () => {
    const ac = new AbortController();
    ac.abort();
    const err = new Error('aborted');
    err.name = 'AbortError';
    assertEqual(isCancellationFromSignal(err, ac.signal), true);
  });

  test('returns true for ABORT_ERR when signal aborted', () => {
    const ac = new AbortController();
    ac.abort();
    const err = new Error('aborted');
    err.code = 'ABORT_ERR';
    assertEqual(isCancellationFromSignal(err, ac.signal), true);
  });

  test('returns false for AbortError when signal is not aborted', () => {
    const ac = new AbortController();
    const err = new Error('aborted');
    err.name = 'AbortError';
    assertEqual(isCancellationFromSignal(err, ac.signal), false);
  });

  test('returns false for null error', () => {
    const ac = new AbortController();
    ac.abort();
    assertEqual(isCancellationFromSignal(null, ac.signal), false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// integration: re-throwing CANCELLED is non-retryable
// ──────────────────────────────────────────────────────────────────────

suite('progress: CANCELLED error is non-retryable', () => {
  test('rejects via async function with CANCELLED', async () => {
    const ac = new AbortController();
    ac.abort();
    await assertRejects(async () => {
      throwIfCancelled(ac.signal);
    }, /Operation cancelled by client/);
  });
});
