/**
 * workflow.js — top-level orchestrator.
 *
 * The workflow module is a thin glue layer: it calls searchPapers,
 * resolvePublicationsInPool, writeResultFiles, and renderBibTeX, then
 * assembles the final result object. We exercise it end-to-end with
 * a single engine (OpenAlex) stubbed by nock, so the test stays fast
 * but still flows through every code path inside runLitSearchWorkflow.
 */
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nock from 'nock';

import { runLitSearchWorkflow } from '../../lib/workflow.js';
import { OpenAlexAPI } from '../../lib/apis/index.js';
import {
  suite,
  test,
  beforeEach,
  assertEqual,
  assertDeepEqual,
  assertOk,
  assertFalsy,
  assertMatch,
  silentLogger,
  cleanNockBeforeEach,
} from './helpers.js';

const SILENT = { ...silentLogger, info: () => {}, warn: () => {}, debug: () => {} };

const OA_BASE = 'https://api.openalex.org';

function makeOA(id, title) {
  return {
    id: `https://openalex.org/W${id}`,
    doi: `10.1234/${id}`,
    title,
    display_name: title,
    publication_year: 2024,
    publication_date: '2024-01-15',
    authorships: [{ author: { display_name: 'Alice' } }, { author: { display_name: 'Bob' } }],
    primary_location: {
      source: { display_name: 'Journal of Tests' },
      pdf_url: `https://example.org/${id}.pdf`,
      landing_page_url: `https://example.org/${id}`,
    },
    best_oa_location: { pdf_url: `https://example.org/${id}.pdf`, license: 'cc-by' },
    concepts: [{ display_name: 'CS' }],
    type: 'journal-article',
    cited_by_count: 12,
    ids: { openalex: `W${id}` },
  };
}

let tempRoot;

function makeTempDir() {
  if (!tempRoot) tempRoot = mkdtempSync(join(tmpdir(), 'lit-search-workflow-'));
  return tempRoot;
}

suite('workflow: runLitSearchWorkflow — happy path', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns result, bibtex, and writes 3 output files', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, {
        results: [
          makeOA('a', 'First workflow paper on graphs'),
          makeOA('b', 'Second workflow paper on networks'),
        ],
        meta: { count: 2 },
      });

    const outputDir = join(makeTempDir(), `run-${Date.now()}`);
    const out = await runLitSearchWorkflow({
      query: 'paper',
      limit: 5,
      engines: {
        semanticScholar: false,
        openalex: true,
        arxiv: false,
        crossref: false,
        core: false,
        europePmc: false,
        dblp: false,
        doaj: false,
        pubmed: false,
        unpaywall: false,
        openCitations: false,
      },
      logger: SILENT,
      outputDir,
    });

    assertOk(out.result);
    assertOk(Array.isArray(out.result.papers));
    assertOk(out.result.papers.length >= 1);
    assertOk(out.bibtex);
    assertMatch(out.bibtex, /^% lit-search references/);

    assertEqual(out.output.outputDir, outputDir);
    assertOk(existsSync(out.output.bibFile));
    assertOk(existsSync(out.output.poolJsonFile));
    assertOk(existsSync(out.output.metaFile));
  });

  test('output.files manifest has 3 entries with correct types and roles', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, {
        results: [makeOA('a', 'Manifest test paper')],
        meta: { count: 1 },
      });

    const outputDir = join(makeTempDir(), `manifest-${Date.now()}`);
    const out = await runLitSearchWorkflow({
      query: 'paper',
      limit: 3,
      engines: {
        semanticScholar: false,
        openalex: true,
        arxiv: false,
        crossref: false,
        core: false,
        europePmc: false,
        dblp: false,
        doaj: false,
        pubmed: false,
        unpaywall: false,
        openCitations: false,
      },
      logger: SILENT,
      outputDir,
    });

    assertEqual(out.output.files.length, 3);

    const roles = out.output.files.map((f) => f.role).sort();
    assertDeepEqual(roles, ['citation_export', 'literature_pool', 'search_metadata']);

    const json = out.output.files.find((f) => f.role === 'search_metadata');
    assertEqual(json.type, 'json');
    assertOk(json.description);
  });

  test('output.metadata flows through to searchPapers', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, { results: [], meta: { count: 0 } });
    const outputDir = join(makeTempDir(), `meta-${Date.now()}`);
    const out = await runLitSearchWorkflow({
      query: 'no matches',
      limit: 3,
      engines: {
        semanticScholar: false,
        openalex: true,
        arxiv: false,
        crossref: false,
        core: false,
        europePmc: false,
        dblp: false,
        doaj: false,
        pubmed: false,
        unpaywall: false,
        openCitations: false,
      },
      logger: SILENT,
      outputDir,
    });
    assertEqual(out.result.metadata.query, 'no matches');
    assertEqual(out.result.metadata.finalCount, 0);
  });

  test('literature_pool.json on disk matches in-memory result', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, { results: [makeOA('a', 'Disk roundtrip paper on graphs')], meta: { count: 1 } });

    const outputDir = join(makeTempDir(), `disk-${Date.now()}`);
    const out = await runLitSearchWorkflow({
      query: 'paper',
      limit: 3,
      engines: {
        semanticScholar: false,
        openalex: true,
        arxiv: false,
        crossref: false,
        core: false,
        europePmc: false,
        dblp: false,
        doaj: false,
        pubmed: false,
        unpaywall: false,
        openCitations: false,
      },
      logger: SILENT,
      outputDir,
    });

    assertOk(out.result.papers.length >= 1);
    const onDisk = JSON.parse(readFileSync(out.output.poolJsonFile, 'utf-8'));
    assertEqual(onDisk.papers.length, out.result.papers.length);
    assertEqual(onDisk.papers[0].title, out.result.papers[0].title);
  });

  test('search_meta.json contains tool=lit-search and version', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, { results: [makeOA('a', 'Meta test paper')], meta: { count: 1 } });

    const outputDir = join(makeTempDir(), `meta-json-${Date.now()}`);
    const out = await runLitSearchWorkflow({
      query: 'paper',
      limit: 3,
      engines: {
        semanticScholar: false,
        openalex: true,
        arxiv: false,
        crossref: false,
        core: false,
        europePmc: false,
        dblp: false,
        doaj: false,
        pubmed: false,
        unpaywall: false,
        openCitations: false,
      },
      logger: SILENT,
      outputDir,
    });

    const meta = JSON.parse(readFileSync(out.output.metaFile, 'utf-8'));
    assertEqual(meta.tool, 'lit-search');
    assertOk(meta.version);
    assertEqual(meta.mode, 'search');
  });
});

suite('workflow: runLitSearchWorkflow — output dir generation', () => {
  beforeEach(cleanNockBeforeEach);

  test('uses provided outputDir when given', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, { results: [], meta: { count: 0 } });
    const outputDir = join(makeTempDir(), `explicit-${Date.now()}`);
    const out = await runLitSearchWorkflow({
      query: 'paper',
      limit: 3,
      engines: {
        semanticScholar: false,
        openalex: true,
        arxiv: false,
        crossref: false,
        core: false,
        europePmc: false,
        dblp: false,
        doaj: false,
        pubmed: false,
        unpaywall: false,
        openCitations: false,
      },
      logger: SILENT,
      outputDir,
    });
    assertEqual(out.output.outputDir, outputDir);
    assertOk(existsSync(outputDir));
  });

  test('auto-generates an output folder under outputBaseDir when outputDir omitted', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, { results: [], meta: { count: 0 } });
    const baseDir = makeTempDir();
    const out = await runLitSearchWorkflow({
      query: 'paper',
      limit: 3,
      engines: {
        semanticScholar: false,
        openalex: true,
        arxiv: false,
        crossref: false,
        core: false,
        europePmc: false,
        dblp: false,
        doaj: false,
        pubmed: false,
        unpaywall: false,
        openCitations: false,
      },
      logger: SILENT,
      outputBaseDir: baseDir,
    });
    assertMatch(out.output.outputDir, /lit_search_\d{8}_\d{6}$/);
    assertOk(existsSync(out.output.outputDir));
  });
});

suite('workflow: runLitSearchWorkflow — defaults', () => {
  beforeEach(cleanNockBeforeEach);

  test('passes default limit=3 when not provided', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, { results: [], meta: { count: 0 } });
    const out = await runLitSearchWorkflow({
      query: 'paper',
      engines: {
        semanticScholar: false,
        openalex: true,
        arxiv: false,
        crossref: false,
        core: false,
        europePmc: false,
        dblp: false,
        doaj: false,
        pubmed: false,
        unpaywall: false,
        openCitations: false,
      },
      logger: SILENT,
      outputDir: join(makeTempDir(), `default-${Date.now()}`),
    });
    // limit isn't surfaced in the output but the call should succeed
    assertOk(out);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Cleanup the temp dir when the process exits so the OS doesn't fill up.
// (No afterAll in our runner, so attach to a process signal once.)
let cleaned = false;
function cleanupTempDir() {
  if (cleaned || !tempRoot) return;
  try {
    rmSync(tempRoot, { recursive: true, force: true });
    cleaned = true;
  } catch {
    /* best effort */
  }
}
process.once('exit', cleanupTempDir);
process.once('SIGINT', () => {
  cleanupTempDir();
  process.exit(0);
});
