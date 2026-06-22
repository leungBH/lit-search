// Tests for CLI argument parsing, --help output, encoding, and platform-specific behavior.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { suite, test, assertEqual, assertMatch, assertOk } from '../test-runner.js';
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

suite('CLI: unknown subcommand exits with non-zero', () => {
  test('unknown verb fails', () => {
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [cliEntry, 'definitely-not-a-subcommand'], {
        encoding: 'utf-8',
        stdio: 'pipe'
      });
    } catch (err) {
      exitCode = err.status;
    }
    assertOk(exitCode !== 0, 'unknown subcommand should exit non-zero');
  });
});

suite('CLI: missing arguments exit with non-zero', () => {
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
