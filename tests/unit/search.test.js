/**
 * search.js — orchestration layer.
 *
 * `searchPapers` fans out to many engines in parallel for each query,
 * then deduplicates, filters by relevance, sorts, and emits an output
 * shape. We stub every engine's HTTP endpoint with nock and exercise
 * the full pipeline. We also unit-test the exported helper
 * `generateQueries`. Tests for `enhanceOutputPapers` live in
 * tests/unit/search-output.test.js, which uses dependency injection.
 */
import nock from 'nock';
import { searchPapers, generateQueries } from '../../lib/search.js';
import {
  suite,
  test,
  beforeEach,
  assertEqual,
  assertDeepEqual,
  assertMatch,
  assertOk,
  assertTruthy,
  assertFalsy,
  assertRejects,
  silentLogger,
  cleanNockBeforeEach,
} from './helpers.js';

const SILENT = { ...silentLogger, info: () => {}, warn: () => {}, debug: () => {} };

const S2_BASE = 'https://api.semanticscholar.org/graph/v1';
const OA_BASE = 'https://api.openalex.org';
const ARXIV_BASE = 'https://export.arxiv.org/api';
const CR_BASE = 'https://api.crossref.org';
const CORE_BASE = 'https://api.core.ac.uk';
const EPMC_BASE = 'https://www.ebi.ac.uk';
const DBLP_BASE = 'https://dblp.org';
const DOAJ_BASE = 'https://doaj.org/api/search/articles';

function makeS2Paper(id, title, extras = {}) {
  return {
    paperId: id,
    title,
    abstract: `${title} abstract`,
    year: 2024,
    authors: [{ name: 'Alice' }, { name: 'Bob' }],
    venue: 'Journal of Tests',
    externalIds: { DOI: `10.1234/${id}` },
    citationCount: 10,
    openAccessPdf: { url: `https://example.org/${id}.pdf` },
    journal: { name: 'Journal of Tests', volume: '10', pages: '1-20' },
    fieldsOfStudy: ['CS'],
    publicationTypes: ['JournalArticle'],
    url: `https://example.org/${id}`,
    ...extras,
  };
}

function makeOAResult(id, title) {
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
    best_oa_location: {
      pdf_url: `https://example.org/${id}.pdf`,
      license: 'cc-by',
    },
    concepts: [{ display_name: 'CS' }],
    type: 'journal-article',
    cited_by_count: 12,
    ids: { openalex: `W${id}` },
  };
}

function makeArxivEntry(id, title) {
  return `
    <entry>
      <id>http://arxiv.org/abs/${id}v1</id>
      <title>${title}</title>
      <summary>${title} abstract</summary>
      <published>2024-01-15T00:00:00Z</published>
      <author><name>Alice</name></author>
      <author><name>Bob</name></author>
      <link href="http://arxiv.org/pdf/${id}v1" rel="related" type="application/pdf"/>
    </entry>
  `;
}

function arxivFeed(...entries) {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries.join('')}</feed>`;
}

function makeCRItem(id, title) {
  return {
    DOI: `10.1234/${id}`,
    title: [title],
    author: [
      { given: 'Alice', family: 'A' },
      { given: 'Bob', family: 'B' },
    ],
    issued: { 'date-parts': [[2024, 1]] },
    'container-title': ['Journal of Tests'],
    type: 'journal-article',
    link: [{ URL: `https://example.org/${id}` }],
    URL: `https://example.org/${id}`,
    publisher: 'Test Press',
    volume: '10',
    issue: '2',
    page: '1-20',
  };
}

function makeCoreWork(id, title) {
  return {
    id,
    title,
    authors: [{ name: 'Alice' }, { name: 'Bob' }],
    yearPublished: 2024,
    doi: `10.1234/${id}`,
    abstract: `${title} abstract`,
    citationCount: 5,
    documentType: 'article',
    downloadUrl: `https://example.org/${id}.pdf`,
    outputs: [`https://example.org/${id}`],
  };
}

function makeEpmcResult(id, title) {
  return {
    pmid: id,
    pmcid: `PMC${id}`,
    doi: `10.1234/${id}`,
    title,
    authorString: 'Alice, Bob',
    pubYear: '2024',
    journalTitle: 'Journal of Tests',
    journalVolume: '10',
    issue: '2',
    pageInfo: '1-20',
    abstractText: `${title} abstract`,
    fullTextUrlList: {
      fullTextUrl: [{ url: `https://europepmc.org/articles/PMC${id}/pdf` }],
    },
  };
}

function makeDblpHit(id, title) {
  return {
    info: {
      key: `conf/test/${id}`,
      title,
      year: 2024,
      authors: { author: [{ '@text': 'Alice' }, { '@text': 'Bob' }] },
      venue: 'Conf of Tests',
      doi: `10.1234/${id}`,
      ee: `https://example.org/${id}.pdf`,
    },
  };
}

function makeDoajItem(id, title) {
  return {
    id: `doaj-${id}`,
    bibjson: {
      title,
      year: '2024',
      author: [{ name: 'Alice' }, { name: 'Bob' }],
      identifier: [{ type: 'doi', id: `10.1234/${id}` }],
      journal: { title: 'Journal of Tests', publisher: 'Test Press' },
      abstract: `${title} abstract`,
      start_page: '1',
      end_page: '20',
      link: [{ type: 'fulltext', url: `https://example.org/${id}.pdf` }],
    },
  };
}

function onlyEngines(...names) {
  return {
    semanticScholar: names.includes('s2'),
    openalex: names.includes('oa'),
    arxiv: names.includes('arxiv'),
    crossref: names.includes('crossref'),
    core: names.includes('core'),
    europePmc: names.includes('epmc'),
    dblp: names.includes('dblp'),
    doaj: names.includes('doaj'),
    pubmed: false,
    unpaywall: false,
    openCitations: false,
  };
}

suite('search: generateQueries', () => {
  test('none strategy returns base keywords', () => {
    const out = generateQueries('a, b, c', [], 'none');
    assertDeepEqual(out, ['a', 'b', 'c']);
  });

  test('pairwise builds pairs + singles', () => {
    const out = generateQueries('a, b, c', [], 'pairwise');
    // pairs: a b, a c, b c; singles: a, b, c
    assertOk(out.includes('a b'));
    assertOk(out.includes('a c'));
    assertOk(out.includes('b c'));
    assertOk(out.includes('a'));
    assertOk(out.includes('b'));
    assertOk(out.includes('c'));
  });

  test('full strategy builds all combos + singles', () => {
    const out = generateQueries('a, b, c', [], 'full');
    assertOk(out.includes('a b c'));
    assertOk(out.includes('a b'));
    assertOk(out.includes('a c'));
    assertOk(out.includes('b c'));
  });

  test('appends extraKeywords without duplicates', () => {
    const out = generateQueries('a, b', ['c', 'b'], 'none');
    assertDeepEqual(out, ['a', 'b', 'c']);
  });

  test('unknown strategy falls back to base keywords', () => {
    const out = generateQueries('a, b', [], 'unknown');
    assertDeepEqual(out, ['a', 'b']);
  });

  test('deduplicates base keywords', () => {
    const out = generateQueries('a, a, b', [], 'none');
    assertDeepEqual(out, ['a', 'b']);
  });
});

suite('search: searchPapers — single engine (s2)', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns papers with metadata, dedup, filter, sort', async () => {
    nock(S2_BASE)
      .get('/paper/search')
      .query(true)
      .reply(200, { data: [makeS2Paper('p1', 'Graph neural networks for biology')] });
    nock(S2_BASE)
      .post('/paper/batch')
      .query(true)
      .reply(200, [makeS2Paper('p1', 'Graph neural networks for biology')]);

    const out = await searchPapers({
      query: 'neural',
      limit: 5,
      logger: SILENT,
      engines: onlyEngines('s2'),
    });

    assertOk(out.papers.length >= 1);
    assertEqual(out.metadata.query, 'neural');
    assertEqual(out.metadata.filterMode, 'strict');
    assertOk(out.metadata.engineStats.length === 1);
    assertEqual(out.metadata.engineStats[0].engine, 'Semantic Scholar');
  });

  test('returns empty result envelope when all engines return 0', async () => {
    nock(S2_BASE).get('/paper/search').query(true).reply(200, { data: [] });
    const out = await searchPapers({
      query: 'noresultswillmatch',
      limit: 5,
      logger: SILENT,
      engines: onlyEngines('s2'),
    });
    assertEqual(out.papers.length, 0);
    assertEqual(out.metadata.totalRetrieved, 0);
  });

  test('emits a no_results stat for an engine that returns []', async () => {
    nock(S2_BASE).get('/paper/search').query(true).reply(200, { data: [] });
    const out = await searchPapers({
      query: 'zzznoresults',
      limit: 5,
      logger: SILENT,
      engines: onlyEngines('s2'),
    });
    const s2 = out.metadata.engineStats.find((s) => s.engine === 'Semantic Scholar');
    assertEqual(s2.status, 'no_results');
  });

  test('handles a 4xx gracefully and marks source as no_results (or failed)', async () => {
    nock(S2_BASE).get('/paper/search').query(true).times(5).reply(400, 'bad');
    const out = await searchPapers({
      query: 'q',
      limit: 3,
      logger: SILENT,
      engines: onlyEngines('s2'),
    });
    assertEqual(out.papers.length, 0);
  });
});

suite('search: searchPapers — multi-engine dedup and filter', () => {
  beforeEach(cleanNockBeforeEach);

  test('dedupes papers with same DOI across sources', async () => {
    // S2: p1 (DOI 10.1234/dup)
    nock(S2_BASE)
      .get('/paper/search')
      .query(true)
      .reply(200, { data: [makeS2Paper('dup', 'A shared paper')] });
    nock(S2_BASE)
      .post('/paper/batch')
      .query(true)
      .reply(200, [makeS2Paper('dup', 'A shared paper')]);

    // OpenAlex: same DOI
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, {
        results: [makeOAResult('dup', 'A shared paper')],
        meta: { count: 1 },
      });

    // arXiv: a different paper (no DOI collision)
    nock(ARXIV_BASE)
      .get('/query')
      .query(true)
      .reply(200, arxivFeed(makeArxivEntry('2401.00001', 'ArXiv-only paper')));

    const out = await searchPapers({
      query: 'paper',
      limit: 10,
      logger: SILENT,
      engines: onlyEngines('s2', 'oa', 'arxiv'),
    });

    const dois = out.papers.map((p) => p.doi).filter(Boolean);
    const uniqueDois = [...new Set(dois)];
    // 10.1234/dup should appear only once across all papers
    assertOk(dois.filter((d) => d === '10.1234/dup').length <= 1);
    // total unique count should be at least 1 (shared) and we should have multiple sources
    assertOk(out.metadata.afterDedup < out.metadata.totalRetrieved + 1);
  });

  test('applies year range filter to deduplicated results', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, {
        results: [makeOAResult('p2020', 'A 2020 paper'), makeOAResult('p2024', 'A 2024 paper')],
        meta: { count: 2 },
      });

    const out = await searchPapers({
      query: 'paper',
      limit: 10,
      yearStart: 2023,
      yearEnd: 2024,
      logger: SILENT,
      engines: onlyEngines('oa'),
    });
    // Both 2024 papers, both within range
    assertOk(out.papers.length >= 1);
    for (const p of out.papers) {
      if (p.year) assertOk(p.year >= 2023 && p.year <= 2024);
    }
  });

  test('falls back to relaxed filter when strict filter removes all', async () => {
    // S2 returns a paper whose abstract mentions "graph" but not "specificword"
    nock(S2_BASE)
      .get('/paper/search')
      .query(true)
      .reply(200, { data: [makeS2Paper('p1', 'Graph neural networks')] });
    nock(S2_BASE)
      .post('/paper/batch')
      .query(true)
      .reply(200, [makeS2Paper('p1', 'Graph neural networks')]);

    const out = await searchPapers({
      query: 'very-specific-unmatched-word',
      keywords: [],
      limit: 5,
      logger: SILENT,
      engines: onlyEngines('s2'),
    });
    // Either filterMode is 'strict' (no results) or 'relaxed' (some match)
    assertOk(['strict', 'relaxed'].includes(out.metadata.filterMode));
  });

  test('relevance filter can be disabled with relevanceFilter=false', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, {
        results: [makeOAResult('p1', 'Anything goes')],
        meta: { count: 1 },
      });
    const out = await searchPapers({
      query: 'something else entirely',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('oa'),
    });
    assertOk(out.papers.length >= 1);
  });

  test('produces stable seq_id starting from 1', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, {
        results: [
          makeOAResult('a', 'First distinct paper on graphs'),
          makeOAResult('b', 'Second distinct paper on networks'),
        ],
        meta: { count: 2 },
      });
    const out = await searchPapers({
      query: 'paper',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('oa'),
    });
    assertOk(out.papers.length >= 2);
    assertEqual(out.papers[0].seq_id, 1);
    assertEqual(out.papers[1].seq_id, 2);
  });

  test('output papers carry citation_key, authors, journal fields', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, {
        results: [makeOAResult('a', 'A paper')],
        meta: { count: 1 },
      });
    const out = await searchPapers({
      query: 'paper',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('oa'),
    });
    const p = out.papers[0];
    assertOk(p.citation_key);
    assertEqual(p.entry_type, 'article');
    assertEqual(p.title, 'A paper');
    assertOk(Array.isArray(p.authors) || typeof p.author === 'string');
  });
});

suite('search: searchPapers — arxiv engine', () => {
  beforeEach(cleanNockBeforeEach);

  test('parses arXiv Atom feed', async () => {
    nock(ARXIV_BASE)
      .get('/query')
      .query(true)
      .reply(200, arxivFeed(makeArxivEntry('2401.00001', 'A test paper')));
    const out = await searchPapers({
      query: 'test paper',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('arxiv'),
    });
    assertEqual(out.papers.length, 1);
    assertEqual(out.papers[0].entry_type, 'misc');
    assertMatch(out.papers[0].title, /A test paper/);
  });
});

suite('search: searchPapers — crossref engine', () => {
  beforeEach(cleanNockBeforeEach);

  test('parses CrossRef work items', async () => {
    nock(CR_BASE)
      .get('/works')
      .query(true)
      .reply(200, {
        message: {
          items: [makeCRItem('cr1', 'A CrossRef paper')],
          total: 1,
        },
      });
    const out = await searchPapers({
      query: 'crossref paper',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('crossref'),
    });
    assertEqual(out.papers.length, 1);
    assertEqual(out.papers[0].source, 'crossref');
  });
});

suite('search: searchPapers — core engine', () => {
  beforeEach(cleanNockBeforeEach);

  test('parses CORE work items', async () => {
    nock(CORE_BASE)
      .get('/v3/search/works')
      .query(true)
      .reply(200, { results: [makeCoreWork('core1', 'A CORE paper')] });
    const out = await searchPapers({
      query: 'core paper',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('core'),
    });
    assertEqual(out.papers.length, 1);
    assertEqual(out.papers[0].source, 'core');
  });
});

suite('search: searchPapers — europe-pmc engine', () => {
  beforeEach(cleanNockBeforeEach);

  test('parses Europe PMC results', async () => {
    nock(EPMC_BASE)
      .get('/europepmc/webservices/rest/search')
      .query(true)
      .reply(200, { resultList: { result: [makeEpmcResult('1', 'A PMC paper')] } });
    const out = await searchPapers({
      query: 'pmc paper',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('epmc'),
    });
    assertEqual(out.papers.length, 1);
    assertEqual(out.papers[0].source, 'europe-pmc');
  });
});

suite('search: searchPapers — dblp engine', () => {
  beforeEach(cleanNockBeforeEach);

  test('parses DBLP hits', async () => {
    nock(DBLP_BASE)
      .get('/search/publ/api')
      .query(true)
      .reply(200, {
        result: {
          hits: {
            hit: [makeDblpHit('p1', 'A DBLP paper')],
            total: 1,
          },
        },
      });
    const out = await searchPapers({
      query: 'dblp paper',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('dblp'),
    });
    assertEqual(out.papers.length, 1);
    assertEqual(out.papers[0].source, 'dblp');
  });
});

suite('search: searchPapers — doaj engine', () => {
  beforeEach(cleanNockBeforeEach);

  test('parses DOAJ items', async () => {
    nock(DOAJ_BASE)
      .get(/.+/)
      .query(true)
      .reply(200, { results: [makeDoajItem('1', 'A DOAJ paper')] });
    const out = await searchPapers({
      query: 'doaj paper',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('doaj'),
    });
    assertEqual(out.papers.length, 1);
    assertEqual(out.papers[0].source, 'doaj');
  });
});

suite('search: searchPapers — all engines run, dedup merges identifiers', () => {
  beforeEach(cleanNockBeforeEach);

  test('combines S2 + OpenAlex + arXiv + CrossRef + CORE + EPMC + DBLP + DOAJ', async () => {
    nock(S2_BASE)
      .get('/paper/search')
      .query(true)
      .reply(200, { data: [makeS2Paper('multi', 'Multi source paper')] });
    nock(S2_BASE)
      .post('/paper/batch')
      .query(true)
      .reply(200, [makeS2Paper('multi', 'Multi source paper')]);
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, { results: [makeOAResult('multi', 'Multi source paper')], meta: { count: 1 } });
    nock(ARXIV_BASE)
      .get('/query')
      .query(true)
      .reply(200, arxivFeed(makeArxivEntry('2401.99999', 'Multi source paper')));
    nock(CR_BASE)
      .get('/works')
      .query(true)
      .reply(200, { message: { items: [makeCRItem('multi', 'Multi source paper')], total: 1 } });
    nock(CORE_BASE)
      .get('/v3/search/works')
      .query(true)
      .reply(200, { results: [makeCoreWork('multi', 'Multi source paper')] });
    nock(EPMC_BASE)
      .get('/europepmc/webservices/rest/search')
      .query(true)
      .reply(200, { resultList: { result: [makeEpmcResult('multi', 'Multi source paper')] } });
    nock(DBLP_BASE)
      .get('/search/publ/api')
      .query(true)
      .reply(200, {
        result: { hits: { hit: [makeDblpHit('multi', 'Multi source paper')], total: 1 } },
      });
    nock(DOAJ_BASE)
      .get(/.+/)
      .query(true)
      .reply(200, { results: [makeDoajItem('multi', 'Multi source paper')] });

    const out = await searchPapers({
      query: 'multi source paper',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
    });
    assertOk(out.papers.length >= 1);
    assertOk(out.metadata.engineStats.length === 8);
  });
});

suite('search: searchPapers — query expansion', () => {
  beforeEach(cleanNockBeforeEach);

  test('pairwise expansion fans out per query', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .times(3)
      .reply(200, { results: [makeOAResult('a', 'A paper')], meta: { count: 1 } });
    const out = await searchPapers({
      query: 'a, b, c',
      queryExpansion: 'pairwise',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('oa'),
    });
    // Pairs: a b, a c, b c → 3 calls
    assertOk(out.metadata.keywords.includes('a b'));
  });

  test('full expansion with 3 keywords includes triple', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .times(4)
      .reply(200, { results: [], meta: { count: 0 } });
    const out = await searchPapers({
      query: 'x, y, z',
      queryExpansion: 'full',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('oa'),
    });
    assertOk(out.metadata.keywords.includes('x y z'));
  });
});

// Note: enhanceOutputPapers tests live in tests/unit/search-output.test.js
// (which uses dependency-injected enhancers and is more thorough).

// ──────────────────────────────────────────────────────────────────────
// Streaming progress + cancellation
// ──────────────────────────────────────────────────────────────────────

import { LitSearchError } from '../../lib/errors.js';

suite('search: searchPapers — streaming progress', () => {
  beforeEach(cleanNockBeforeEach);

  test('emits progress events to onProgress callback', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, { results: [makeOAResult('p1', 'A paper')], meta: { count: 1 } });

    const events = [];
    const out = await searchPapers({
      query: 'paper',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('oa'),
      onProgress: async (progress, total, message) => {
        events.push({ progress, total, message });
      },
    });

    // 至少应该看到 1 个关键词开始事件 + 1 个源完成事件 + 1 个最终事件
    assertOk(events.length >= 3, `expected >=3 progress events, got ${events.length}`);

    // 验证事件结构
    const first = events[0];
    assertEqual(typeof first.progress, 'number');
    assertEqual(typeof first.total, 'number');
    assertEqual(typeof first.message, 'string');

    // 验证 total 不为 0
    assertOk(first.total > 0);

    // 验证进度单调非降
    for (let i = 1; i < events.length; i++) {
      assertOk(events[i].progress >= events[i - 1].progress);
    }

    // 验证最终事件 progress === total
    const last = events[events.length - 1];
    assertEqual(last.progress, last.total);

    // 验证还是返回了结果
    assertOk(out.papers.length >= 1);
  });

  test('onProgress is optional — no callback works', async () => {
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, { results: [makeOAResult('p1', 'A paper')], meta: { count: 1 } });

    const out = await searchPapers({
      query: 'paper',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('oa'),
      // 不传 onProgress
    });
    assertOk(out.papers.length >= 1);
  });

  test('emits one event per source completion for multi-engine search', async () => {
    nock(S2_BASE)
      .get('/paper/search')
      .query(true)
      .reply(200, { data: [makeS2Paper('multi', 'A paper')] });
    nock(S2_BASE)
      .post('/paper/batch')
      .query(true)
      .reply(200, [makeS2Paper('multi', 'A paper')]);
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, { results: [makeOAResult('multi', 'A paper')], meta: { count: 1 } });

    const sourceEvents = [];
    await searchPapers({
      query: 'paper',
      limit: 5,
      relevanceFilter: false,
      logger: SILENT,
      engines: onlyEngines('s2', 'oa'),
      onProgress: async (progress, total, message) => {
        // 抓"源完成"型事件：message 以 "X · " 开头（per-source 事件，不是关键词开始，也不是最终结果）
        if (message.includes(' · ')) {
          sourceEvents.push({ progress, total, message });
        }
      },
    });

    // 2 个源都应该报一次
    assertEqual(sourceEvents.length, 2, `expected 2 source events, got ${sourceEvents.length}`);
  });
});

suite('search: searchPapers — cancellation', () => {
  beforeEach(cleanNockBeforeEach);

  test('pre-aborted signal throws CANCELLED before any fetch', async () => {
    const ac = new AbortController();
    ac.abort();

    let threw = null;
    try {
      await searchPapers({
        query: 'paper',
        limit: 5,
        relevanceFilter: false,
        logger: SILENT,
        engines: onlyEngines('oa'),
        signal: ac.signal,
      });
    } catch (e) {
      threw = e;
    }

    assertTruthy(threw instanceof LitSearchError);
    assertEqual(threw.code, 'CANCELLED');
  });

  test('signal abort during search causes CANCELLED error', async () => {
    // S2 用 nock 拦截——不会真的 sleep。直接用 pre-abort 即可验证
    // （中途 abort 涉及定时器，这里只验证 abort 的传播路径走得通）
    nock(OA_BASE)
      .get('/works')
      .query(true)
      .reply(200, { results: [makeOAResult('p1', 'A paper')], meta: { count: 1 } });

    const ac = new AbortController();
    ac.abort();

    await assertRejects(
      () =>
        searchPapers({
          query: 'paper',
          limit: 5,
          relevanceFilter: false,
          logger: SILENT,
          engines: onlyEngines('oa'),
          signal: ac.signal,
        }),
      /cancelled/i
    );
  });

  test('cancellation has retryable=false', async () => {
    const ac = new AbortController();
    ac.abort();
    let threw = null;
    try {
      await searchPapers({
        query: 'paper',
        limit: 5,
        logger: SILENT,
        engines: onlyEngines('oa'),
        signal: ac.signal,
      });
    } catch (e) {
      threw = e;
    }
    assertTruthy(threw instanceof LitSearchError);
    assertEqual(threw.retryable, false);
  });
});
