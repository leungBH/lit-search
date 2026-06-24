/**
 * Real-filesystem tests for `lib/output-files.js`.
 *
 * These functions do real disk I/O (read, write, mkdir), so we use a
 * mkdtempSync temp dir and clean it up afterwards. We pass the real
 * package.json through (not stubbed) because it's part of the API surface
 * 鈥?if the version field ever changes shape, that should be obvious.
 */

import { mkdtempSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { suite, test } from '../test-runner.js';
import { assertEqual, assertOk } from '../test-runner.js';

import {
  generateOutputFolderName,
  writeResultFiles,
  resolvePoolPath,
  readLiteraturePool
} from '../../lib/output-files.js';

let tempRoot;

function makeTempDir() {
  if (!tempRoot) tempRoot = mkdtempSync(join(tmpdir(), 'lit-search-out-'));
  return tempRoot;
}

function freshDir(label) {
  const dir = join(makeTempDir(), `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  return dir;
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// generateOutputFolderName
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

suite('output-files: generateOutputFolderName', () => {
  test('starts with "lit_search_"', () => {
    assertOk(generateOutputFolderName().startsWith('lit_search_'));
  });

  test('contains an 8-digit date followed by a 6-digit time', () => {
    const name = generateOutputFolderName();
    const m = name.match(/^lit_search_(\d{8})_(\d{6})$/);
    assertOk(m, `expected lit_search_YYYYMMDD_HHMMSS, got ${name}`);
  });

  test('two consecutive calls produce different folder names (time may tick)', () => {
    const a = generateOutputFolderName();
    // Sleep just past the second boundary to guarantee a different stamp
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    return sleep(1100).then(() => {
      const b = generateOutputFolderName();
      assertOk(a !== b, `expected different names, got both ${a}`);
    });
  });
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// resolvePoolPath
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

suite('output-files: resolvePoolPath (real fs)', () => {
  test('absolute .json path is returned as-is', () => {
    const file = join(makeTempDir(), 'pool.json');
    assertEqual(resolvePoolPath(file), file);
  });

  test('relative .json path is resolved against cwd', () => {
    const file = join(makeTempDir(), 'pool.json');
    // Use a basename-only path to make the resolve deterministic
    const base = file.split(/[\\/]/).pop();
    const out = resolvePoolPath(base);
    assertOk(out.endsWith(base), `expected to end with ${base}, got ${out}`);
  });

  test('directory containing literature_pool.json is appended', () => {
    const dir = freshDir('pool-dir');
    mkdirSync(dir, { recursive: true });
    // The resolver requires the file to actually exist.
    writeFileSync(join(dir, 'literature_pool.json'), '{}', 'utf-8');
    const expected = join(dir, 'literature_pool.json');
    assertEqual(resolvePoolPath(dir), expected);
  });

  test('directory WITHOUT literature_pool.json throws', () => {
    const dir = freshDir('no-pool');
    mkdirSync(dir, { recursive: true });
    let threw = null;
    try { resolvePoolPath(dir); } catch (e) { threw = e; }
    assertOk(threw, 'expected an error for directory without literature_pool.json');
    assertOk(/Cannot find literature_pool\.json/.test(threw.message));
  });

  test('non-existent .json path is returned (no existence check)', () => {
    const file = join(makeTempDir(), 'nope.json');
    // No throw 鈥?resolvePoolPath does not check existence for .json paths.
    assertEqual(resolvePoolPath(file), file);
  });
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// readLiteraturePool
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

suite('output-files: readLiteraturePool (real fs)', () => {
  test('parses JSON from a .json file', () => {
    const file = freshDir('read') + '.json';
    const data = { metadata: { query: 'q' }, papers: [{ title: 't' }] };
    writeFileSync(file, JSON.stringify(data), 'utf-8');
    const pool = readLiteraturePool(file);
    assertEqual(pool.metadata.query, 'q');
    assertEqual(pool.papers[0].title, 't');
  });

  test('BOM prefix is stripped before parsing', () => {
    const file = freshDir('read-bom') + '.json';
    const data = { metadata: { query: 'q' }, papers: [] };
    writeFileSync(file, '\uFEFF' + JSON.stringify(data), 'utf-8');
    const pool = readLiteraturePool(file);
    assertEqual(pool.metadata.query, 'q');
  });

  test('readLiteraturePool accepts a directory containing literature_pool.json', () => {
    const dir = freshDir('read-dir');
    mkdirSync(dir, { recursive: true });
    const data = { metadata: { query: 'q' }, papers: [{ title: 't' }] };
    writeFileSync(
      join(dir, 'literature_pool.json'),
      JSON.stringify(data),
      'utf-8'
    );
    const pool = readLiteraturePool(dir);
    assertEqual(pool.metadata.query, 'q');
  });
});

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// writeResultFiles
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

suite('output-files: writeResultFiles (real fs)', () => {
  test('creates output dir if it does not exist', () => {
    const dir = freshDir('write-mkdir');
    const result = { metadata: { query: 'q' }, papers: [] };
    const files = writeResultFiles(result, dir, { mode: 'search', outputDir: dir });
    assertOk(existsSync(dir), 'output dir should exist');
    assertOk(existsSync(files.bibFile));
    assertOk(existsSync(files.poolJsonFile));
    assertOk(existsSync(files.metaFile));
  });

  test('writes three files: references.bib, literature_pool.json, search_meta.json', () => {
    const dir = freshDir('write-three');
    const result = { metadata: { query: 'q' }, papers: [] };
    const files = writeResultFiles(result, dir, { mode: 'search', outputDir: dir });
    assertOk(files.bibFile.endsWith('references.bib'));
    assertOk(files.poolJsonFile.endsWith('literature_pool.json'));
    assertOk(files.metaFile.endsWith('search_meta.json'));
  });

  test('writes a non-empty BibTeX file for a paper with all fields', () => {
    const dir = freshDir('write-bib');
    const result = {
      metadata: { query: 'q' },
      papers: [{
        title: 'Some Paper',
        authors: ['Alice Smith', 'Bob Jones'],
        year: 2020,
        journal: 'J',
        doi: '10.1/x'
      }]
    };
    const files = writeResultFiles(result, dir, { mode: 'search', outputDir: dir });
    const bib = readFileSync(files.bibFile, 'utf-8');
    assertOk(bib.length > 0);
    assertOk(bib.includes('@'));
  });

  test('writes pretty-printed pool JSON (2-space indent)', () => {
    const dir = freshDir('write-json');
    const result = { metadata: { query: 'q' }, papers: [{ title: 'T' }] };
    const files = writeResultFiles(result, dir, { mode: 'search', outputDir: dir });
    const raw = readFileSync(files.poolJsonFile, 'utf-8');
    assertOk(raw.includes('\n  '), 'expected pretty-printed JSON (2-space indent + newline)');
  });

  test('writes search_meta.json with tool, version, mode and metadata', () => {
    const dir = freshDir('write-meta');
    const result = { metadata: { query: 'my query', finalCount: 5 }, papers: [] };
    const files = writeResultFiles(result, dir, { mode: 'merge', outputDir: dir });
    const meta = JSON.parse(readFileSync(files.metaFile, 'utf-8'));
    assertEqual(meta.tool, 'lit-search');
    assertEqual(meta.mode, 'merge');
    assertEqual(meta.metadata.query, 'my query');
    assertEqual(meta.metadata.finalCount, 5);
    assertOk(typeof meta.version === 'string');
    assertOk(meta.generatedAt);
  });

  test('mode defaults to "search" when not provided', () => {
    const dir = freshDir('write-mode-default');
    const result = { metadata: { query: 'q' }, papers: [] };
    const files = writeResultFiles(result, dir, { outputDir: dir });
    const meta = JSON.parse(readFileSync(files.metaFile, 'utf-8'));
    assertEqual(meta.mode, 'search');
  });

  test('UTF-8 output is valid (Chinese characters preserved)', () => {
    const dir = freshDir('write-utf8');
    const result = { metadata: { query: '涓枃鏌ヨ' }, papers: [{ title: '璁烘枃鏍囬' }] };
    const files = writeResultFiles(result, dir, { mode: 'search', outputDir: dir });
    const metaRaw = readFileSync(files.metaFile, 'utf-8');
    assertOk(metaRaw.includes('涓枃鏌ヨ'));
    const poolRaw = readFileSync(files.poolJsonFile, 'utf-8');
    assertOk(poolRaw.includes('璁烘枃鏍囬'));
  });
});

// Cleanup the shared temp dir at the end. mocha-style after() doesn't exist
// in our test runner, but the OS cleans tmpdir on reboot.
process.on('exit', () => {
  if (tempRoot) {
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
});

