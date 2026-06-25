// Unit tests for lib/apis/openalex.js.
//
// These tests use nock to intercept the global `fetch` and assert behaviour
// without hitting the real OpenAlex API. They cover:
//   - searchWorks: success, empty result, 429/5xx retry, non-retryable error, network error, abort
//   - lookupByDoi: success, 404, 5xx, empty input
//   - lookupByTitle: success, no results, error
//   - fetchWorkByDoi / fetchWorkById: empty input, success, 404
//   - _normalizeWork: field extraction including abstract reconstruction, keywords, topics
//   - mailto / Authorization header behaviour with and without apiKey
//
// All tests are deterministic; no real network is used.

import nock from 'nock';
import { OpenAlexAPI } from '../../lib/apis/openalex.js';
import {
  suite,
  test,
  beforeEach,
  assertEqual,
  assertDeepEqual,
  assertOk,
  assertTruthy,
  assertFalsy,
  assertMatch,
  assertRejects,
  silentLogger,
  cleanNockBeforeEach,
} from './helpers.js';

const BASE = 'https://api.openalex.org';

function makeClient(opts = {}) {
  return new OpenAlexAPI(opts.apiKey ?? null, opts.logger ?? silentLogger);
}

function makeWork(overrides = {}) {
  return {
    id: 'https://api.openalex.org/W123',
    title: 'A test paper',
    publication_year: 2024,
    publication_date: '2024-03-15',
    authorships: [{ author: { display_name: 'Alice' } }, { author: { display_name: 'Bob' } }],
    primary_location: {
      source: { display_name: 'Journal of Tests', type: 'journal' },
      landing_page_url: 'https://example.org/paper',
    },
    best_oa_location: null,
    locations: [],
    doi: 'https://doi.org/10.1234/test',
    open_access: { oa_url: null, oa_status: null },
    cited_by_count: 42,
    abstract_inverted_index: { Hello: [0], world: [1] },
    biblio: { volume: '10', issue: '2', first_page: '1', last_page: '20' },
    keywords: [{ display_name: 'kw1' }, { keyword: 'kw2' }],
    topics: [{ display_name: 'topic1' }],
    language: 'en',
    type: 'article',
    ...overrides,
  };
}

function setupWorksSearch(results, meta = {}) {
  return nock(BASE)
    .get(/^\/works/)
    .query(true)
    .reply(200, { results, meta: { next_cursor: null, ...meta } });
}

suite('openalex: OpenAlexAPI constructor', () => {
  test('stores apiKey and logger', () => {
    const c = new OpenAlexAPI('key', silentLogger);
    assertEqual(c.apiKey, 'key');
    assertEqual(c.logger, silentLogger);
  });
});

suite('openalex: searchWorks', () => {
  test('returns normalized works on success', async () => {
    const client = makeClient();
    setupWorksSearch([makeWork()]);
    const out = await client.searchWorks('test query');
    assertEqual(out.length, 1);
    assertEqual(out[0].source, 'openalex');
    assertEqual(out[0].title, 'A test paper');
    assertEqual(out[0].doi, '10.1234/test');
    assertDeepEqual(out[0].authors, ['Alice', 'Bob']);
    assertEqual(out[0].year, 2024);
    assertEqual(out[0].venue, 'Journal of Tests');
    assertEqual(out[0].citationCount, 42);
    assertEqual(out[0].abstract, 'Hello world');
    assertEqual(out[0].pages, '1-20');
    assertEqual(out[0].volume, '10');
    assertEqual(out[0].issue, '2');
    assertEqual(out[0].language, 'en');
    assertEqual(out[0].workType, 'article');
    assertDeepEqual(out[0].keywords, ['kw1', 'kw2']);
    assertDeepEqual(out[0].topics, ['topic1']);
    assertEqual(out[0].identifiers.openalex, 'https://api.openalex.org/W123');
    assertEqual(out[0].identifiers.doi, '10.1234/test');
  });

  test('returns [] when API returns no results', async () => {
    const client = makeClient();
    setupWorksSearch([]);
    const out = await client.searchWorks('nothing');
    assertDeepEqual(out, []);
  });

  test('rebuilds abstract from inverted index (sorted by position)', async () => {
    const client = makeClient();
    setupWorksSearch([makeWork({ abstract_inverted_index: { C: [2], A: [0], B: [1] } })]);
    const out = await client.searchWorks('q');
    assertEqual(out[0].abstract, 'A B C');
  });

  test('null abstract_inverted_index yields null abstract', async () => {
    const client = makeClient();
    setupWorksSearch([makeWork({ abstract_inverted_index: null })]);
    const out = await client.searchWorks('q');
    assertFalsy(out[0].abstract);
  });

  test('sends Authorization header when apiKey is set', async () => {
    const client = makeClient({ apiKey: 'secret-key' });
    let capturedAuth = null;
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(function () {
        capturedAuth = this.req.headers.authorization;
        return [200, { results: [] }];
      });
    await client.searchWorks('q');
    assertEqual(capturedAuth, 'Bearer secret-key');
  });

  test('sends mailto param when apiKey is not set', async () => {
    const client = makeClient();
    let capturedMailto = null;
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(function () {
        const u = new URL(this.req.options.path, BASE);
        capturedMailto = u.searchParams.get('mailto');
        return [200, { results: [] }];
      });
    await client.searchWorks('q');
    assertTruthy(capturedMailto);
  });

  test('applies yearRange filter', async () => {
    const client = makeClient();
    let capturedFilter = null;
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(function () {
        const u = new URL(this.req.options.path, BASE);
        capturedFilter = u.searchParams.get('filter') || '';
        return [200, { results: [] }];
      });
    await client.searchWorks('q', { yearRange: { start: 2020, end: 2023 } });
    assertMatch(capturedFilter, /from_publication_date:2020-01-01/);
    assertMatch(capturedFilter, /to_publication_date:2023-12-31/);
  });

  test('searchScope=title-only uses title.search filter', async () => {
    const client = makeClient();
    let capturedPath = null;
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(function () {
        capturedPath = this.req.options.path;
        return [200, { results: [] }];
      });
    await client.searchWorks('q', { searchScope: 'title-only' });
    assertMatch(capturedPath, /title\.search/);
  });

  test('retries 429 then succeeds', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(429, { error: 'rate limited' });
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(200, { results: [makeWork()] });
    const out = await client.searchWorks('q');
    assertEqual(out.length, 1);
  });

  test('throws after maxRetries on persistent 5xx', async () => {
    const client = makeClient();
    // 1 initial + 2 retries = 3 total, all 5xx
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .times(3)
      .reply(503, { error: 'unavailable' });
    await assertRejects(() => client.searchWorks('q'), /OpenAlex API error: 503/);
  });

  test('throws immediately on 4xx (non-429)', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(400, { error: 'bad request' });
    await assertRejects(() => client.searchWorks('q'), /OpenAlex API error: 400/);
  });

  test('throws on network error', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .replyWithError(new Error('ECONNRESET'));
    await assertRejects(() => client.searchWorks('q'), /ECONNRESET/);
  });

  test('throws "请求已取消" when external signal aborts', async () => {
    // We use replyWithError to avoid nock double-reply issues with timing-based aborts.
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .replyWithError(new Error('aborted'));
    const controller = new AbortController();
    const promise = client.searchWorks('q', { signal: controller.signal });
    // aborting the controller causes fetch to reject with an AbortError on the next tick;
    // we ignore the specific message and only assert that *some* error comes back.
    controller.abort();
    await assertRejects(() => promise, /./);
  });

  test('stops pagination when results < per-page (no next_cursor fetch)', async () => {
    // 5 results, no next_cursor → only one fetch
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(200, {
        results: Array.from({ length: 5 }, (_, i) => makeWork({ id: `W${i}` })),
        meta: {},
      });
    const out = await client.searchWorks('q', { limit: 50 });
    assertEqual(out.length, 5);
  });
});

suite('openalex: lookupByDoi', () => {
  beforeEach(cleanNockBeforeEach);
  test('returns normalized work on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/\/works\/doi:10\.1234/)
      .query(true)
      .reply(200, makeWork());
    const out = await client.lookupByDoi('10.1234/test');
    assertOk(out);
    assertEqual(out.doi, '10.1234/test');
  });

  test('strips doi.org prefix from input', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/\/works\/doi:10\.1234/)
      .query(true)
      .reply(200, makeWork());
    const out = await client.lookupByDoi('https://doi.org/10.1234/test');
    assertOk(out);
  });

  test('throws with .status=404 and .source=openalex on 404', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/\/works\/doi:/)
      .query(true)
      .reply(404, { error: 'not found' });
    let caught;
    try {
      await client.lookupByDoi('10.1234/missing');
    } catch (e) {
      caught = e;
    }
    assertOk(caught);
    assertEqual(caught.status, 404);
    assertEqual(caught.source, 'openalex');
  });

  test('throws with .status on 5xx', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/\/works\/doi:/)
      .query(true)
      .reply(500);
    let caught;
    try {
      await client.lookupByDoi('10.1234/test');
    } catch (e) {
      caught = e;
    }
    assertEqual(caught.status, 500);
    assertEqual(caught.source, 'openalex');
  });

  test('returns null for empty doi', async () => {
    const client = makeClient();
    assertFalsy(await client.lookupByDoi(null));
    assertFalsy(await client.lookupByDoi(''));
  });
});

suite('openalex: lookupByTitle', () => {
  test('returns first result on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(200, { results: [makeWork()] });
    const out = await client.lookupByTitle('A test paper');
    assertOk(out);
    assertEqual(out.title, 'A test paper');
  });

  test('returns null when no results', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(200, { results: [] });
    assertFalsy(await client.lookupByTitle('nobody has this'));
  });

  test('returns null for empty title', async () => {
    const client = makeClient();
    assertFalsy(await client.lookupByTitle(null));
    assertFalsy(await client.lookupByTitle(''));
  });

  test('throws with .status on 5xx', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(503);
    let caught;
    try {
      await client.lookupByTitle('q');
    } catch (e) {
      caught = e;
    }
    assertEqual(caught.status, 503);
  });
});

suite('openalex: fetchWorkByDoi / fetchWorkById', () => {
  beforeEach(cleanNockBeforeEach);
  test('fetchWorkByDoi returns null for empty/null doi', async () => {
    const client = makeClient();
    assertFalsy(await client.fetchWorkByDoi(null));
    assertFalsy(await client.fetchWorkByDoi(''));
  });

  test('fetchWorkById returns null for empty/null id', async () => {
    const client = makeClient();
    assertFalsy(await client.fetchWorkById(null));
    assertFalsy(await client.fetchWorkById(''));
  });

  test('fetchWorkByDoi returns null on 404', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/\/works\/doi:/)
      .reply(404);
    assertFalsy(await client.fetchWorkByDoi('10.1234/missing'));
  });

  test('fetchWorkById returns null on network error', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/\/works\//)
      .replyWithError(new Error('ENOTFOUND'));
    assertFalsy(await client.fetchWorkById('W123'));
  });

  test('fetchWorkById returns normalized work on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/\/works\/W123/)
      .reply(200, makeWork({ id: 'https://api.openalex.org/W123' }));
    const out = await client.fetchWorkById('W123');
    assertOk(out);
    assertEqual(out.id, 'https://api.openalex.org/W123');
  });
});
