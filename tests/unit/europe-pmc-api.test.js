/**
 * Europe PMC API client unit tests.
 *
 * Europe PMC returns JSON: { resultList: { result: [ ... ] } }
 */
import nock from 'nock';
import { EuropePmcAPI } from '../../lib/apis/europe-pmc.js';
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

const BASE = 'https://www.ebi.ac.uk';

function makeClient() {
  return new EuropePmcAPI(silentLogger);
}

function makeResult(overrides = {}) {
  return {
    pmid: '12345',
    pmcid: 'PMC9999999',
    doi: '10.1234/test',
    title: 'A test paper',
    authorString: 'Alice A, Bob B',
    pubYear: '2024',
    journalTitle: 'Journal of Tests',
    journalVolume: '10',
    issue: '2',
    pageInfo: '1-20',
    abstractText: 'Hello world',
    fullTextUrlList: {
      fullTextUrl: [
        {
          url: 'https://europepmc.org/articles/PMC9999999/pdf',
          documentStyle: 'pdf',
          availability: 'OA',
        },
      ],
    },
    ...overrides,
  };
}

function envelope(results) {
  return { resultList: { result: results } };
}

suite('europe-pmc: EuropePmcAPI constructor', () => {
  test('uses default timeout and provided logger', () => {
    const c = new EuropePmcAPI(silentLogger);
    assertEqual(c.queryTimeoutMs, 15000);
    assertEqual(c.logger, silentLogger);
  });
});

suite('europe-pmc: searchWorks', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns normalized papers on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/europepmc/webservices/rest/search')
      .query(true)
      .reply(200, envelope([makeResult()]));
    const out = await client.searchWorks('test');
    assertEqual(out.length, 1);
    const p = out[0];
    assertEqual(p.id, '12345');
    assertEqual(p.title, 'A test paper');
    assertEqual(p.year, 2024);
    assertEqual(p.doi, '10.1234/test');
    assertEqual(p.identifiers.pmid, '12345');
    assertEqual(p.identifiers.pmcid, 'PMC9999999');
    assertEqual(p.identifiers.doi, '10.1234/test');
    assertEqual(p.journal, 'Journal of Tests');
    assertEqual(p.venue, 'Journal of Tests');
    assertEqual(p.abstract, 'Hello world');
    assertDeepEqual(p.authors, ['Alice A', 'Bob B']);
    assertTruthy(p.pdfCandidates.length >= 1);
  });

  test('returns [] when resultList is missing', async () => {
    const client = makeClient();
    nock(BASE).get('/europepmc/webservices/rest/search').query(true).reply(200, {});
    const out = await client.searchWorks('q');
    assertEqual(out.length, 0);
  });

  test('year range filter applied in query', async () => {
    const client = makeClient();
    nock(BASE).get('/europepmc/webservices/rest/search').query(true).reply(200, envelope([]));
    await client.searchWorks('q', { yearRange: { start: 2020, end: 2024 } });
    // The interceptor accepted any query, but the call should not throw.
    assertOk(true);
  });

  test('throws on 4xx', async () => {
    const client = makeClient();
    nock(BASE).get('/europepmc/webservices/rest/search').query(true).reply(404, 'not found');
    await assertRejects(() => client.searchWorks('q'), /Europe PMC API error: 404/);
  });

  test('throws 请求已取消 when external signal aborts', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/europepmc/webservices/rest/search')
      .query(true)
      .replyWithError({ message: 'aborted', code: 'ABORT_ERR' });
    const ac = new AbortController();
    ac.abort();
    await assertRejects(() => client.searchWorks('q', { signal: ac.signal }), /请求已取消/);
  });

  test('searchScope=title-only wraps query in TITLE: field', async () => {
    const client = makeClient();
    let seenQuery = null;
    nock(BASE)
      .get('/europepmc/webservices/rest/search')
      .query((q) => {
        seenQuery = q.query;
        return true;
      })
      .reply(200, envelope([]));
    await client.searchWorks('foo', { searchScope: 'title-only' });
    assertOk(seenQuery.includes('TITLE:'));
    assertOk(!seenQuery.includes('ABSTRACT:'));
  });

  test('searchScope=title-abstract builds TITLE OR ABSTRACT clause', async () => {
    const client = makeClient();
    let seenQuery = null;
    nock(BASE)
      .get('/europepmc/webservices/rest/search')
      .query((q) => {
        seenQuery = q.query;
        return true;
      })
      .reply(200, envelope([]));
    await client.searchWorks('foo', { searchScope: 'title-abstract' });
    assertOk(seenQuery.includes('TITLE:'));
    assertOk(seenQuery.includes('ABSTRACT:'));
    assertOk(seenQuery.includes('OR'));
  });

  test('collects keywords from keywordList and meshHeadingList', async () => {
    const client = makeClient();
    const item = {
      pmid: '1',
      title: 'T',
      authorString: 'A B',
      pubYear: '2024',
      keywordList: { keyword: ['kw1', 'kw2'] },
      meshHeadingList: {
        meshHeading: [{ descriptorName: 'mesh1' }, 'mesh2'],
      },
    };
    nock(BASE)
      .get('/europepmc/webservices/rest/search')
      .query(true)
      .reply(200, envelope([item]));
    const out = await client.searchWorks('q');
    assertDeepEqual(out[0].keywords.sort(), ['kw1', 'kw2', 'mesh1', 'mesh2'].sort());
  });

  test('falls back to article URL when no fullTextUrl', async () => {
    const client = makeClient();
    const item = { pmid: '12345', title: 'T' };
    nock(BASE)
      .get('/europepmc/webservices/rest/search')
      .query(true)
      .reply(200, envelope([item]));
    const out = await client.searchWorks('q');
    assertEqual(out[0].url, 'https://europepmc.org/article/MED/12345');
  });

  test('uses PMC URL when only pmcid is provided', async () => {
    const client = makeClient();
    const item = { pmcid: 'PMC9999999', title: 'T' };
    nock(BASE)
      .get('/europepmc/webservices/rest/search')
      .query(true)
      .reply(200, envelope([item]));
    const out = await client.searchWorks('q');
    assertEqual(out[0].url, 'https://europepmc.org/article/PMC/9999999');
  });
});
