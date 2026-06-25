// Integration tests for resolveCitationsFile (no network).
// Uses options._searchPapers as a dependency-injection seam to avoid hitting
// real APIs while still exercising the full resolve flow end-to-end.

import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, test, assertEqual, assertOk, assertMatch, assertTruthy } from '../test-runner.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'lit-search-resolve-'));
}

async function loadResolveModule() {
  return import('../../lib/pool-ops.js');
}

function makeStubSearch(captured) {
  return async (args) => {
    captured.push(args);
    return {
      papers: [
        {
          seq_id: 1,
          title: 'Mock: ' + args.query,
          author: 'Mock Author',
          year: args.yearStart || 2020,
          journal: 'Mock Journal',
          doi: args.query.startsWith('10.') ? args.query : null,
          url: 'https://example.org/' + encodeURIComponent(args.query),
          source: 'mock',
          identifiers: {},
          pdf_candidates: [],
          references: [],
        },
      ],
    };
  };
}

suite('resolveCitationsFile integration: regression for v1.4 parser bugs', () => {
  test('single bare title resolves 1 paper (regression: was unresolved)', async () => {
    const project = makeTempDir();
    try {
      const inputFile = join(project, 'input.txt');
      writeFileSync(inputFile, 'Attention Is All You Need\n');
      const outDir = join(project, 'out');
      const captured = [];
      const { resolveCitationsFile } = await loadResolveModule();
      await resolveCitationsFile(inputFile, {
        outputDir: outDir,
        limit: 3,
        _searchPapers: makeStubSearch(captured),
      });
      const pool = JSON.parse(readFileSync(join(outDir, 'literature_pool.json'), 'utf-8'));
      assertEqual(pool.papers.length, 1);
      assertEqual(pool.unresolvedCitations.length, 0);
      assertEqual(captured.length, 1);
      assertMatch(captured[0].query, /Attention/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('114-line bare titles produce 114 resolved papers (regression: was 1)', async () => {
    const project = makeTempDir();
    try {
      const inputFile = join(project, 'input.txt');
      const lines = Array.from({ length: 114 }, (_, i) => `Paper Title Number ${i}`);
      writeFileSync(inputFile, lines.join('\n') + '\n');
      const outDir = join(project, 'out');
      const captured = [];
      const { resolveCitationsFile } = await loadResolveModule();
      await resolveCitationsFile(inputFile, {
        outputDir: outDir,
        _searchPapers: makeStubSearch(captured),
      });
      const pool = JSON.parse(readFileSync(join(outDir, 'literature_pool.json'), 'utf-8'));
      assertEqual(pool.papers.length, 114, 'should resolve all 114 lines');
      assertEqual(pool.unresolvedCitations.length, 0);
      assertEqual(captured.length, 114);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('2-line bare titles produce 2 resolved papers', async () => {
    const project = makeTempDir();
    try {
      const inputFile = join(project, 'input.txt');
      writeFileSync(
        inputFile,
        'Attention Is All You Need\nBERT: Pre-training of Deep Bidirectional Transformers\n'
      );
      const outDir = join(project, 'out');
      const captured = [];
      const { resolveCitationsFile } = await loadResolveModule();
      await resolveCitationsFile(inputFile, {
        outputDir: outDir,
        _searchPapers: makeStubSearch(captured),
      });
      const pool = JSON.parse(readFileSync(join(outDir, 'literature_pool.json'), 'utf-8'));
      assertEqual(pool.papers.length, 2);
      assertEqual(pool.unresolvedCitations.length, 0);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('BibTeX input resolves each entry', async () => {
    const project = makeTempDir();
    try {
      const inputFile = join(project, 'input.bib');
      writeFileSync(
        inputFile,
        '@article{a, title={Paper A}, year={2017}}\n@article{b, title={Paper B}, year={2019}}\n'
      );
      const outDir = join(project, 'out');
      const captured = [];
      const { resolveCitationsFile } = await loadResolveModule();
      await resolveCitationsFile(inputFile, {
        outputDir: outDir,
        _searchPapers: makeStubSearch(captured),
      });
      const pool = JSON.parse(readFileSync(join(outDir, 'literature_pool.json'), 'utf-8'));
      assertEqual(pool.papers.length, 2);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('unresolved citations are preserved with raw/title fields (regression: was all null)', async () => {
    const project = makeTempDir();
    try {
      const inputFile = join(project, 'input.txt');
      writeFileSync(inputFile, 'This Title Definitely Does Not Exist XYZ123\n');
      const outDir = join(project, 'out');
      const stub = async () => ({ papers: [] });
      const { resolveCitationsFile } = await loadResolveModule();
      await resolveCitationsFile(inputFile, { outputDir: outDir, _searchPapers: stub });
      const pool = JSON.parse(readFileSync(join(outDir, 'literature_pool.json'), 'utf-8'));
      assertEqual(pool.papers.length, 0);
      assertEqual(pool.unresolvedCitations.length, 1);
      const u = pool.unresolvedCitations[0];
      assertTruthy(u.raw && u.raw.length > 0, 'raw must not be null');
      assertTruthy(u.title && u.title.length > 0, 'title must not be null');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('output structure contains all 3 expected files', async () => {
    const project = makeTempDir();
    try {
      const inputFile = join(project, 'input.txt');
      writeFileSync(inputFile, 'Some Title\n');
      const outDir = join(project, 'out');
      const { resolveCitationsFile } = await loadResolveModule();
      await resolveCitationsFile(inputFile, {
        outputDir: outDir,
        _searchPapers: makeStubSearch([]),
      });
      assertOk(existsSync(join(outDir, 'search_meta.json')));
      assertOk(existsSync(join(outDir, 'literature_pool.json')));
      assertOk(existsSync(join(outDir, 'references.bib')));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('CRLF line endings are handled (regression: PowerShell/Windows users)', async () => {
    const project = makeTempDir();
    try {
      const inputFile = join(project, 'input.txt');
      writeFileSync(inputFile, 'Attention Is All You Need\r\nBERT: Pre-training\r\n');
      const outDir = join(project, 'out');
      const captured = [];
      const { resolveCitationsFile } = await loadResolveModule();
      await resolveCitationsFile(inputFile, {
        outputDir: outDir,
        _searchPapers: makeStubSearch(captured),
      });
      const pool = JSON.parse(readFileSync(join(outDir, 'literature_pool.json'), 'utf-8'));
      assertEqual(pool.papers.length, 2);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('BOM prefix is stripped', async () => {
    const project = makeTempDir();
    try {
      const inputFile = join(project, 'input.txt');
      writeFileSync(inputFile, '\uFEFFAttention Is All You Need\nBERT: Pre-training\n');
      const outDir = join(project, 'out');
      const captured = [];
      const { resolveCitationsFile } = await loadResolveModule();
      await resolveCitationsFile(inputFile, {
        outputDir: outDir,
        _searchPapers: makeStubSearch(captured),
      });
      const pool = JSON.parse(readFileSync(join(outDir, 'literature_pool.json'), 'utf-8'));
      assertEqual(pool.papers.length, 2);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
