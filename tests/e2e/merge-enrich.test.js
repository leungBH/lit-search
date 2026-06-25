// Integration tests for mergePools and enrichMetadata.
// These exercise the orchestration layer (file IO, deduplication,
// metadata merging) using a fake search backend where possible.
//
// To avoid network flakiness in CI, mergePools is invoked with explicit
// engines: { unpaywall: false, openCitations: false } so no API client
// is constructed.

import { readFileSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, test, assertEqual, assertOk, assertMatch, assertTruthy } from '../test-runner.js';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'lit-search-merge-'));
}

function buildPaper(seq, title, doi) {
  return {
    seq_id: seq,
    citation_key: `K${seq}`,
    title,
    author: 'Author',
    year: 2020,
    journal: 'J',
    doi,
    identifiers: doi ? { doi } : {},
    pdf_candidates: [],
    references: [],
  };
}

// Use a unique random 4-digit suffix per paper to avoid DOI prefix collisions
// (e.g. "10.1/a" and "10.1/ab" can be treated as the same key by some dedup
// heuristics).
let paperCounter = 0;
function uniquePaper(title) {
  paperCounter += 1;
  const nonce = Math.floor(Math.random() * 1e9);
  return buildPaper(
    paperCounter,
    title,
    `10.1234/${nonce.toString(36)}-${title.replace(/\W/g, '').slice(0, 8).toLowerCase()}`
  );
}

async function importPoolOps() {
  return import('../../lib/pool-ops.js');
}

async function importOutputFiles() {
  return import('../../lib/output-files.js');
}

suite('mergePools: file-IO and dedup (engines off, no network)', () => {
  test('merges two pools with overlapping papers and writes output', async () => {
    const project = makeTempDir();
    try {
      const dir1 = join(project, 'pool1');
      const dir2 = join(project, 'pool2');
      const outDir = join(project, 'merged');

      const { writeResultFiles } = await importOutputFiles();
      writeResultFiles(
        {
          metadata: { query: 'p1' },
          papers: [
            uniquePaper('Quantum chromodynamics'),
            uniquePaper('Reactive control systems'),
            uniquePaper('Photosynthetic pathways in algae'),
          ],
        },
        dir1,
        { mode: 'test', outputDir: dir1 }
      );
      writeResultFiles(
        {
          metadata: { query: 'p2' },
          papers: [
            uniquePaper('Quantum chromodynamics'),
            uniquePaper('Topological insulators'),
            uniquePaper('Photosynthetic pathways in algae'),
          ],
        },
        dir2,
        { mode: 'test', outputDir: dir2 }
      );

      const { mergePools } = await importPoolOps();
      // Engines explicitly disabled so no API client is constructed
      const result = await mergePools([dir1, dir2], outDir, {
        engines: { unpaywall: false, openCitations: false },
      });
      const poolFile = join(outDir, 'literature_pool.json');
      assertOk(existsSync(poolFile), 'pool file should be written');
      const pool = JSON.parse(readFileSync(poolFile, 'utf-8'));
      // 4 unique papers (Quantum chromodynamics and Photosynthetic pathways are
      // deduped; Topological insulators and Reactive control systems are distinct)
      assertEqual(pool.papers.length, 4, 'expected 4 unique papers');
      assertOk(existsSync(join(outDir, 'search_meta.json')));
      assertOk(existsSync(join(outDir, 'references.bib')));
      assertOk(result.pool, 'result should expose the merged pool');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('re-sequences papers starting from 1', async () => {
    const project = makeTempDir();
    try {
      const dir1 = join(project, 'pool1');
      const outDir = join(project, 'merged');
      const { writeResultFiles } = await importOutputFiles();
      writeResultFiles(
        {
          metadata: {},
          papers: [uniquePaper('Quantum chromodynamics'), uniquePaper('Topological insulators')],
        },
        dir1,
        { mode: 'test', outputDir: dir1 }
      );
      const { mergePools } = await importPoolOps();
      await mergePools([dir1], outDir, { engines: { unpaywall: false, openCitations: false } });
      const pool = JSON.parse(readFileSync(join(outDir, 'literature_pool.json'), 'utf-8'));
      assertOk(Array.isArray(pool.papers) && pool.papers.length === 2, 'expected 2 papers');
      assertEqual(pool.papers[0].seq_id, 1);
      assertEqual(pool.papers[1].seq_id, 2);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

suite('mergePools: edge cases', () => {
  test('empty pools array: still writes valid empty output', async () => {
    const project = makeTempDir();
    try {
      const dir1 = join(project, 'empty1');
      const outDir = join(project, 'merged');
      const { writeResultFiles } = await importOutputFiles();
      writeResultFiles({ metadata: {}, papers: [] }, dir1, { mode: 'test', outputDir: dir1 });
      const { mergePools } = await importPoolOps();
      await mergePools([dir1], outDir, { engines: { unpaywall: false, openCitations: false } });
      const pool = JSON.parse(readFileSync(join(outDir, 'literature_pool.json'), 'utf-8'));
      assertEqual(pool.papers.length, 0);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('search_meta.json records the merge source count', async () => {
    const project = makeTempDir();
    try {
      const d1 = join(project, 'a');
      const d2 = join(project, 'b');
      const out = join(project, 'm');
      const { writeResultFiles } = await importOutputFiles();
      writeResultFiles({ metadata: {}, papers: [uniquePaper('T1')] }, d1, {
        mode: 'test',
        outputDir: d1,
      });
      writeResultFiles({ metadata: {}, papers: [uniquePaper('U1')] }, d2, {
        mode: 'test',
        outputDir: d2,
      });
      const { mergePools } = await importPoolOps();
      await mergePools([d1, d2], out, { engines: { unpaywall: false, openCitations: false } });
      const meta = JSON.parse(readFileSync(join(out, 'search_meta.json'), 'utf-8'));
      // The merge command writes the source count into the nested metadata
      assertMatch(meta.metadata?.query || '', /^merged:2/);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

suite('enrichMetadata: shape smoke test (no network)', () => {
  test('runs on a minimal pool without throwing', async () => {
    const project = makeTempDir();
    try {
      const dir = join(project, 'pool');
      const { writeResultFiles } = await importOutputFiles();
      writeResultFiles(
        {
          metadata: {},
          papers: [buildPaper(1, 'Title', '10.1/x')],
        },
        dir,
        { mode: 'test', outputDir: dir }
      );

      const { enrichMetadata } = await importPoolOps();
      const result = await enrichMetadata(join(dir, 'literature_pool.json'), {
        fields: 'abstract',
        engines: { unpaywall: false, openCitations: false },
      });
      assertOk(result.pool);
      assertEqual(result.pool.papers.length, 1);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
