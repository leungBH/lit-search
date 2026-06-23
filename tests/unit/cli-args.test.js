// Tests for CLI argument parsing, --help output, encoding, and platform-specific behavior.

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { suite, test, assertEqual, assertMatch, assertNotMatch, assertOk } from '../test-runner.js';
import { cliEntry } from '../test-runner.js';

suite('CLI: --help output', () => {
  test('contains all main subcommands', () => {
    const out = execFileSync(process.execPath, [cliEntry, '--help'], { encoding: 'utf-8' });
    assertMatch(out, /lit-search init/);
    assertMatch(out, /search_meta\.json/);
    assertMatch(out, /literature_pool\.json/);
    assertMatch(out, /references\.bib/);
  });

  test('documents resolve input formats', () => {
    const out = execFileSync(process.execPath, [cliEntry, '--help'], { encoding: 'utf-8' });
    assertMatch(out, /Resolve input formats/);
    assertMatch(out, /Bare title/);
    assertMatch(out, /Numbered list/);
    assertMatch(out, /Bracketed list/);
    assertMatch(out, /BibTeX/);
  });
});

suite('CLI: --version output', () => {
  test('matches semver pattern', () => {
    const out = execFileSync(process.execPath, [cliEntry, '--version'], { encoding: 'utf-8' });
    assertMatch(out.trim(), /^\d+\.\d+\.\d+/);
  });
});

suite('CLI: missing arguments exit with non-zero', () => {
  test('no args at all prints the help screen (not an error)', () => {
    // Per README, `lit-search` with no args is a "show help" invocation.
    // It should print help text and exit 0, not fail.
    let stdout = '';
    let exitCode = 0;
    try {
      stdout = execFileSync(process.execPath, [cliEntry], {
        encoding: 'utf-8',
        stdio: 'pipe'
      });
    } catch (err) {
      exitCode = err.status;
      stdout = (err.stdout || Buffer.alloc(0)).toString('utf-8');
    }
    assertEqual(exitCode, 0, '`lit-search` with no args should exit 0 and show help');
    assertMatch(stdout, /Usage:/);
    assertMatch(stdout, /lit-search search/);
  });

  test('resolve with no file fails', () => {
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [cliEntry, 'resolve'], {
        encoding: 'utf-8',
        stdio: 'pipe'
      });
    } catch (err) {
      exitCode = err.status;
    }
    assertOk(exitCode !== 0, 'resolve without file should exit non-zero');
  });

  test('merge with no -o fails', () => {
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [cliEntry, 'merge'], {
        encoding: 'utf-8',
        stdio: 'pipe'
      });
    } catch (err) {
      exitCode = err.status;
    }
    assertOk(exitCode !== 0, 'merge without inputs should exit non-zero');
  });

  test('enrich with no path fails', () => {
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [cliEntry, 'enrich'], {
        encoding: 'utf-8',
        stdio: 'pipe'
      });
    } catch (err) {
      exitCode = err.status;
    }
    assertOk(exitCode !== 0, 'enrich without pool should exit non-zero');
  });
});

suite('CLI: query argument is accepted (regression: "Unknown subcommand" bug)', () => {
  // Each entry is [args, expectedQueryEcho, label].
  // We assert that none of these trip the "Unknown subcommand" path and that
  // the CLI prints the expected query string before issuing any network calls.
  const cases = [
    { args: ['machine', 'learning'], expect: 'machine learning', label: 'two bare words (positional)' },
    { args: ['machine learning'], expect: 'machine learning', label: 'single quoted multi-word query' },
    { args: ['transformer'], expect: 'transformer', label: 'single bare word' },
    { args: ['AI, coding, agent'], expect: 'AI, coding, agent', label: 'comma-separated keywords' },
    { args: ['search', 'transformer'], expect: 'transformer', label: 'explicit search subcommand' },
    { args: ['search', 'machine learning'], expect: 'machine learning', label: 'search subcommand with multi-word query' },
    { args: ['-l', '1', 'transformer'], expect: 'transformer', label: 'flag before bare query' },
    { args: ['transformer', '-l', '1'], expect: 'transformer', label: 'flag after bare query' }
  ];

  for (const { args, expect, label } of cases) {
    test(`accepts: ${label}`, async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'lit-search-cli-query-'));
      try {
        const { stdout, stderr } = await runCliToOutputBlock(args, tempDir);
        assertNotMatch(stderr, /Unknown subcommand/, 'should not reject the query as an unknown subcommand');
        assertMatch(stdout, new RegExp(`Query:\\s*${escapeRegExp(expect)}`));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  }
});

suite('CLI: unknown CLI flags fail clearly', () => {
  test('unknown --flag exits non-zero', () => {
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [cliEntry, '--definitely-not-a-flag', 'query'], {
        encoding: 'utf-8',
        stdio: 'pipe'
      });
    } catch (err) {
      exitCode = err.status;
    }
    assertOk(exitCode !== 0, 'unknown --flag should exit non-zero');
  });
});

suite('CLI: known subcommands still recognized', () => {
  // The new contract: any non-empty first arg is treated as a query OR a
  // known subcommand (init/merge/enrich/resolve/search). These tests pin
  // the known-subcommand dispatch behavior.
  test('init subcommand is reachable and does not run a search', () => {
    let stderr = '';
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [cliEntry, 'init'], {
        encoding: 'utf-8',
        stdio: 'pipe',
        input: '\n' // answer the (optional) inquirer prompt with newline
      });
    } catch (err) {
      exitCode = err.status;
      stderr = (err.stderr || Buffer.alloc(0)).toString('utf-8');
    }
    // init may prompt interactively; we just need to confirm it did not
    // try to do a literature search.
    assertNotMatch(stderr, /Unknown subcommand/);
  });
});

suite('CLI: encoding safety (regression: PowerShell GBK mojibake)', () => {
  test('help output is valid UTF-8', () => {
    const out = execFileSync(process.execPath, [cliEntry, '--help'], {
      encoding: 'buffer',
      stdio: 'pipe'
    });
    const text = out.toString('utf-8');
    // No replacement characters from mis-decoded UTF-8
    assertEqual(text.includes('\uFFFD'), false, 'no UTF-8 replacement chars in help output');
  });

  test('on Windows, the entry point attempts to set UTF-8 console codepage', () => {
    if (process.platform !== 'win32') return;
    const source = readSource('bin/lit-search.js');
    assertMatch(source, /chcp 65001/);
    assertMatch(source, /setDefaultEncoding\('utf8'\)/);
  });
});

suite('MCP: resolve_citations tool schema (regression: 1.4 documentation drift)', () => {
  test('inputSchema documents all supported citation formats', () => {
    // We can't easily instantiate the McpServer in tests, so we assert on the
    // source code: the inputSchema.citationsFile description must mention
    // bare title, DOI, and BibTeX — not just numbered/bracketed (which was the
    // 1.4 documentation lie that confused users).
    const source = readSource('bin/lit-search-mcp.js');
    assertMatch(source, /citationsFile: z\.string\(\)\.min\(1\)/);
    assertMatch(source, /bare title/);
    assertMatch(source, /DOI/);
    assertMatch(source, /BibTeX/);
  });

  test('all 4 MCP tools are registered', () => {
    const source = readSource('bin/lit-search-mcp.js');
    assertMatch(source, /'search_literature'/);
    assertMatch(source, /'merge_pools'/);
    assertMatch(source, /'enrich_metadata'/);
    assertMatch(source, /'resolve_citations'/);
  });
});

function readSource(relPath) {
  return readFileSync(resolve(process.cwd(), relPath), 'utf-8');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Run the CLI in a child process against an isolated output dir, then kill it
 * as soon as it has emitted the "Query:" header (i.e. after CLI parsing but
 * before/while it is performing network calls). This lets us assert on
 * argument parsing without doing real network work.
 */
function runCliToOutputBlock(args, outputDir) {
  const child = spawn(process.execPath, [cliEntry, ...args, '--output-dir', outputDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' }
  });

  let stdout = '';
  let stderr = '';
  let killed = false;

  return new Promise((resolveP, rejectP) => {
    let headerSeen = false;
    const timer = setTimeout(() => {
      if (!killed) {
        killed = true;
        child.kill();
      }
    }, 30000);

    function check() {
      if (headerSeen) return;
      if (/Query:/.test(stdout)) {
        headerSeen = true;
        // Give it a tiny moment to flush any error output too, then kill.
        setTimeout(() => {
          if (!killed) {
            killed = true;
            child.kill();
          }
          clearTimeout(timer);
          resolveP({ stdout, stderr });
        }, 50);
      }
    }

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf-8');
      check();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf-8');
      check();
    });
    child.on('error', err => {
      clearTimeout(timer);
      rejectP(err);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolveP({ stdout, stderr });
    });
  });
}
