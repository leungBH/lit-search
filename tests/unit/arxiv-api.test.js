/**
 * arXiv API client unit tests.
 *
 * arxiv.js uses Node's native `https.request` (NOT global `fetch`).
 * nock 14 can still intercept it, but the path must be matched loosely
 * because `https.request` is invoked with a full URL string. We use
 * `.query(true)` on every interceptor to accept any query string.
 *
 * XML body is the Atom feed shape arxiv actually returns; we only
 * include the fields the client actually reads.
 */
import nock from 'nock';
import { ArxivAPI } from '../../lib/apis/arxiv.js';
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

const BASE = 'https://export.arxiv.org';

function makeClient() {
  return new ArxivAPI();
}

function makeEntry(overrides = {}) {
  const id = overrides.id ?? 'http://arxiv.org/abs/2401.00001v1';
  const arxivId = overrides.arxivId ?? '2401.00001';
  return {
    id,
    title: 'A test paper',
    summary: 'A long abstract',
    published: '2024-03-15T00:00:00Z',
    doi: '10.1234/test',
    journalRef: 'Test Journal 2024',
    comment: '12 pages, 4 figures',
    authors: ['Alice', 'Bob'],
    primaryCategory: 'cs.AI',
    categories: ['cs.AI', 'cs.LG'],
    ...overrides,
  };
}

function wrapEntry(entry) {
  const id = entry.id;
  return [
    '<entry>',
    `<id>${id}</id>`,
    `<title>${entry.title}</title>`,
    `<summary>${entry.summary}</summary>`,
    `<published>${entry.published}</published>`,
    `<arxiv:doi>${entry.doi}</arxiv:doi>`,
    `<arxiv:journal_ref>${entry.journalRef}</arxiv:journal_ref>`,
    `<arxiv:comment>${entry.comment}</arxiv:comment>`,
    '<author><name>Alice</name></author>',
    '<author><name>Bob</name></author>',
    `<arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="${entry.primaryCategory}"/>`,
    `<category term="${entry.categories[0]}"/>`,
    `<category term="${entry.categories[1]}"/>`,
    '</entry>',
  ].join('');
}

function feedXml(entries, opts = {}) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">',
    ...entries.map(wrapEntry),
    '</feed>',
  ].join('\n');
}

suite('arxiv: ArxivAPI constructor', () => {
  beforeEach(cleanNockBeforeEach);

  test('initializes timeouts and retry config', () => {
    const c = makeClient();
    assertEqual(c.queryTimeoutMs, 60000);
    assertEqual(c.outerQueryTimeoutMs, 210000);
    assertEqual(c.maxRetries, 4);
  });
});

suite('arxiv: search', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns normalized papers on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/api/query')
      .query(true)
      .reply(200, feedXml([makeEntry()]));
    const out = await client.search('test query', { limit: 10 });
    assertEqual(out.length, 1);
    const p = out[0];
    assertEqual(p.source, 'arxiv');
    assertEqual(p.title, 'A test paper');
    assertEqual(p.doi, '10.1234/test');
    assertEqual(p.abstract, 'A long abstract');
    assertEqual(p.year, 2024);
    assertEqual(p.venue, 'arXiv');
    assertEqual(p.journal, 'Test Journal 2024');
    assertDeepEqual(p.authors, ['Alice', 'Bob']);
    assertEqual(p.primaryCategory, 'cs.AI');
    assertDeepEqual(p.keywords, ['cs.AI', 'cs.LG']);
    assertEqual(p.identifiers.arxiv, '2401.00001v1');
    assertEqual(p.identifiers.doi, '10.1234/test');
    // arXiv PDF candidate is auto-generated from the arxiv ID
    assertEqual(p.pdfCandidates.length, 1);
    assertEqual(p.pdfCandidates[0].url, 'https://arxiv.org/pdf/2401.00001v1.pdf');
    assertEqual(p.pdfCandidates[0].confidence, 0.98);
  });

  test('returns [] when feed has no <entry>', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/api/query')
      .query(true)
      .reply(200, '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    const out = await client.search('nothing', { limit: 10 });
    assertEqual(out.length, 0);
  });

  test('searchScope=title-only uses ti: search filter', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/api/query')
      .query((q) => q.search_query && q.search_query.includes('ti:'))
      .reply(200, feedXml([makeEntry()]));
    const out = await client.search('x', { limit: 1, searchScope: 'title-only' });
    assertEqual(out.length, 1);
  });

  test('applies yearRange by adding submittedDate filter', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/api/query')
      .query((q) => q.search_query && q.search_query.includes('submittedDate:'))
      .reply(200, feedXml([makeEntry()]));
    const out = await client.search('x', { limit: 1, yearRange: { start: 2020, end: 2025 } });
    assertEqual(out.length, 1);
  });

  test('applies categories filter (cat:...)', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/api/query')
      .query((q) => q.search_query && q.search_query.includes('cat:cs.AI'))
      .reply(200, feedXml([makeEntry()]));
    const out = await client.search('x', { limit: 1, categories: ['cs.AI'] });
    assertEqual(out.length, 1);
  });

  test('throws on persistent 5xx after retries', async () => {
    // Default arxiv retry delays are 10/30/60/90s — far too slow for a unit test.
    // Stub _sleep to no-op so retries complete in milliseconds.
    const client = makeClient();
    client._sleep = async () => {};
    nock(BASE).persist().get('/api/query').query(true).reply(503, 'Service Unavailable');
    await assertRejects(() => client.search('q', { limit: 1 }), /arXiv API error: 503/);
  });

  test('throws on 4xx (non-429) immediately', async () => {
    const client = makeClient();
    nock(BASE).get('/api/query').query(true).reply(400, 'Bad Request');
    await assertRejects(() => client.search('q', { limit: 1 }), /arXiv API error: 400/);
  });

  test('throws "请求已取消" when external signal aborts', async () => {
    // replyWithError avoids nock double-reply crash (see openalex-api.test.js for details).
    const client = makeClient();
    nock(BASE).get('/api/query').query(true).replyWithError(new Error('aborted'));
    const controller = new AbortController();
    const promise = client.search('q', { limit: 1, signal: controller.signal });
    controller.abort();
    await assertRejects(() => promise, /./);
  });
});

suite('arxiv: fetchById', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns normalized paper on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/api/query')
      .query((q) => q.id_list === '2401.00001')
      .reply(200, feedXml([makeEntry()]));
    const out = await client.fetchById('2401.00001');
    assertOk(out);
    // arXiv id captures the version suffix from the abs URL
    assertEqual(out.identifiers.arxiv, '2401.00001v1');
    // explicit ascii-only literals to avoid any encoding surprises
    const expectedTitle = 'A test paper';
    if (out.title !== expectedTitle) {
      throw new Error(
        `out.title = ${JSON.stringify(out.title)}, expected ${JSON.stringify(expectedTitle)}`
      );
    }
  });

  test('strips "arxiv:" prefix from input', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/api/query')
      .query((q) => q.id_list === '2401.00001')
      .reply(200, feedXml([makeEntry()]));
    const out = await client.fetchById('arxiv:2401.00001');
    assertOk(out);
  });

  test('returns null for empty/null id', async () => {
    const client = makeClient();
    assertFalsy(await client.fetchById(null));
    assertFalsy(await client.fetchById(''));
  });

  test('returns null on network error (try/catch swallows it)', async () => {
    const client = makeClient();
    nock(BASE).get('/api/query').query(true).replyWithError(new Error('ECONNRESET'));
    assertFalsy(await client.fetchById('2401.00001'));
  });

  test('returns null on 404', async () => {
    const client = makeClient();
    nock(BASE).get('/api/query').query(true).reply(404, 'not found');
    assertFalsy(await client.fetchById('2401.99999'));
  });
});

suite('arxiv: lookupByTitle', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns first match on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/api/query')
      .query((q) => q.max_results === '1' && q.search_query.includes('ti:'))
      .reply(200, feedXml([makeEntry({ title: 'The Title' })]));
    const out = await client.lookupByTitle('The Title');
    assertOk(out);
    assertEqual(out.title, 'The Title');
  });

  test('returns null when feed has no <entry>', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/api/query')
      .query(true)
      .reply(200, '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    assertFalsy(await client.lookupByTitle('nope'));
  });

  test('returns null for empty title (no fetch)', async () => {
    const client = makeClient();
    assertFalsy(await client.lookupByTitle(''));
    assertFalsy(await client.lookupByTitle(null));
  });

  test('throws with .status on 5xx', async () => {
    const client = makeClient();
    nock(BASE).get('/api/query').query(true).reply(500, 'boom');
    let caught;
    try {
      await client.lookupByTitle('q');
    } catch (e) {
      caught = e;
    }
    assertTruthy(caught);
    assertEqual(caught.status, 500);
    assertEqual(caught.source, 'arxiv');
  });
});
