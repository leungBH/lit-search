/**
 * Unit tests for `bin/lit-search-utils.js`.
 *
 * The CLI entry-point (`bin/lit-search.js`) is hard to import directly
 * because it executes `main()` at the bottom. We extracted the pure
 * argument-parsing and option-merging helpers into `lit-search-utils.js`
 * so we can test them in isolation, and exercise the side-effect
 * adapters (`main`) via a thin subprocess wrapper for `--help` /
 * `--version` / `--bogus`.
 */

import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
  normalizeQueryExpansion,
  normalizeSearchScope,
  expandInputPattern,
  getOptionValue,
  getNumberOptionValue,
  resolveInitValue,
  buildRuntimeEngines,
} from '../../bin/lit-search-utils.js';
import { suite, test } from '../test-runner.js';
import { assertEqual, assertDeepEqual, assertMatch, assertOk, assertThrows } from './helpers.js';

// ────────────────────────────────────────────────────────────────────────────
// parseArgs
// ────────────────────────────────────────────────────────────────────────────

const FIXED_CWD = '/tmp/test-cwd';

suite('cli: parseArgs', () => {
  test('empty args → all defaults, no query', () => {
    const opts = parseArgs([], { cwd: FIXED_CWD, resolvePath: (p) => p });
    assertEqual(opts.query, null);
    assertEqual(opts.limit, 3);
    assertEqual(opts.yearStart, null);
    assertEqual(opts.yearEnd, null);
    assertEqual(opts.queryExpansion, 'none');
    assertEqual(opts.searchScope, 'default-engine-search');
    assertEqual(opts.outputBaseDir, FIXED_CWD);
    assertEqual(opts.resolvePreprint, false);
    assertEqual(opts.preferPublished, false);
    assertEqual(opts.withPubMed, false);
    assertEqual(opts.withOpenCitations, false);
  });

  test('bare positional words are joined with spaces', () => {
    const opts = parseArgs(['machine', 'learning'], { cwd: FIXED_CWD, resolvePath: (p) => p });
    assertEqual(opts.query, 'machine learning');
  });

  test('--limit N sets limit and falls back to 3 on NaN', () => {
    const ok = parseArgs(['q', '-l', '7'], { cwd: FIXED_CWD, resolvePath: (p) => p });
    assertEqual(ok.limit, 7);
    const bad = parseArgs(['q', '--limit', 'abc'], { cwd: FIXED_CWD, resolvePath: (p) => p });
    assertEqual(bad.limit, 3);
  });

  test('year flags (--since / -s / --year-start) all parse; bad input → null', () => {
    assertEqual(
      parseArgs(['q', '-s', '2020'], { cwd: FIXED_CWD, resolvePath: (p) => p }).yearStart,
      2020
    );
    assertEqual(
      parseArgs(['q', '--year-start', '2019'], { cwd: FIXED_CWD, resolvePath: (p) => p }).yearStart,
      2019
    );
    assertEqual(
      parseArgs(['q', '-s', 'abc'], { cwd: FIXED_CWD, resolvePath: (p) => p }).yearStart,
      null
    );
    assertEqual(
      parseArgs(['q', '-u', '2025'], { cwd: FIXED_CWD, resolvePath: (p) => p }).yearEnd,
      2025
    );
  });

  test('--expand accepts none/pairwise/full (case-insensitive)', () => {
    const opts = parseArgs(['q', '--expand', 'PAIRWISE'], {
      cwd: FIXED_CWD,
      resolvePath: (p) => p,
    });
    assertEqual(opts.queryExpansion, 'pairwise');
  });

  test('--expand with bad value throws a descriptive error', () => {
    assertThrows(
      () => parseArgs(['q', '--expand', 'wild'], { cwd: FIXED_CWD, resolvePath: (p) => p }),
      /Unsupported query expansion: wild/
    );
  });

  test('--search-scope accepts the three legal values', () => {
    const opts = parseArgs(['q', '--search-scope', 'title-abstract'], {
      cwd: FIXED_CWD,
      resolvePath: (p) => p,
    });
    assertEqual(opts.searchScope, 'title-abstract');
  });

  test('--search-scope with bad value throws', () => {
    assertThrows(
      () =>
        parseArgs(['q', '--search-scope', 'everything'], { cwd: FIXED_CWD, resolvePath: (p) => p }),
      /Unsupported search scope: everything/
    );
  });

  test('--output-dir invokes the resolvePath function', () => {
    const calls = [];
    const opts = parseArgs(['q', '--output-dir', '/some/dir'], {
      cwd: FIXED_CWD,
      resolvePath: (p) => {
        calls.push(p);
        return p + '/abs';
      },
    });
    assertEqual(opts.outputBaseDir, '/some/dir/abs');
    assertDeepEqual(calls, ['/some/dir']);
  });

  test('--resolve-preprint flips the flag', () => {
    const opts = parseArgs(['q', '--resolve-preprint'], { cwd: FIXED_CWD, resolvePath: (p) => p });
    assertEqual(opts.resolvePreprint, true);
    assertEqual(opts.preferPublished, false);
  });

  test('--prefer-published also enables resolvePreprint', () => {
    const opts = parseArgs(['q', '--prefer-published'], { cwd: FIXED_CWD, resolvePath: (p) => p });
    assertEqual(opts.preferPublished, true);
    assertEqual(opts.resolvePreprint, true);
  });

  test('--with-pubmed and --with-opencitations', () => {
    const opts = parseArgs(['q', '--with-pubmed', '--with-opencitations'], {
      cwd: FIXED_CWD,
      resolvePath: (p) => p,
    });
    assertEqual(opts.withPubMed, true);
    assertEqual(opts.withOpenCitations, true);
  });

  test('removed flags surface _error sentinel with a helpful message', () => {
    assertMatch(
      parseArgs(['q', '--pdf'], { cwd: FIXED_CWD, resolvePath: (p) => p })._error,
      /PDF download options have been removed/
    );
    assertMatch(
      parseArgs(['q', '--format', 'csv'], { cwd: FIXED_CWD, resolvePath: (p) => p })._error,
      /--format option has been removed/
    );
  });

  test('--help and --version surface sentinels instead of mutating options', () => {
    assertEqual(parseArgs(['--help'], { cwd: FIXED_CWD, resolvePath: (p) => p })._help, true);
    assertEqual(parseArgs(['-v'], { cwd: FIXED_CWD, resolvePath: (p) => p })._version, true);
  });

  test('unknown flag surfaces _error sentinel naming the flag', () => {
    assertMatch(
      parseArgs(['q', '--mystery'], { cwd: FIXED_CWD, resolvePath: (p) => p })._error,
      /Unknown option: --mystery/
    );
  });

  test('combined: query + limit + year range + scope + expand + flags', () => {
    const opts = parseArgs(
      [
        'graph',
        'neural',
        'networks',
        '-l',
        '10',
        '-s',
        '2018',
        '-u',
        '2024',
        '--expand',
        'full',
        '--search-scope',
        'title-abstract',
        '--resolve-preprint',
      ],
      { cwd: FIXED_CWD, resolvePath: (p) => p }
    );
    assertEqual(opts.query, 'graph neural networks');
    assertEqual(opts.limit, 10);
    assertEqual(opts.yearStart, 2018);
    assertEqual(opts.yearEnd, 2024);
    assertEqual(opts.queryExpansion, 'full');
    assertEqual(opts.searchScope, 'title-abstract');
    assertEqual(opts.resolvePreprint, true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// normalizeQueryExpansion / normalizeSearchScope
// ────────────────────────────────────────────────────────────────────────────

suite('cli: normalizeQueryExpansion', () => {
  test('returns the canonical value for each legal input', () => {
    assertEqual(normalizeQueryExpansion('none'), 'none');
    assertEqual(normalizeQueryExpansion('pairwise'), 'pairwise');
    assertEqual(normalizeQueryExpansion('full'), 'full');
  });
  test('normalizes casing and whitespace', () => {
    assertEqual(normalizeQueryExpansion('  PAIRWISE  '), 'pairwise');
  });
  test('throws on empty / unknown values', () => {
    assertThrows(() => normalizeQueryExpansion(''), /Unsupported query expansion/);
    assertThrows(() => normalizeQueryExpansion('triple'), /Unsupported query expansion/);
  });
});

suite('cli: normalizeSearchScope', () => {
  test('returns the canonical value for each legal input', () => {
    assertEqual(normalizeSearchScope('title-only'), 'title-only');
    assertEqual(normalizeSearchScope('title-abstract'), 'title-abstract');
    assertEqual(normalizeSearchScope('default-engine-search'), 'default-engine-search');
  });
  test('throws on empty / unknown values', () => {
    assertThrows(() => normalizeSearchScope(''), /Unsupported search scope/);
    assertThrows(() => normalizeSearchScope('all-fields'), /Unsupported search scope/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// expandInputPattern
// ────────────────────────────────────────────────────────────────────────────

suite('cli: expandInputPattern', () => {
  test('no wildcard → returns the pattern itself', () => {
    const out = expandInputPattern('plain/path', {
      readdir: () => [],
      exists: () => true,
      sep: '/',
    });
    assertDeepEqual(out, ['plain/path']);
  });

  test('wildcard: matches names in the given directory', () => {
    const fake = { readdir: () => ['a.json', 'b.json', 'c.txt'], exists: () => true, sep: '/' };
    const out = expandInputPattern('dir/*.json', fake);
    assertDeepEqual(out, ['dir/a.json', 'dir/b.json']);
  });

  test('wildcard: filters out non-existing files', () => {
    const fake = {
      readdir: () => ['keep.json', 'skip.json'],
      exists: (p) => p.endsWith('keep.json'),
      sep: '/',
    };
    const out = expandInputPattern('d/*.json', fake);
    assertDeepEqual(out, ['d/keep.json']);
  });

  test('dot in filename is escaped (not treated as regex wildcard)', () => {
    const fake = { readdir: () => ['foo.json', 'fooXjson'], exists: () => true, sep: '/' };
    const out = expandInputPattern('d/foo.json', fake);
    assertDeepEqual(out, ['d/foo.json']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getOptionValue / getNumberOptionValue
// ────────────────────────────────────────────────────────────────────────────

suite('cli: getOptionValue', () => {
  test('returns the next arg when present and not a flag', () => {
    assertEqual(getOptionValue(['--fields', 'abstract,keywords'], '--fields'), 'abstract,keywords');
  });
  test('returns null when the flag is missing', () => {
    assertEqual(getOptionValue(['--other'], '--fields'), null);
  });
  test('returns null when the next value starts with - (looks like a flag)', () => {
    assertEqual(getOptionValue(['--fields', '--other'], '--fields'), null);
  });
});

suite('cli: getNumberOptionValue', () => {
  test('parses a numeric value', () => {
    assertEqual(getNumberOptionValue(['--concurrency', '4'], '--concurrency', 1), 4);
  });
  test('returns the fallback when the flag is missing', () => {
    assertEqual(getNumberOptionValue([], '--concurrency', 1), 1);
  });
  test('returns the fallback when the value is non-numeric', () => {
    assertEqual(getNumberOptionValue(['--concurrency', 'fast'], '--concurrency', 1), 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolveInitValue
// ────────────────────────────────────────────────────────────────────────────

suite('cli: resolveInitValue', () => {
  test('"-" clears the value (returns null)', () => {
    assertEqual(resolveInitValue('-', 'old'), null);
  });
  test('empty / undefined keeps the current value', () => {
    assertEqual(resolveInitValue('', 'kept'), 'kept');
    assertEqual(resolveInitValue(undefined, 'kept'), 'kept');
  });
  test('whitespace-only input keeps the current value', () => {
    assertEqual(resolveInitValue('   ', 'kept'), 'kept');
  });
  test('non-empty input trims and replaces the current value', () => {
    assertEqual(resolveInitValue('  newkey  ', 'old'), 'newkey');
  });
  test('no current value: empty / undefined → null, valid input → trimmed', () => {
    assertEqual(resolveInitValue('', null), null);
    assertEqual(resolveInitValue('  fresh  ', null), 'fresh');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// buildRuntimeEngines
// ────────────────────────────────────────────────────────────────────────────

suite('cli: buildRuntimeEngines', () => {
  test('merges config engines with per-run overrides', () => {
    const out = buildRuntimeEngines(
      { semanticScholar: true, openalex: true },
      { withPubMed: true, withOpenCitations: true }
    );
    assertEqual(out.semanticScholar, true);
    assertEqual(out.openalex, true);
    assertEqual(out.pubmed, true);
    assertEqual(out.openCitations, true);
  });
  test('omitted flags do not flip anything on', () => {
    const out = buildRuntimeEngines({ openalex: true }, {});
    assertEqual(out.pubmed, undefined);
    assertEqual(out.openCitations, undefined);
    assertEqual(out.openalex, true);
  });
  test('handles missing config engines (undefined) gracefully', () => {
    const out = buildRuntimeEngines(undefined, { withPubMed: true });
    assertEqual(out.pubmed, true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Subprocess sanity check on the real `bin/lit-search.js`
// ────────────────────────────────────────────────────────────────────────────

suite('cli: bin/lit-search.js subprocess', () => {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const bin = join(repoRoot, 'bin', 'lit-search.js');

  test('--version prints the package version and exits 0', () => {
    const out = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf-8' }).trim();
    assertMatch(out, /^\d+\.\d+\.\d+/);
  });

  test('--help prints usage banner and exits 0', () => {
    const out = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf-8' });
    assertMatch(out, /Usage:/);
    assertMatch(out, /lit-search search/);
  });

  test('unknown flag exits 1 with a helpful message', () => {
    let code = 0;
    let combined = '';
    try {
      const out = execFileSync(process.execPath, [bin, 'q', '--definitely-not-a-flag'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      combined = out;
    } catch (err) {
      code = err.status;
      combined = (err.stdout || '') + (err.stderr || '');
    }
    assertEqual(code, 1);
    assertMatch(combined, /Unknown option: --definitely-not-a-flag/);
    assertMatch(combined, /--help/);
  });

  test('removed --pdf flag exits 1', () => {
    let code = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [bin, 'q', '--pdf'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      code = err.status;
      stderr = err.stderr || '';
    }
    assertEqual(code, 1);
    assertMatch(stderr, /PDF download options have been removed/);
  });

  test('expandInputPattern works against a real temp directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lit-cli-'));
    writeFileSync(join(dir, 'a.json'), '{}');
    writeFileSync(join(dir, 'b.json'), '{}');
    writeFileSync(join(dir, 'c.txt'), 'x');
    const out = expandInputPattern(`${dir}${sep}*.json`, {
      readdir: readdirSync,
      exists: existsSync,
      sep,
    });
    // We expect exactly the two .json files (in some order)
    assertOk(out.length === 2);
    assertOk(out.every((p) => p.endsWith('.json')));
  });

  test('expandInputPattern drops missing files using real fs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lit-cli-'));
    writeFileSync(join(dir, 'real.json'), '{}');
    const out = expandInputPattern(`${dir}${sep}*.json`, {
      readdir: readdirSync,
      exists: (p) => p.endsWith('real.json'),
      sep,
    });
    assertEqual(out.length, 1);
  });

  test('expandInputPattern does not crash when readdir is called on a fresh dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lit-cli-'));
    const out = expandInputPattern(`${dir}${sep}*.json`, {
      readdir: readdirSync,
      exists: existsSync,
      sep,
    });
    assertEqual(out.length, 0);
  });

  // ────────────────────────────────────────────────────────────────────
  // main() error-path branches
  // ────────────────────────────────────────────────────────────────────

  /**
   * Helper: run the CLI with the given args, capturing stdout+stderr and
   * the exit code. Returns { code, output }.
   */
  function runCli(args) {
    let code = 0;
    let output = '';
    try {
      output = execFileSync(process.execPath, [bin, ...args], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      code = err.status ?? 1;
      output = (err.stdout || '') + (err.stderr || '');
    }
    return { code, output };
  }

  test('no args at all prints help and exits 0', () => {
    const { code, output } = runCli([]);
    assertEqual(code, 0);
    assertMatch(output, /Usage:/);
  });

  test('search with flags but no query exits 1 with the example hint', () => {
    const { code, output } = runCli(['-l', '5']);
    assertEqual(code, 1);
    assertMatch(output, /Please provide a search query/);
    assertMatch(output, /lit-search "machine learning"/);
  });

  test('merge with no inputs exits non-zero with a helpful message', () => {
    const { code, output } = runCli(['merge']);
    assertEqual(code === 0, false); // not 0
    assertMatch(output, /Please provide at least one pool folder/);
  });

  test('enrich with no target exits non-zero', () => {
    const { code, output } = runCli(['enrich']);
    assertEqual(code === 0, false);
    assertMatch(output, /Please provide a pool folder or literature_pool\.json/);
  });

  test('resolve with no file exits non-zero', () => {
    const { code, output } = runCli(['resolve']);
    assertEqual(code === 0, false);
    assertMatch(output, /Please provide a citations text file/);
  });

  test('--expand with invalid value exits 1 with a validation message', () => {
    const { code, output } = runCli(['q', '--expand', 'wild']);
    assertEqual(code, 1);
    assertMatch(output, /Unsupported query expansion: wild/);
  });

  test('--search-scope with invalid value exits 1 with a validation message', () => {
    const { code, output } = runCli(['q', '--search-scope', 'everywhere']);
    assertEqual(code, 1);
    assertMatch(output, /Unsupported search scope: everywhere/);
  });

  test('removed --format flag exits 1 with a removal message', () => {
    const { code, output } = runCli(['q', '--format', 'csv']);
    assertEqual(code, 1);
    assertMatch(output, /--format option has been removed/);
  });

  test('removed --no-pdf flag exits 1 with a removal message', () => {
    const { code, output } = runCli(['q', '--no-pdf']);
    assertEqual(code, 1);
    assertMatch(output, /PDF download options have been removed/);
  });

  test('removed --retry flag exits 1 with a removal message', () => {
    const { code, output } = runCli(['q', '--retry']);
    assertEqual(code, 1);
    assertMatch(output, /PDF download options have been removed/);
  });

  test('--help short form (-h) prints usage and exits 0', () => {
    const { code, output } = runCli(['-h']);
    assertEqual(code, 0);
    assertMatch(output, /Usage:/);
  });

  test('explicit "search" subcommand is accepted and still requires a query', () => {
    const { code, output } = runCli(['search']);
    assertEqual(code, 1);
    assertMatch(output, /Please provide a search query/);
  });
});
