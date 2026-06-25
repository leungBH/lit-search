/**
 * DOAJ API client unit tests.
 *
 * DOAJ uses POST-style query in URL: `/api/search/articles/<query>?page=1&pageSize=N`.
 * Response shape: { results: [ { bibjson: {...} } ] }
 */
import nock from 'nock';
import { DoajAPI } from '../../lib/apis/doaj.js';
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

const BASE = 'https://doaj.org/api/search/articles';

function makeClient() {
  return new DoajAPI(silentLogger);
}

function makeItem(overrides = {}) {
  return {
    id: 'doaj-1',
    bibjson: {
      title: 'A test paper',
      year: '2024',
      author: [{ name: 'Alice' }, { name: 'Bob' }],
      identifier: [
        { type: 'doi', id: '10.1234/test' },
        { type: 'pissn', id: '1234-5678' },
      ],
      journal: { title: 'Journal of Tests', publisher: 'Test Press', volume: '10', number: '2' },
      abstract: 'Hello world',
      start_page: '1',
      end_page: '20',
      link: [{ type: 'fulltext', url: 'https://example.org/paper.pdf' }],
      keywords: ['kw1'],
      subject: [{ term: 'topic1' }],
      language: ['EN'],
      ...overrides.bibjson,
    },
    ...overrides,
  };
}

function envelope(items) {
  return { results: items };
}

suite('doaj: DoajAPI constructor', () => {
  test('uses default timeout and provided logger', () => {
    const c = new DoajAPI(silentLogger);
    assertEqual(c.queryTimeoutMs, 15000);
    assertEqual(c.logger, silentLogger);
  });
});

suite('doaj: searchWorks', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns normalized papers on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/.+/)
      .query(true)
      .reply(200, envelope([makeItem()]));
    const out = await client.searchWorks('test');
    assertEqual(out.length, 1);
    const p = out[0];
    assertEqual(p.id, 'doaj-1');
    assertEqual(p.title, 'A test paper');
    assertEqual(p.year, 2024);
    assertEqual(p.doi, '10.1234/test');
    assertEqual(p.journal, 'Journal of Tests');
    assertEqual(p.publisher, 'Test Press');
    assertEqual(p.volume, '10');
    assertEqual(p.issue, '2');
    assertEqual(p.pages, '1-20');
    assertEqual(p.firstPage, '1');
    assertEqual(p.lastPage, '20');
    assertEqual(p.abstract, 'Hello world');
    assertEqual(p.workType, 'journal-article');
    assertDeepEqual(p.authors, ['Alice', 'Bob']);
    assertDeepEqual(p.keywords, ['kw1', 'topic1']);
    assertEqual(p.language, 'EN');
    assertTruthy(p.pdfCandidates.length >= 1);
  });

  test('returns [] when results is missing', async () => {
    const client = makeClient();
    nock(BASE).get(/.+/).query(true).reply(200, {});
    const out = await client.searchWorks('q');
    assertEqual(out.length, 0);
  });

  test('respects limit option', async () => {
    const client = makeClient();
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })];
    nock(BASE).get(/.+/).query(true).reply(200, envelope(items));
    const out = await client.searchWorks('q', { limit: 2 });
    assertEqual(out.length, 2);
    assertEqual(out[0].id, 'a');
    assertEqual(out[1].id, 'b');
  });

  test('throws on 5xx', async () => {
    const client = makeClient();
    nock(BASE).get(/.+/).query(true).reply(500, 'oops');
    await assertRejects(() => client.searchWorks('q'), /DOAJ API error: 500/);
  });

  test('throws 请求已取消 when external signal aborts', async () => {
    const client = makeClient();
    nock(BASE).get(/.+/).query(true).replyWithError({ message: 'aborted', code: 'ABORT_ERR' });
    const ac = new AbortController();
    ac.abort();
    await assertRejects(() => client.searchWorks('q', { signal: ac.signal }), /请求已取消/);
  });

  test('applies yearRange filter to doaj query', async () => {
    const client = makeClient();
    let seenPath = null;
    nock(BASE)
      .get(/.+/)
      .query(true)
      .reply(200, function (uri) {
        seenPath = uri;
        return envelope([]);
      });
    await client.searchWorks('foo', { yearRange: { start: 2020, end: 2024 } });
    assertOk(seenPath.includes('bibjson.year%3A%5B2020'));
    assertOk(seenPath.includes('bibjson.year%3A%5B*'));
  });

  test('searchScope=title-only wraps query in title match', async () => {
    const client = makeClient();
    let seenPath = null;
    nock(BASE)
      .get(/.+/)
      .query(true)
      .reply(200, function (uri) {
        seenPath = uri;
        return envelope([]);
      });
    await client.searchWorks('foo', { searchScope: 'title-only' });
    assertOk(seenPath.includes('bibjson.title%3A%22foo%22'));
  });

  test('searchScope=title-abstract builds OR query', async () => {
    const client = makeClient();
    let seenPath = null;
    nock(BASE)
      .get(/.+/)
      .query(true)
      .reply(200, function (uri) {
        seenPath = uri;
        return envelope([]);
      });
    await client.searchWorks('foo', { searchScope: 'title-abstract' });
    assertOk(seenPath.includes('bibjson.title%3A%22foo%22'));
    assertOk(seenPath.includes('bibjson.abstract%3A%22foo%22'));
    assertOk(seenPath.includes('OR'));
  });

  test('handles missing bibjson fields gracefully', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/.+/)
      .query(true)
      .reply(200, envelope([{ id: 'minimal' }]));
    const out = await client.searchWorks('q');
    assertEqual(out.length, 1);
    assertEqual(out[0].id, 'minimal');
    assertEqual(out[0].title, '');
    assertEqual(out[0].authors.length, 0);
    assertEqual(out[0].language, null);
  });
});
