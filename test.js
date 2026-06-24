#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import chalk from 'chalk';
import { renderBibTeX } from './lib/output.js';
import { writeResultFiles } from './lib/output-files.js';
import { normalizePdfCandidates } from './lib/pdf-candidates.js';
import { enrichMetadataInPool } from './lib/metadata-enricher.js';
import { resolvePublicationForPaper } from './lib/publication-resolver.js';
import { generateQueries } from './lib/search.js';
import { EuropePmcAPI, DblpAPI, DoajAPI } from './lib/apis/index.js';
import { parseRetryAfterMs } from './lib/apis/semantic-scholar.js';
import { getEnvApiKeys } from './lib/app-config.js';

const cliEntry = resolve(process.cwd(), 'bin/lit-search.js');
const mcpEntry = resolve(process.cwd(), 'bin/lit-search-mcp.js');
const localKeyFile = resolve(process.cwd(), 'temp/local-secrets/key.json');
const NETWORK_TIMEOUT_MS = 300000;

async function main() {
  console.log(chalk.bold.cyan('\nlit-search acceptance test\n'));

  const keyEnv = loadKeyEnv();
  const results = [];

  results.push(await runTest('CLI help', testCliHelp));
  results.push(await runTest('BibTeX renderer', testBibTeXRenderer));
  results.push(await runTest('result file output', testResultFiles));
  results.push(await runTest('PDF candidate normalization', testPdfCandidateNormalization));
  results.push(await runTest('new source normalizers', testNewSourceNormalizers));
  results.push(await runTest('free source config keys', testFreeSourceConfigKeys));
  results.push(await runTest('Semantic Scholar Retry-After parser', testSemanticScholarRetryAfterParser));
  results.push(await runTest('publication resolution', testPublicationResolution));
  results.push(await runTest('metadata enrichment', testMetadataEnrichment));
  results.push(await runTest('query expansion', testQueryExpansion));
  results.push(await runTest('parallel source orchestration', testParallelSourceOrchestration));
  results.push(await runTest('MCP handshake', () => testMcpHandshake(keyEnv)));
  results.push(await runTest('MCP pool workflow tools', () => testMcpPoolWorkflowTools(keyEnv)));

  if (process.env.LIT_SEARCH_SKIP_NETWORK_TESTS === '1') {
    console.log(chalk.yellow('\nLIT_SEARCH_SKIP_NETWORK_TESTS=1. Skipping network tests.'));
  } else if (!hasAnyKeys(keyEnv)) {
    console.log(chalk.yellow('\nNo API keys found. Skipping network tests.'));
  } else {
    results.push(await runTest('CLI folder output', () => runCliNetworkTest(['machine learning', '-l', '2', '-s', '2022'], keyEnv)));
    results.push(await runTest('MCP tools/call', () => runMcpNetworkTest(keyEnv)));
  }

  printSummary(results);
  process.exit(results.some(item => !item.ok) ? 1 : 0);
}

async function runTest(name, fn) {
  console.log(`\n${chalk.bold('-'.repeat(64))}`);
  console.log(name);
  console.log('-'.repeat(64));

  try {
    await fn();
    console.log(chalk.green('PASS'));
    return { name, ok: true };
  } catch (error) {
    console.log(chalk.red('FAIL'));
    console.log(chalk.gray(error.stack || error.message));
    return { name, ok: false, error };
  }
}

function testCliHelp() {
  const output = execFileSync(process.execPath, [cliEntry, '--help'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    stdio: 'pipe'
  });

  assert.match(output, /lit-search init/);
  assert.match(output, /search_meta\.json/);
  assert.match(output, /literature_pool\.json/);
  assert.match(output, /references\.bib/);
  assert.match(output, /--output-dir/);
  assert.match(output, /--resolve-preprint/);
  assert.match(output, /--prefer-published/);
  assert.match(output, /NCBI API Key/);
  assert.match(output, /Unpaywall email/);
  assert.match(output, /lit-search enrich/);
  assert.match(output, /--enrich/);
  assert.match(output, /--only-missing/);
  assert.match(output, /--checkpoint-interval/);
  assert.match(output, /--concurrency/);
  assert.doesNotMatch(output, /--pdf/);
  assert.doesNotMatch(output, /pdf_status\.md/);
  assert.doesNotMatch(output, /pdfs\//);
  assert.doesNotMatch(output, /--format/);
}

function testBibTeXRenderer() {
  const fixture = buildFixturePool();
  const bib = renderBibTeX(fixture);

  assert.match(bib, /^% lit-search references/m);
  assert.match(bib, /@article\{Smith2024_1,/);
  assert.match(bib, /title = \{A Study on Machine Learning\}/);
  assert.match(bib, /author = \{Alice Smith and Bob Lee\}/);
  assert.match(bib, /journal = \{Journal of Examples\}/);
  assert.match(bib, /doi = \{10\.1000\/example\}/);
  assert.match(bib, /keywords = \{machine learning, classification\}/);
  assert.doesNotMatch(bib, /pdfurl/);
  assert.doesNotMatch(bib, /pdfcandidates/);
  assert.doesNotMatch(bib, /citationcount/);
}

async function testPublicationResolution() {
  const arxivPaper = {
    seq_id: 1,
    citation_key: 'Vaswani2017_1',
    entry_type: 'misc',
    title: 'Attention Is All You Need',
    author: 'Ashish Vaswani and Noam Shazeer',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    year: 2017,
    journal: 'arXiv',
    venue: 'arXiv',
    doi: null,
    url: 'https://arxiv.org/abs/1706.03762',
    arxiv_id: '1706.03762',
    primary_category: 'cs.CL',
    identifiers: { arxiv: '1706.03762' },
    pdf_candidates: [
      {
        url: 'https://arxiv.org/pdf/1706.03762.pdf',
        source: 'arxiv',
        provider: 'arxiv',
        access_type: 'arxiv',
        confidence: 0.98
      }
    ],
    source: 'arxiv'
  };

  const openalexFormal = {
    title: 'Attention Is All You Need',
    author: 'Ashish Vaswani and Noam Shazeer',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    year: 2017,
    journal: 'Advances in Neural Information Processing Systems',
    venue: 'Advances in Neural Information Processing Systems',
    pages: '5998-6008',
    doi: '10.5555/3295222.3295349',
    url: 'https://papers.nips.cc/paper/7181-attention-is-all-you-need',
    source: 'openalex',
    identifiers: { openalex: 'https://openalex.org/W123', doi: '10.5555/3295222.3295349' }
  };

  const resolved = await resolvePublicationForPaper(arxivPaper, {
    preferPublished: true,
    openalex: {
      fetchWorkByDoi: async () => null,
      fetchWorkById: async () => null,
      searchWorks: async () => [openalexFormal]
    }
  });

  assert.equal(resolved.publication_status, 'published');
  assert.equal(resolved.citation_metadata_preference, 'published_version');
  assert.equal(resolved.doi, '10.5555/3295222.3295349');
  assert.equal(resolved.journal, 'Advances in Neural Information Processing Systems');
  assert.equal(resolved.pages, '5998-6008');
  assert.equal(resolved.preprint.arxiv_id, '1706.03762');
  assert.equal(resolved.identity.arxiv_id, '1706.03762');

  const bib = renderBibTeX({ metadata: {}, papers: [resolved] });
  assert.match(bib, /doi = \{10\.5555\/3295222\.3295349\}/);
  assert.match(bib, /journal = \{Advances in Neural Information Processing Systems\}/);
  assert.match(bib, /pages = \{5998-6008\}/);
  assert.match(bib, /eprint = \{1706\.03762\}/);
  assert.match(bib, /archivePrefix = \{arXiv\}/);
}

function testResultFiles() {
  const tempDir = mkdtempSync(join(tmpdir(), 'lit-search-files-'));
  try {
    const files = writeResultFiles(buildFixturePool(), tempDir, { mode: 'test', outputDir: tempDir });
    assert.ok(existsSync(files.metaFile));
    assert.ok(existsSync(files.poolJsonFile));
    assert.ok(existsSync(files.bibFile));
    assert.equal(existsSync(join(tempDir, 'literature_pool.md')), false);
    assert.equal(existsSync(join(tempDir, 'results.md')), false);
    assert.equal(existsSync(join(tempDir, 'pdf_status.md')), false);
    assert.equal(existsSync(join(tempDir, 'pdfs')), false);

    const meta = JSON.parse(readFileSync(files.metaFile, 'utf-8'));
    assert.match(meta.version, /^\d+\.\d+\.\d+/);
    assert.equal(meta.files.searchMeta, 'search_meta.json');
    assert.equal(meta.files.literaturePool, 'literature_pool.json');
    assert.equal(meta.files.references, 'references.bib');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testPdfCandidateNormalization() {
  const candidates = normalizePdfCandidates([
    {
      source: 'crossref',
      provider: 'publisher.example',
      url: 'https://publisher.example/paper.pdf',
      access_type: 'crossref_pdf_link',
      license: null,
      is_oa: false,
      confidence: 0.52,
      reason: 'CrossRef PDF link.'
    },
    {
      source: 'arxiv',
      provider: 'arxiv',
      url: 'https://arxiv.org/pdf/1234.5678.pdf',
      access_type: 'arxiv',
      license: null,
      is_oa: true,
      confidence: 0.98,
      reason: 'arXiv PDF.'
    }
  ]);

  assert.equal(candidates[0].access_type, 'arxiv');
  assert.equal(candidates[0].rank, 1);
  assert.deepEqual(Object.keys(candidates[0]), [
    'url',
    'source',
    'provider',
    'access_type',
    'license',
    'is_oa',
    'confidence',
    'reason',
    'rank'
  ]);
}

function testNewSourceNormalizers() {
  const europePmc = new EuropePmcAPI()._normalizeItem({
    id: '123',
    pmid: '123',
    pmcid: 'PMC123',
    doi: '10.1000/pmc',
    title: 'Europe PMC Example',
    authorString: 'Alice Smith, Bob Lee',
    pubYear: '2024',
    journalTitle: 'Example Medicine',
    abstractText: 'A medical abstract.',
    keywordList: { keyword: ['medicine'] },
    fullTextUrlList: { fullTextUrl: [{ url: 'https://example.org/a.pdf', documentStyle: 'pdf', availability: 'Open access', site: 'PMC' }] }
  });
  assert.equal(europePmc.source, 'europe-pmc');
  assert.equal(europePmc.identifiers.pmid, '123');
  assert.equal(europePmc.identifiers.pmcid, 'PMC123');
  assert.equal(europePmc.pdfCandidates.length, 1);

  const dblp = new DblpAPI()._normalizeHit({
    info: {
      key: 'conf/example/Smith24',
      title: 'DBLP Example',
      authors: { author: [{ text: 'Alice Smith' }] },
      year: '2024',
      venue: 'ICML',
      type: 'Conference and Workshop Papers',
      ee: 'https://doi.org/10.1000/dblp',
      pages: '1-10'
    }
  });
  assert.equal(dblp.source, 'dblp');
  assert.equal(dblp.identifiers.dblp, 'conf/example/Smith24');
  assert.equal(dblp.doi, '10.1000/dblp');
  assert.equal(dblp.booktitle, 'ICML');

  const doaj = new DoajAPI()._normalizeItem({
    id: 'doaj-1',
    bibjson: {
      title: 'DOAJ Example',
      year: '2024',
      author: [{ name: 'Alice Smith' }],
      journal: { title: 'Open Journal', publisher: 'OA Press', volume: '1', number: '2' },
      identifier: [{ type: 'doi', id: '10.1000/doaj' }, { type: 'eissn', id: '1234-5678' }],
      abstract: 'An open access abstract.',
      keywords: ['open access'],
      link: [{ url: 'https://example.org/doaj.pdf', type: 'fulltext' }]
    }
  });
  assert.equal(doaj.source, 'doaj');
  assert.equal(doaj.doi, '10.1000/doaj');
  assert.equal(doaj.journal, 'Open Journal');
  assert.equal(doaj.pdfCandidates.length, 2);
}

function testFreeSourceConfigKeys() {
  const keys = getEnvApiKeys({
    LIT_SEARCH_NCBI_API_KEY: 'ncbi-test',
    LIT_SEARCH_UNPAYWALL_EMAIL: 'test@example.org'
  });
  assert.equal(keys.ncbi, 'ncbi-test');
  assert.equal(keys.unpaywallEmail, 'test@example.org');
}

function testSemanticScholarRetryAfterParser() {
  assert.equal(parseRetryAfterMs('3'), 3000);
  assert.equal(parseRetryAfterMs('0'), 0);
  const future = new Date(Date.now() + 5000).toUTCString();
  const parsed = parseRetryAfterMs(future);
  assert.ok(parsed >= 0 && parsed <= 6000);
  assert.equal(parseRetryAfterMs('not-a-date'), null);
}

async function testMetadataEnrichment() {
  const pool = {
    metadata: { query: 'fixture' },
    papers: [
      {
        seq_id: 1,
        title: 'Missing Abstract Paper',
        doi: '10.1000/missing',
        abstract: null,
        pdf_candidates: []
      }
    ]
  };
  const result = await enrichMetadataInPool(pool, {
    resolvers: {
      openalexByDoi: async () => ({
        abstract: 'Recovered abstract.',
        keywords: ['recovered'],
        journal: 'Recovered Journal',
        pdfCandidates: []
      })
    }
  });

  assert.equal(result.stats.enrichedPapers, 1);
  assert.ok(result.stats.enrichedFields >= 2);
  assert.equal(pool.papers[0].abstract, 'Recovered abstract.');
  assert.equal(pool.papers[0].journal, 'Recovered Journal');
  assert.equal(pool.papers[0].abstract_status, 'enriched');
  assert.equal(pool.papers[0].abstract_source, 'openalex.doi');
  assert.equal(pool.papers[0].metadata_enrichment.resolved_fields.abstract, 'openalex.doi');

  let checkpoints = 0;
  const checkpointPool = {
    metadata: { query: 'checkpoint fixture' },
    papers: [
      { seq_id: 1, title: 'Existing Abstract Paper', abstract: 'Already present.' },
      { seq_id: 2, title: 'Missing Abstract Paper', doi: '10.1000/checkpoint', abstract: null }
    ]
  };
  const checkpointResult = await enrichMetadataInPool(checkpointPool, {
    fields: 'abstract',
    onlyMissing: true,
    concurrency: 2,
    checkpointInterval: 1,
    onCheckpoint: async () => { checkpoints++; },
    resolvers: {
      openalexByDoi: async () => ({ abstract: 'Recovered checkpoint abstract.' })
    }
  });

  assert.equal(checkpointResult.stats.complete, 1);
  assert.equal(checkpointResult.stats.attempted, 1);
  assert.equal(checkpointResult.stats.enrichedPapers, 1);
  assert.ok(checkpoints >= 2);
  assert.equal(checkpointPool.papers[0].abstract, 'Already present.');
  assert.equal(checkpointPool.papers[1].abstract, 'Recovered checkpoint abstract.');
  assert.equal(checkpointPool.metadata.metadataEnrichment.onlyMissing, true);
}

function testQueryExpansion() {
  assert.deepEqual(generateQueries('AI, coding, agent', [], 'none'), ['AI', 'coding', 'agent']);
  assert.deepEqual(generateQueries('AI, coding, agent', [], 'pairwise'), [
    'AI coding',
    'AI agent',
    'coding agent',
    'AI',
    'coding',
    'agent'
  ]);
  assert.deepEqual(generateQueries('AI, coding, agent', [], 'full'), [
    'AI coding agent',
    'AI coding',
    'AI agent',
    'coding agent',
    'AI',
    'coding',
    'agent'
  ]);
}

function testParallelSourceOrchestration() {
  const source = readFileSync(resolve(process.cwd(), 'lib/search.js'), 'utf-8');
  assert.match(source, /Promise\.all\(/);
  assert.match(source, /engineList\.map/);
  assert.match(source, /async function searchEngineQuery/);
  assert.match(source, /SAME_SOURCE_QUERY_DELAY_MS = 1100/);
  assert.match(source, /setTimeout\(r, SAME_SOURCE_QUERY_DELAY_MS\)/);
}

async function testMcpHandshake(env) {
  const responses = await interactWithMcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acceptance-test', version: '1.0.0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
  ], env);

  assert.equal(responses[0].result.serverInfo.name, 'lit-search-mcp');
  const tools = responses[1].result.tools;
  const names = tools.map(tool => tool.name);
  assert.deepEqual(names, [
    'search_literature',
    'merge_pools',
    'enrich_metadata',
    'resolve_citations'
  ]);
  const searchTool = tools.find(tool => tool.name === 'search_literature');
  assert.equal(searchTool.inputSchema.properties.format, undefined);
  assert.equal(searchTool.inputSchema.properties.downloadPdf, undefined);
  assert.ok(searchTool.inputSchema.properties.outputDir);
  assert.ok(tools.find(tool => tool.name === 'merge_pools').inputSchema.properties.outputDir);
  assert.ok(tools.find(tool => tool.name === 'enrich_metadata').inputSchema.properties.poolPath);
  assert.ok(tools.find(tool => tool.name === 'enrich_metadata').inputSchema.properties.onlyMissing);
}

async function testMcpPoolWorkflowTools(env) {
  const tempDir = mkdtempSync(join(tmpdir(), 'lit-search-mcp-pool-'));
  const poolDir = join(tempDir, 'pool1');
  const mergedDir = join(tempDir, 'merged');

  try {
    writeResultFiles(buildFixturePool(), poolDir, { mode: 'test', outputDir: poolDir });
    const poolPath = join(poolDir, 'literature_pool.json');

    const responses = await interactWithMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acceptance-test', version: '1.0.0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'merge_pools', arguments: { inputs: [poolDir], outputDir: mergedDir } } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'enrich_metadata', arguments: { poolPath, fields: 'abstract', onlyMissing: true, checkpointInterval: 0, concurrency: 1 } } }
    ], env);

    const byId = new Map(responses.map(response => [response.id, response]));
    assert.equal(byId.get(2).result.structuredContent.papers.length, 1);
    assert.ok(byId.get(3).result.structuredContent.metadataSummary);
    assert.ok(existsSync(join(mergedDir, 'search_meta.json')));
    assert.ok(existsSync(join(mergedDir, 'literature_pool.json')));
    assert.ok(existsSync(join(mergedDir, 'references.bib')));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runCliNetworkTest(args, env) {
  const tempDir = mkdtempSync(join(tmpdir(), 'lit-search-acceptance-'));

  try {
    execFileSync(process.execPath, [cliEntry, ...args], {
      cwd: tempDir,
      encoding: 'utf-8',
      timeout: NETWORK_TIMEOUT_MS,
      stdio: 'pipe',
      env: { ...process.env, ...env }
    });

    const outputDir = findNewestOutputDir(tempDir);
    assert.ok(outputDir, 'No output directory found.');
    assert.ok(existsSync(join(outputDir, 'search_meta.json')));
    assert.ok(existsSync(join(outputDir, 'literature_pool.json')));
    assert.ok(existsSync(join(outputDir, 'references.bib')));
    assert.equal(existsSync(join(outputDir, 'pdf_status.md')), false);
    assert.equal(existsSync(join(outputDir, 'pdfs')), false);

    const pool = JSON.parse(readFileSync(join(outputDir, 'literature_pool.json'), 'utf-8'));
    const meta = JSON.parse(readFileSync(join(outputDir, 'search_meta.json'), 'utf-8'));
    const bib = readFileSync(join(outputDir, 'references.bib'), 'utf-8');
    assert.ok(pool.papers.length >= 1);
    assert.match(meta.version, /^\d+\.\d+\.\d+/);
    assert.equal(meta.files.literaturePool, 'literature_pool.json');
    assert.match(bib, /^% lit-search references/m);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runMcpNetworkTest(env) {
  const responses = await interactWithMcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acceptance-test', version: '1.0.0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_literature', arguments: { query: 'natural language processing', limit: 2, yearStart: 2022, searchScope: 'title-abstract' } } }
  ], env, NETWORK_TIMEOUT_MS);

  const toolResult = responses[1].result;
  assert.ok(toolResult.structuredContent);
  assert.ok(toolResult.structuredContent.papers.length >= 1);
  assert.ok(existsSync(toolResult.structuredContent.output.metaFile));
  assert.ok(existsSync(toolResult.structuredContent.output.poolJsonFile));
  assert.ok(existsSync(toolResult.structuredContent.output.bibFile));
  assert.equal(toolResult.structuredContent.output.pdfDir, undefined);
  assert.equal(toolResult.structuredContent.pdfSummary, undefined);
  assert.equal(toolResult.content.length, 2);
  assert.match(toolResult.content[0].text, /search_meta\.json/);
  assert.match(toolResult.content[0].text, /literature_pool\.json/);
  assert.match(toolResult.content[0].text, /references\.bib/);
  assert.doesNotMatch(toolResult.content[0].text, /pdf_status\.md/);
  assert.match(toolResult.content[1].text, /^% lit-search references/m);
  rmSync(toolResult.structuredContent.output.outputDir, { recursive: true, force: true });
}

function buildFixturePool() {
  return {
    metadata: {
      query: 'machine learning',
      queryExpansion: 'none',
      searchScope: 'title-abstract',
      keywords: ['machine learning'],
      yearRange: { start: 2022, end: 2024 },
      totalRetrieved: 3,
      afterDedup: 2,
      afterFilter: 2,
      finalCount: 1,
      engineStats: [{ engine: 'OpenAlex', status: 'success', totalPapers: 1 }]
    },
    papers: [
      {
        seq_id: 1,
        citation_key: 'Smith2024_1',
        entry_type: 'article',
        title: 'A Study on Machine Learning',
        author: 'Alice Smith and Bob Lee',
        authors: ['Alice Smith', 'Bob Lee'],
        year: 2024,
        journal: 'Journal of Examples',
        pages: '101-120',
        doi: '10.1000/example',
        url: 'https://doi.org/10.1000/example',
        pdf_candidates: [
          {
            url: 'https://example.com/paper.pdf',
            source: 'openalex',
            provider: 'example.com',
            access_type: 'repository',
            license: 'cc-by',
            is_oa: true,
            confidence: 0.8,
            reason: 'Fixture repository PDF.',
            rank: 1
          }
        ],
        abstract: 'An example abstract.',
        keywords: ['machine learning', 'classification'],
        source: 'openalex',
        citation_count: 12
      }
    ]
  };
}

function findNewestOutputDir(dir) {
  const directories = readdirSync(dir, { withFileTypes: true })
    .filter(item => item.isDirectory())
    .map(item => join(dir, item.name));
  return directories.sort().at(-1) || null;
}

function loadKeyEnv() {
  const env = {};
  if (process.env.LIT_SEARCH_S2_API_KEY) env.LIT_SEARCH_S2_API_KEY = process.env.LIT_SEARCH_S2_API_KEY;
  if (process.env.LIT_SEARCH_OPENALEX_API_KEY) env.LIT_SEARCH_OPENALEX_API_KEY = process.env.LIT_SEARCH_OPENALEX_API_KEY;
  if (process.env.LIT_SEARCH_CROSSREF_MAILTO) env.LIT_SEARCH_CROSSREF_MAILTO = process.env.LIT_SEARCH_CROSSREF_MAILTO;
  if (process.env.LIT_SEARCH_CORE_API_KEY) env.LIT_SEARCH_CORE_API_KEY = process.env.LIT_SEARCH_CORE_API_KEY;

  if (!hasAnyKeys(env) && existsSync(localKeyFile)) {
    const parsed = JSON.parse(readFileSync(localKeyFile, 'utf-8'));
    if (parsed.s2) env.LIT_SEARCH_S2_API_KEY = parsed.s2;
    if (parsed.openalex) env.LIT_SEARCH_OPENALEX_API_KEY = parsed.openalex;
    if (parsed.crossrefMailto) env.LIT_SEARCH_CROSSREF_MAILTO = parsed.crossrefMailto;
    if (parsed.core) env.LIT_SEARCH_CORE_API_KEY = parsed.core;
  }

  return env;
}

function hasAnyKeys(env) {
  return Boolean(
    env.LIT_SEARCH_S2_API_KEY ||
    env.LIT_SEARCH_OPENALEX_API_KEY ||
    env.LIT_SEARCH_CROSSREF_MAILTO ||
    env.LIT_SEARCH_CORE_API_KEY
  );
}

async function interactWithMcp(messages, env, timeoutMs = 30000) {
  const child = spawn(process.execPath, [mcpEntry], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ...env }
  });

  let buffer = Buffer.alloc(0);
  const responses = [];

  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function readMessages() {
    while (true) {
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      const line = buffer.subarray(0, newline).toString('utf-8').trim();
      buffer = buffer.subarray(newline + 1);
      if (!line) continue;
      const parsed = JSON.parse(line);
      if (parsed.id !== undefined) responses.push(parsed);
    }
  }

  const waiter = new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP response timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    child.stdout.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      readMessages();
      const expectedResponses = messages.filter(message => message.id !== undefined).length;
      if (responses.length >= expectedResponses) {
        clearTimeout(timer);
        child.kill();
        resolveWait();
      }
    });

    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });

  for (const message of messages) send(message);
  await waiter;
  return responses;
}

function printSummary(results) {
  const passed = results.filter(item => item.ok).length;
  const failed = results.length - passed;
  console.log(`\n${chalk.bold('-'.repeat(64))}`);
  console.log(chalk.bold(`Passed: ${passed}/${results.length}`));
  if (failed) console.log(chalk.red(`Failed: ${failed}/${results.length}`));
  console.log('-'.repeat(64));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
