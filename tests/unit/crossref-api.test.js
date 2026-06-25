/**
 * CrossRef API client unit tests.
 *
 * Mocks HTTP via nock. CrossrefAPI uses global `fetch`; nock 14 intercepts
 * that via undici. Each suite cleans interceptors and aborts pending
 * timers in `beforeEach` to avoid the request-already-handled crash that
 * happens when one test's deferred response fires after the next test starts.
 *
 * Mock shape differs per endpoint:
 *   - searchWorks / lookupByTitle expect { message: { items: [...] } }
 *   - lookupByDoi expects { message: <single-item> } (no items array)
 */
import nock from 'nock';
import { CrossrefAPI } from '../../lib/apis/crossref.js';
import {
  suite,
  test,
  beforeEach,
  assertEqual,
  assertDeepEqual,
  assertOk,
  assertTruthy,
  assertFalsy,
  assertRejects,
  silentLogger,
  cleanNockBeforeEach,
} from './helpers.js';

const BASE = 'https://api.crossref.org';

function makeClient(opts = {}) {
  return new CrossrefAPI(opts.mailto ?? null, opts.logger ?? silentLogger);
}

function makeItem(overrides = {}) {
  return {
    DOI: '10.1234/test',
    title: ['A test paper'],
    author: [
      { given: 'Alice', family: 'A' },
      { given: 'Bob', family: 'B' },
    ],
    'container-title': ['Journal of Tests'],
    publisher: 'Test Press',
    published: { 'date-parts': [[2024, 3, 15]] },
    abstract: '<jats:p>Hello <jats:bold>world</jats:bold></jats:p>',
    'is-referenced-by-count': 42,
    type: 'journal-article',
    volume: '10',
    issue: '2',
    page: '1-20',
    language: 'en',
    ISSN: ['1234-5678'],
    ISBN: [],
    subject: ['Subject A', 'Subject B'],
    resource: { primary: { URL: 'https://example.org/paper' } },
    link: [],
    ...overrides,
  };
}

// For endpoints that read data.message.items
function listEnvelope(items, extra = {}) {
  return {
    status: 'ok',
    'message-type': 'work-list',
    message: { 'total-results': items.length, items, ...extra },
  };
}

// For lookupByDoi which reads data.message directly (single-item envelope)
function singleEnvelope(item) {
  return { status: 'ok', 'message-type': 'work', message: item };
}

suite('crossref: CrossrefAPI constructor', () => {
  beforeEach(cleanNockBeforeEach);

  test('stores mailto and logger', () => {
    const c = new CrossrefAPI('hi@example.com', silentLogger);
    assertEqual(c.mailto, 'hi@example.com');
    assertEqual(c.logger, silentLogger);
  });

  test('defaults mailto to lit-search@example.com when null', () => {
    const c = makeClient({ mailto: null });
    assertEqual(c.mailto, 'lit-search@example.com');
  });
});

suite('crossref: searchWorks', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns normalized works on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(200, listEnvelope([makeItem()]));
    const out = await client.searchWorks('test query');
    assertEqual(out.length, 1);
    const p = out[0];
    assertEqual(p.source, 'crossref');
    assertEqual(p.title, 'A test paper');
    assertEqual(p.doi, '10.1234/test');
    assertEqual(p.id, 'doi:10.1234/test');
    assertDeepEqual(p.authors, ['Alice A', 'Bob B']);
    assertEqual(p.year, 2024);
    assertEqual(p.venue, 'Journal of Tests');
    assertEqual(p.journal, 'Journal of Tests');
    assertEqual(p.publisher, 'Test Press');
    assertEqual(p.citationCount, 42);
    assertEqual(p.abstract, 'Hello world');
    assertEqual(p.pages, '1-20');
    assertEqual(p.firstPage, '1');
    assertEqual(p.lastPage, '20');
    assertEqual(p.volume, '10');
    assertEqual(p.issue, '2');
    assertEqual(p.language, 'en');
    assertEqual(p.workType, 'journal-article');
    assertDeepEqual(p.keywords, ['Subject A', 'Subject B']);
    assertEqual(p.identifiers.doi, '10.1234/test');
    // ISSN comes back as an array from the API
    assertDeepEqual(p.identifiers.issn, ['1234-5678']);
  });

  test('returns [] when API returns no items', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(200, listEnvelope([]));
    const out = await client.searchWorks('nothing');
    assertEqual(out.length, 0);
  });

  test('uses query.title in title-only mode', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query((q) => q['query.title'] === 'x')
      .reply(200, listEnvelope([makeItem()]));
    const out = await client.searchWorks('x', { searchScope: 'title-only' });
    assertEqual(out.length, 1);
  });

  test('applies yearRange as filter (from-pub-date / until-pub-date)', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query((q) => q.filter && q.filter.includes('from-pub-date:2020'))
      .reply(200, listEnvelope([makeItem()]));
    const out = await client.searchWorks('q', { yearRange: { start: 2020, end: 2025 } });
    assertEqual(out.length, 1);
  });

  test('sends mailto query param (required by CrossRef etiquette)', async () => {
    const client = makeClient({ mailto: 'me@example.com' });
    nock(BASE)
      .get(/^\/works/)
      .query((q) => q.mailto === 'me@example.com')
      .reply(200, listEnvelope([makeItem()]));
    const out = await client.searchWorks('q');
    assertEqual(out.length, 1);
  });

  test('returns [] on persistent 5xx (source breaks instead of throwing)', async () => {
    // Source's outer-catch treats non-network errors as "log and break",
    // which surfaces as an empty result rather than a thrown error.
    // We persist the 503 so the retry-then-fail path still terminates cleanly.
    const client = makeClient();
    nock(BASE)
      .persist()
      .get(/^\/works/)
      .query(true)
      .reply(503, 'Service Unavailable');
    const out = await client.searchWorks('q');
    assertEqual(out.length, 0);
  });

  test('retries 429 then succeeds', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(429, 'Rate limited');
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(200, listEnvelope([makeItem()]));
    const out = await client.searchWorks('q');
    assertEqual(out.length, 1);
  });

  test('returns [] on 4xx (non-429) — source breaks out of the loop', async () => {
    // 4xx is not 429 and not >=500, so the source falls through to
    // "log and break" → empty array. This documents actual behavior.
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(400, 'Bad Request');
    const out = await client.searchWorks('q');
    assertEqual(out.length, 0);
  });
});

suite('crossref: lookupByDoi', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns normalized work on success', async () => {
    const client = makeClient();
    // DOI contains "/" so the encoded path becomes "10.1234%2Ftest"
    nock(BASE)
      .get(/^\/works\/10\.1234/)
      .reply(200, singleEnvelope(makeItem()));
    const out = await client.lookupByDoi('10.1234/test');
    assertOk(out);
    assertEqual(out.title, 'A test paper');
    assertEqual(out.doi, '10.1234/test');
    assertEqual(out.year, 2024);
  });

  test('strips https://doi.org/ prefix from input', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works\/10\.1234/)
      .reply(200, singleEnvelope(makeItem()));
    const out = await client.lookupByDoi('https://doi.org/10.1234/test');
    assertOk(out);
  });

  test('throws with .status=404 and .source=crossref on 404', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works\//)
      .reply(404, 'not found');
    let caught;
    try {
      await client.lookupByDoi('10.9999/missing');
    } catch (e) {
      caught = e;
    }
    assertTruthy(caught);
    assertEqual(caught.status, 404);
    assertEqual(caught.source, 'crossref');
  });

  test('throws with .status on 5xx', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works\//)
      .reply(500, 'boom');
    let caught;
    try {
      await client.lookupByDoi('10.1234/test');
    } catch (e) {
      caught = e;
    }
    assertTruthy(caught);
    assertEqual(caught.status, 500);
    assertEqual(caught.source, 'crossref');
  });

  test('returns null for empty/null doi', async () => {
    const client = makeClient();
    assertFalsy(await client.lookupByDoi(null));
    assertFalsy(await client.lookupByDoi(''));
  });
});

suite('crossref: lookupByTitle', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns first matching work on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query((q) => q['query.bibliographic'] === 'The Title' && q.rows === '1')
      .reply(200, listEnvelope([makeItem({ title: ['The Title'] })]));
    const out = await client.lookupByTitle('The Title');
    assertOk(out);
    assertEqual(out.title, 'The Title');
  });

  test('returns null when no items', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(200, listEnvelope([]));
    const out = await client.lookupByTitle('nope');
    assertFalsy(out);
  });

  test('returns null for empty title (no fetch)', async () => {
    const client = makeClient();
    assertFalsy(await client.lookupByTitle(''));
    assertFalsy(await client.lookupByTitle(null));
  });

  test('throws with .status on 5xx', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/^\/works/)
      .query(true)
      .reply(502, 'bad gateway');
    let caught;
    try {
      await client.lookupByTitle('q');
    } catch (e) {
      caught = e;
    }
    assertTruthy(caught);
    assertEqual(caught.status, 502);
  });
});
