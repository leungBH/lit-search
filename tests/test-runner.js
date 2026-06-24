// Minimal Node-native test runner for lit-search.
// Usage:
//   import { suite, test, runSuites } from './test-runner.js';
//   suite('group', () => { test('case', () => { assert.equal(...) }) });
//   runSuites();

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const COLOR = process.stdout.isTTY || process.env.FORCE_COLOR === '1';

const C = {
  reset: COLOR ? '\x1b[0m' : '',
  bold: COLOR ? '\x1b[1m' : '',
  dim: COLOR ? '\x1b[2m' : '',
  red: COLOR ? '\x1b[31m' : '',
  green: COLOR ? '\x1b[32m' : '',
  yellow: COLOR ? '\x1b[33m' : '',
  cyan: COLOR ? '\x1b[36m' : '',
  gray: COLOR ? '\x1b[90m' : ''
};

const suites = [];
let currentSuite = null;
let currentBeforeEach = null;

export function suite(name, fn) {
  if (currentSuite) {
    throw new Error('Nested suite() is not supported. Use a flat structure.');
  }
  currentSuite = { name, tests: [], beforeEach: null };
  suites.push(currentSuite);
  try {
    fn();
  } finally {
    currentSuite = null;
  }
}

export function beforeEach(fn) {
  if (!currentSuite) throw new Error('beforeEach must be called inside a suite()');
  currentSuite.beforeEach = fn;
}

export function test(name, fn) {
  if (!currentSuite) throw new Error('test() must be called inside a suite()');
  if (typeof fn !== 'function') {
    throw new Error(`test("${name}") expects a function`);
  }
  currentSuite.tests.push({ name, fn });
}

export async function runSuites({ filter = '', skipNetwork = false } = {}) {
  const start = Date.now();
  const summary = { total: 0, passed: 0, failed: 0, skipped: 0, errors: [] };

  for (const s of suites) {
    if (filter && !s.name.toLowerCase().includes(filter.toLowerCase())) continue;
    console.log(`\n${C.bold}${C.cyan}${s.name}${C.reset}`);
    console.log(`${C.dim}${'-'.repeat(Math.min(64, s.name.length + 8))}${C.reset}`);

    for (const t of s.tests) {
      if (skipNetwork && t.name.toLowerCase().includes('[network]')) {
        console.log(`  ${C.yellow}SKIP${C.reset} ${t.name} (network)`);
        summary.skipped++;
        continue;
      }
      summary.total++;
      const t0 = Date.now();
      try {
        if (s.beforeEach) await s.beforeEach();
        await t.fn();
        const ms = Date.now() - t0;
        console.log(`  ${C.green}PASS${C.reset} ${t.name} ${C.dim}(${ms}ms)${C.reset}`);
        summary.passed++;
      } catch (error) {
        const ms = Date.now() - t0;
        console.log(`  ${C.red}FAIL${C.reset} ${t.name} ${C.dim}(${ms}ms)${C.reset}`);
        console.log(`${C.gray}${formatError(error)}${C.reset}`);
        summary.failed++;
        summary.errors.push({ suite: s.name, test: t.name, error });
      }
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\n${C.bold}${'-'.repeat(64)}${C.reset}`);
  console.log(
    `${C.bold}Passed:${C.reset} ${C.green}${summary.passed}${C.reset}  ` +
    `${C.bold}Failed:${C.reset} ${summary.failed ? C.red : C.dim}${summary.failed}${C.reset}  ` +
    `${C.bold}Skipped:${C.reset} ${C.yellow}${summary.skipped}${C.reset}  ` +
    `${C.bold}Total:${C.reset} ${summary.total}  ` +
    `${C.dim}(${elapsed}s)${C.reset}`
  );
  console.log(`${C.bold}${'-'.repeat(64)}${C.reset}`);

  // If a report path was given, write a human-readable report.
  if (process.env.LIT_SEARCH_TEST_REPORT) {
    const fs = await import('node:fs');
    const lines = [];
    lines.push('lit-search test report');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Node: ${process.version}  Platform: ${process.platform}`);
    lines.push(`Filter: ${filter || '(none)'}  SkipNetwork: ${skipNetwork}`);
    lines.push('');
    lines.push(`Summary: passed=${summary.passed} failed=${summary.failed} skipped=${summary.skipped} total=${summary.total} elapsed=${elapsed}s`);
    lines.push('');
    if (summary.errors.length) {
      lines.push('Failures:');
      for (const e of summary.errors) {
        lines.push(`  - [${e.suite}] ${e.test}`);
        lines.push(`    ${String(e.error?.stack || e.error?.message || e.error).replace(/\n/g, '\n    ')}`);
      }
      lines.push('');
    }
    fs.writeFileSync(process.env.LIT_SEARCH_TEST_REPORT, lines.join('\n'), 'utf-8');
  }

  return summary;
}

export function assertEqual(actual, expected, message) {
  if (!deepEqual(actual, expected)) {
    throw new Error(message || `assertEqual failed\n  expected: ${format(expected)}\n  actual:   ${format(actual)}`);
  }
}

export function assertDeepEqual(actual, expected, message) {
  if (!deepEqual(actual, expected)) {
    throw new Error(message || `assertDeepEqual failed\n  expected: ${format(expected)}\n  actual:   ${format(actual)}`);
  }
}

export function assertMatch(value, pattern, message) {
  if (typeof pattern === 'string') {
    if (!String(value).includes(pattern)) {
      throw new Error(message || `assertMatch: "${pattern}" not found in\n  ${value}`);
    }
  } else if (!pattern.test(String(value))) {
    throw new Error(message || `assertMatch: ${pattern} did not match\n  ${value}`);
  }
}

export function assertNotMatch(value, pattern, message) {
  if (pattern.test(String(value))) {
    throw new Error(message || `assertNotMatch: ${pattern} should not match\n  ${value}`);
  }
}

export function assertTruthy(value, message) {
  if (!value) throw new Error(message || `assertTruthy failed: ${format(value)}`);
}

export function assertFalsy(value, message) {
  if (value) throw new Error(message || `assertFalsy failed: ${format(value)}`);
}

export function assertOk(condition, message) {
  if (!condition) throw new Error(message || 'assertOk failed');
}

export function assertThrows(fn, matcher, message) {
  let thrown;
  try { fn(); } catch (e) { thrown = e; }
  if (!thrown) throw new Error(message || 'assertThrows: no error was thrown');
  if (matcher instanceof RegExp && !matcher.test(thrown.message)) {
    throw new Error(message || `assertThrows: message "${thrown.message}" did not match ${matcher}`);
  }
}

export function assertRejects(asyncFn, matcher, message) {
  return Promise.resolve()
    .then(() => asyncFn())
    .then(
      () => { throw new Error(message || 'assertRejects: did not reject'); },
      err => {
        if (matcher instanceof RegExp && !matcher.test(err.message)) {
          throw new Error(message || `assertRejects: "${err.message}" did not match ${matcher}`);
        }
      }
    );
}

function format(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function formatError(error) {
  return (error.stack || error.message || String(error))
    .split('\n')
    .map((line, i) => i === 0 ? line : '    ' + line)
    .join('\n');
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

export const color = C;
export const cliEntry = process.env.LIT_SEARCH_CLI ||
  join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lit-search.js');
