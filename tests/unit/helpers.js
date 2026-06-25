/**
 * Shared test helpers for unit-testing API clients.
 *
 * The pattern this module bakes in:
 *   1. Disable real network at module load (prevent accidental external HTTP).
 *   2. Provide a per-test `beforeEach` that clears nock interceptors and
 *      aborts any pending deferred responses, so a slow response from one
 *      test can't fire into the next one ("request already handled" crash).
 *   3. Provide a `silentLogger` so test output stays clean.
 *   4. Provide `makeApi(Constructor, opts)` that wires a silent logger and
 *      forwards any extra constructor args.
 *
 * Typical usage:
 *
 *   import { setupApiTests, nock, beforeEach, makeApi } from '../helpers.js';
 *   const { silentLogger, makeClient } = setupApiTests('https://api.example');
 *   import { MyAPI } from '../../lib/apis/my.js';
 *   function make(opts = {}) {
 *     return makeApi(MyAPI, opts, { extra: 'arg' });
 *   }
 */
import nock from 'nock';

// Re-export all test-runner primitives that API tests use, so a single
// import line (`import { ... } from '../helpers.js'`) covers everything.
export {
  suite,
  test,
  beforeEach,
  assertEqual,
  assertDeepEqual,
  assertMatch,
  assertNotMatch,
  assertTruthy,
  assertFalsy,
  assertOk,
  assertThrows,
  assertRejects,
} from '../test-runner.js';

// Module-level: disable real network for the whole process and clean any
// interceptors that might be left over from a prior file (test files are
// loaded in parallel by the runner; the order isn't guaranteed).
nock.cleanAll();
nock.abortPendingRequests();
nock.disableNetConnect();

export const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Install the standard per-test nock cleanup hook. Call this from
 * `beforeEach` in your suite (or import `cleanNockBeforeEach` directly).
 */
export function cleanNockBeforeEach() {
  nock.cleanAll();
  nock.abortPendingRequests();
}

/**
 * Helper to build a client with the silent logger pre-wired.
 *
 *   makeApi(MyAPI)                                  // (apiKey=null, logger=silent)
 *   makeApi(MyAPI, { apiKey: 'k' })                  // new MyAPI('k', silent)
 *   makeApi(MyAPI, { apiKey: 'k' }, { extra: 'x' })  // new MyAPI('k', silent, 'x')
 *
 * The first positional arg passed to the constructor is taken from
 * `opts.apiKey` (most clients), then `opts.mailto` (Crossref), then
 * `opts.email` (Unpaywall), then null.
 *
 * Use `beforeEach(cleanNockBeforeEach)` in suites that hit the network.
 */
export function makeApi(Constructor, opts = {}, extraCtorArgs = {}) {
  const logger = opts.logger ?? silentLogger;
  const first = opts.apiKey ?? opts.mailto ?? opts.email ?? null;
  if (Object.keys(extraCtorArgs).length === 0) {
    return new Constructor(first, logger);
  }
  return new Constructor(first, logger, extraCtorArgs);
}
