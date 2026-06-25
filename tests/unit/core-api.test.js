/**
 * CORE API client unit tests.
 *
 * CORE's `searchWorks` paginates and sleeps between batches. We stub
 * `_sleep` to no-op so the suite runs in milliseconds.
 */
import nock from 'nock';
import { CoreAPI } from '../../lib/apis/core.js';
import {
  suite,
  test,
  beforeEach,
  assertEqual,
  assertDeepEqual,
  assertOk,
  assertTruthy,
  silentLogger,
  cleanNockBeforeEach,
} from './helpers.js';

const BASE = 'https://api.core.ac.uk';
const PATH = '/v3/search/works';

function makeClient(opts = {}) {
  const c = new CoreAPI(opts.apiKey ?? null, silentLogger);
  c._sleep = async () => {};
  return c;
}

function makeWork(overrides = {}) {
  return {
    id: 'core-1',
    title: 'A test paper',
    authors: [{ name: 'Alice' }, { name: 'Bob' }],
    yearPublished: 2024,
    publisher: 'Test Press',
    doi: '10.1234/test',
    abstract: 'Hello world',
    citationCount: 7,
    documentType: 'article',
    downloadUrl: 'https://example.org/paper.pdf',
    fieldOfStudy: ['Computer Science'],
    outputs: ['https://example.org/paper'],
    ...overrides,
  };
}

function envelope(results) {
  return { results };
}

suite('core: CoreAPI constructor', () => {
  test('stores apiKey and logger; default apiKey null', () => {
    const c = new CoreAPI(null, silentLogger);
    assertEqual(c.apiKey, null);
    assertEqual(c.logger, silentLogger);
  });
});

suite('core: searchWorks', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns normalized papers on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get(PATH)
      .query(true)
      .reply(200, envelope([makeWork()]));
    const out = await client.searchWorks('test', { limit: 1 });
    assertEqual(out.length, 1);
    const p = out[0];
    assertEqual(p.id, 'core-1');
    assertEqual(p.title, 'A test paper');
    assertEqual(p.year, 2024);
    assertEqual(p.doi, '10.1234/test');
    assertEqual(p.publisher, 'Test Press');
    assertEqual(p.abstract, 'Hello world');
    assertEqual(p.citationCount, 7);
    assertEqual(p.workType, 'article');
    assertEqual(p.source, 'core');
    assertDeepEqual(p.authors, ['Alice', 'Bob']);
    assertDeepEqual(p.keywords, ['Computer Science']);
    assertEqual(p.url, 'https://example.org/paper');
    assertEqual(p.identifiers.core, 'core-1');
    assertEqual(p.identifiers.doi, '10.1234/test');
    assertTruthy(p.pdfCandidates.length >= 1);
    assertEqual(p.pdfCandidates[0].url, 'https://example.org/paper.pdf');
  });

  test('sends Authorization header when apiKey set', async () => {
    const client = makeClient({ apiKey: 'tok' });
    let sawAuth = false;
    nock(BASE, { reqheaders: { authorization: 'Bearer tok' } })
      .get(PATH)
      .query(true)
      .reply(200, function () {
        sawAuth = this.req.headers.authorization === 'Bearer tok';
        return envelope([]);
      });
    const out = await client.searchWorks('q', { limit: 1 });
    assertEqual(out.length, 0);
    assertOk(sawAuth);
  });

  test('appends year filter to query', async () => {
    const client = makeClient();
    let seenQuery = null;
    nock(BASE)
      .get(PATH)
      .query((q) => {
        seenQuery = q.q;
        return true;
      })
      .reply(200, envelope([]));
    await client.searchWorks('foo', { limit: 1, yearRange: { start: 2020, end: 2024 } });
    assertOk(seenQuery.includes('foo'));
    assertOk(seenQuery.includes('yearPublished>=2020'));
    assertOk(seenQuery.includes('yearPublished<=2024'));
  });

  test('returns [] when results is empty', async () => {
    const client = makeClient();
    nock(BASE).get(PATH).query(true).reply(200, envelope([]));
    const out = await client.searchWorks('q', { limit: 1 });
    assertEqual(out.length, 0);
  });

  test('returns [] on persistent 5xx (source breaks instead of throwing)', async () => {
    const client = makeClient();
    nock(BASE).persist().get(PATH).query(true).reply(503, 'Service Unavailable');
    const out = await client.searchWorks('q', { limit: 1 });
    assertEqual(out.length, 0);
  });
});
