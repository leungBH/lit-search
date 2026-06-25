/**
 * Semantic Scholar API client unit tests.
 *
 * Semantic Scholar's `searchPapers` paginates with a sleep between batches and
 * has retry/field-fallback logic. We stub `_sleep` to no-op and shrink
 * `paginationDelayMs` so the suite stays fast.
 */
import nock from 'nock';
import { SemanticScholarAPI, parseRetryAfterMs } from '../../lib/apis/semantic-scholar.js';
import {
  suite,
  test,
  beforeEach,
  assertEqual,
  assertDeepEqual,
  assertOk,
  assertTruthy,
  assertFalsy,
  silentLogger,
  cleanNockBeforeEach,
} from './helpers.js';

const BASE = 'https://api.semanticscholar.org/graph/v1';

function makeClient(opts = {}) {
  const c = new SemanticScholarAPI(opts.apiKey ?? null, silentLogger);
  c.paginationDelayMs = 0; // skip inter-batch sleep
  c._sleep = async () => {};
  return c;
}

function makePaper(overrides = {}) {
  return {
    paperId: 'p1',
    title: 'A test paper',
    abstract: 'Hello world',
    year: 2024,
    authors: [{ name: 'Alice' }, { name: 'Bob' }],
    venue: 'Journal of Tests',
    externalIds: { DOI: '10.1234/test' },
    citationCount: 42,
    tldr: { text: 'short summary' },
    openAccessPdf: { url: 'https://example.org/paper.pdf' },
    journal: { name: 'Journal of Tests', volume: '10', pages: '1-20' },
    publicationVenue: null,
    fieldsOfStudy: ['Computer Science'],
    publicationTypes: ['JournalArticle'],
    url: 'https://example.org/paper',
    ...overrides,
  };
}

function searchResponse(papers, total = null) {
  return { data: papers, total: total ?? papers.length };
}

function batchResponse(papers) {
  return papers.map((p) => makePaper({ paperId: p.paperId, title: p.title, abstract: p.abstract }));
}

suite('semantic-scholar: SemanticScholarAPI constructor', () => {
  test('stores apiKey and logger', () => {
    const c = new SemanticScholarAPI('k', silentLogger);
    assertEqual(c.apiKey, 'k');
    assertEqual(c.logger, silentLogger);
  });
});

suite('semantic-scholar: searchPapers', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns normalized papers on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/paper/search')
      .query(true)
      .reply(200, searchResponse([makePaper()]));
    nock(BASE)
      .post('/paper/batch')
      .query(true)
      .reply(200, batchResponse([makePaper()]));
    const out = await client.searchPapers('test', { limit: 1 });
    assertEqual(out.length, 1);
    const p = out[0];
    assertEqual(p.id, 'p1');
    assertEqual(p.title, 'A test paper');
    assertEqual(p.year, 2024);
    assertEqual(p.abstract, 'Hello world');
    assertEqual(p.citationCount, 42);
    assertEqual(p.tldr, 'short summary');
    assertEqual(p.doi, '10.1234/test');
    assertEqual(p.venue, 'Journal of Tests');
    assertEqual(p.journal, 'Journal of Tests');
    assertEqual(p.volume, '10');
    assertEqual(p.pages, '1-20');
    assertDeepEqual(p.authors, ['Alice', 'Bob']);
    assertDeepEqual(p.keywords, ['Computer Science']);
    assertEqual(p.workType, 'JournalArticle');
    assertEqual(p.url, 'https://example.org/paper');
    assertTruthy(p.pdfCandidates.length >= 1);
  });

  test('sends x-api-key header when configured', async () => {
    const client = makeClient({ apiKey: 'secret' });
    let sawKey = false;
    nock(BASE, { reqheaders: { 'x-api-key': 'secret' } })
      .get('/paper/search')
      .query(true)
      .reply(200, function () {
        sawKey = this.req.headers['x-api-key'] === 'secret';
        return searchResponse([]);
      });
    nock(BASE).post('/paper/batch').query(true).reply(200, []);
    const out = await client.searchPapers('q', { limit: 1 });
    assertEqual(out.length, 0);
    assertOk(sawKey);
  });

  test('returns [] when search returns no data', async () => {
    const client = makeClient();
    nock(BASE).get('/paper/search').query(true).reply(200, { data: [] });
    const out = await client.searchPapers('q', { limit: 5 });
    assertEqual(out.length, 0);
  });

  test('returns [] on 4xx (non-429, non-5xx) — error is logged and source breaks', async () => {
    const client = makeClient();
    nock(BASE).get('/paper/search').query(true).times(10).reply(400, 'bad request');
    const out = await client.searchPapers('q', { limit: 1 });
    assertEqual(out.length, 0);
  });
});

suite('semantic-scholar: lookupByDoi', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns normalized paper on success', async () => {
    const client = makeClient();
    nock(BASE).get('/paper/DOI:10.1234%2Ftest').query(true).reply(200, makePaper());
    const out = await client.lookupByDoi('10.1234/test');
    assertOk(out);
    assertEqual(out.id, 'p1');
    assertEqual(out.title, 'A test paper');
    assertEqual(out.doi, '10.1234/test');
  });

  test('strips https://doi.org/ prefix from input', async () => {
    const client = makeClient();
    nock(BASE).get('/paper/DOI:10.1234%2Ftest').query(true).reply(200, makePaper());
    const out = await client.lookupByDoi('https://doi.org/10.1234/test');
    assertOk(out);
  });

  test('returns null for empty/null doi', async () => {
    const client = makeClient();
    assertFalsy(await client.lookupByDoi(null));
    assertFalsy(await client.lookupByDoi(''));
  });

  test('throws with .status=404 and .source=semantic-scholar on 404', async () => {
    const client = makeClient();
    nock(BASE).get('/paper/DOI:10.1234%2Fmissing').query(true).reply(404, 'not found');
    try {
      await client.lookupByDoi('10.1234/missing');
      assertOk(false); // should not reach
    } catch (e) {
      assertEqual(e.status, 404);
      assertEqual(e.source, 'semantic-scholar');
    }
  });

  test('throws with .status on 5xx', async () => {
    const client = makeClient();
    nock(BASE).get('/paper/DOI:10.1234%2Ftest').query(true).reply(503, 'unavailable');
    try {
      await client.lookupByDoi('10.1234/test');
      assertOk(false);
    } catch (e) {
      assertEqual(e.status, 503);
      assertEqual(e.source, 'semantic-scholar');
    }
  });
});

suite('semantic-scholar: lookupByTitle', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns first matching paper', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/paper/search')
      .query(true)
      .reply(200, { data: [makePaper()] });
    const out = await client.lookupByTitle('test paper');
    assertOk(out);
    assertEqual(out.id, 'p1');
  });

  test('returns null when no results', async () => {
    const client = makeClient();
    nock(BASE).get('/paper/search').query(true).reply(200, { data: [] });
    assertFalsy(await client.lookupByTitle('nonexistent'));
  });

  test('returns null for empty title', async () => {
    const client = makeClient();
    assertFalsy(await client.lookupByTitle(''));
    assertFalsy(await client.lookupByTitle(null));
  });
});

suite('semantic-scholar: fetchPaper / fetchPaperByDoi', () => {
  beforeEach(cleanNockBeforeEach);

  test('fetchPaper returns null on 404', async () => {
    const client = makeClient();
    nock(BASE).get('/paper/p1').query(true).reply(404, 'not found');
    assertFalsy(await client.fetchPaper('p1'));
  });

  test('fetchPaperByDoi delegates to fetchPaper', async () => {
    const client = makeClient();
    nock(BASE).get('/paper/DOI%3A10.1234%2Ftest').query(true).reply(200, makePaper());
    const out = await client.fetchPaperByDoi('10.1234/test');
    assertOk(out);
    assertEqual(out.id, 'p1');
  });

  test('fetchPaperByDoi returns null for empty doi', async () => {
    const client = makeClient();
    assertFalsy(await client.fetchPaperByDoi(null));
    assertFalsy(await client.fetchPaperByDoi(''));
  });
});

suite('semantic-scholar: parseRetryAfterMs', () => {
  test('parses numeric seconds', () => {
    assertEqual(parseRetryAfterMs('30'), 30000);
  });

  test('parses HTTP date', () => {
    const future = new Date(Date.now() + 60000);
    const ms = parseRetryAfterMs(future.toUTCString());
    assertTruthy(ms > 50000 && ms <= 60000);
  });

  test('returns null for empty/invalid', () => {
    assertEqual(parseRetryAfterMs(null), null);
    assertEqual(parseRetryAfterMs(''), null);
    assertEqual(parseRetryAfterMs('garbage'), null);
  });
});
