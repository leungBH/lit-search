/**
 * DBLP API client unit tests.
 *
 * DBLP returns JSON in the shape:
 *   { result: { hits: { hit: [ { info: { title, year, ... } } ] } } }
 *
 * We mock the global `fetch` with nock and cover:
 *   - constructor
 *   - searchWorks: success, empty, searchScope=title-only, year range, 4xx, abort
 */
import nock from 'nock';
import { DblpAPI } from '../../lib/apis/dblp.js';
import {
  suite,
  test,
  beforeEach,
  assertEqual,
  assertDeepEqual,
  assertOk,
  assertTruthy,
  assertRejects,
  silentLogger,
  cleanNockBeforeEach,
} from './helpers.js';

const BASE = 'https://dblp.org';

function makeClient() {
  return new DblpAPI(silentLogger);
}

function makeHit(overrides = {}) {
  return {
    info: {
      key: 'conf/test/p1',
      title: 'A test paper',
      year: '2024',
      venue: 'Conf of Tests',
      type: 'Conference and Workshop Papers',
      pages: '1-10',
      doi: '10.1234/test',
      ee: ['https://doi.org/10.1234/test'],
      authors: { author: ['Alice', 'Bob'] },
      ...overrides.info,
    },
    ...overrides,
  };
}

function envelope(hits) {
  return {
    result: {
      hits: { hit: hits, '@total': String(hits.length) },
    },
  };
}

suite('dblp: DblpAPI constructor', () => {
  test('uses default timeout and provided logger', () => {
    const c = new DblpAPI(silentLogger);
    assertEqual(c.queryTimeoutMs, 15000);
    assertEqual(c.logger, silentLogger);
  });
});

suite('dblp: searchWorks', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns normalized papers on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/search/publ/api')
      .query(true)
      .reply(200, envelope([makeHit()]));
    const out = await client.searchWorks('test');
    assertEqual(out.length, 1);
    const p = out[0];
    assertEqual(p.id, 'conf/test/p1');
    assertEqual(p.title, 'A test paper');
    assertEqual(p.year, 2024);
    assertEqual(p.venue, 'Conf of Tests');
    assertEqual(p.doi, '10.1234/test');
    assertEqual(p.booktitle, 'Conf of Tests');
    assertDeepEqual(p.authors, ['Alice', 'Bob']);
    assertEqual(p.pdfCandidates.length, 1);
    assertEqual(p.pdfCandidates[0].provider, 'doi.org');
  });

  test('returns [] when result has no hits', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/search/publ/api')
      .query(true)
      .reply(200, { result: { hits: { hit: [] } } });
    const out = await client.searchWorks('nothing');
    assertEqual(out.length, 0);
  });

  test('year range filter drops out-of-range hits', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/search/publ/api')
      .query(true)
      .reply(200, envelope([makeHit({ info: { key: 'k1', year: '2020' } }), makeHit()]));
    const out = await client.searchWorks('q', { yearRange: { start: 2022, end: 2025 } });
    assertEqual(out.length, 1);
    assertEqual(out[0].year, 2024);
  });

  test('searchScope=title-only requires title match against query', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/search/publ/api')
      .query(true)
      .reply(200, envelope([makeHit({ info: { title: 'completely different' } })]));
    const out = await client.searchWorks('totally unrelated', { searchScope: 'title-only' });
    assertEqual(out.length, 0);
  });

  test('throws on 4xx', async () => {
    const client = makeClient();
    nock(BASE).get('/search/publ/api').query(true).reply(404, 'not found');
    await assertRejects(() => client.searchWorks('q'), /DBLP API error: 404/);
  });

  test('throws 请求超时 when timeout fires', async () => {
    const client = makeClient();
    nock(BASE).get('/search/publ/api').query(true).delay(200).reply(200, envelope([]));
    // Use a tiny timeout to force the timeout branch
    client.queryTimeoutMs = 20;
    await assertRejects(() => client.searchWorks('q'), /请求超时/);
  });

  test('throws 请求已取消 when external signal aborts', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/search/publ/api')
      .query(true)
      .replyWithError({ message: 'aborted', code: 'ABORT_ERR' });
    const ac = new AbortController();
    ac.abort();
    await assertRejects(() => client.searchWorks('q', { signal: ac.signal }), /请求已取消/);
  });
});
