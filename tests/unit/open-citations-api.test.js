/**
 * OpenCitations API client unit tests.
 *
 * OpenCitations calls two endpoints in parallel under a given DOI:
 *   /references/doi:<doi>
 *   /citations/doi:<doi>
 * Each returns a JSON array of relations (or [] on error).
 */
import nock from 'nock';
import { OpenCitationsAPI } from '../../lib/apis/open-citations.js';
import {
  suite,
  test,
  beforeEach,
  assertEqual,
  assertDeepEqual,
  assertOk,
  assertFalsy,
  silentLogger,
  cleanNockBeforeEach,
} from './helpers.js';

const BASE = 'https://opencitations.net/index/api/v2';

function makeClient() {
  return new OpenCitationsAPI(silentLogger);
}

function relation(overrides = {}) {
  return {
    citing: '10.1000/citing',
    cited: '10.1000/cited',
    creation: '2024-01-01',
    timespan: 'P1Y',
    journal_sc: 'yes',
    ...overrides,
  };
}

suite('open-citations: OpenCitationsAPI constructor', () => {
  test('uses default timeout and provided logger', () => {
    const c = new OpenCitationsAPI(silentLogger);
    assertEqual(c.queryTimeoutMs, 12000);
    assertEqual(c.logger, silentLogger);
  });
});

suite('open-citations: fetchCitationRelations', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns { references, citations } for a valid DOI', async () => {
    const client = makeClient();
    nock(BASE)
      .get('/references/doi:10.1234%2Ftest')
      .reply(200, [relation({ cited: '10.1234/test', citing: '10.1000/a' })]);
    nock(BASE)
      .get('/citations/doi:10.1234%2Ftest')
      .reply(200, [relation({ cited: '10.1000/b', citing: '10.1234/test' })]);
    const out = await client.fetchCitationRelations('10.1234/test');
    assertOk(out);
    assertEqual(out.doi, '10.1234/test');
    assertEqual(out.references.length, 1);
    assertEqual(out.citations.length, 1);
    assertEqual(out.references[0].citing, '10.1000/a');
    assertEqual(out.citations[0].cited, '10.1000/b');
  });

  test('returns null for empty/null doi', async () => {
    const client = makeClient();
    assertFalsy(await client.fetchCitationRelations(null));
    assertFalsy(await client.fetchCitationRelations(''));
  });

  test('empty arrays when both endpoints return []', async () => {
    const client = makeClient();
    nock(BASE).get('/references/doi:10.1234%2Ftest').reply(200, []);
    nock(BASE).get('/citations/doi:10.1234%2Ftest').reply(200, []);
    const out = await client.fetchCitationRelations('10.1234/test');
    assertEqual(out.references.length, 0);
    assertEqual(out.citations.length, 0);
  });

  test('returns [] arrays when endpoints error', async () => {
    const client = makeClient();
    nock(BASE).get('/references/doi:10.1234%2Ftest').reply(500, 'oops');
    nock(BASE).get('/citations/doi:10.1234%2Ftest').reply(500, 'oops');
    const out = await client.fetchCitationRelations('10.1234/test');
    assertDeepEqual(out.references, []);
    assertDeepEqual(out.citations, []);
  });

  test('handles non-array response from endpoint as []', async () => {
    const client = makeClient();
    nock(BASE).get('/references/doi:10.1234%2Ftest').reply(200, { error: 'malformed' });
    nock(BASE).get('/citations/doi:10.1234%2Ftest').reply(200, { error: 'malformed' });
    const out = await client.fetchCitationRelations('10.1234/test');
    assertDeepEqual(out.references, []);
    assertDeepEqual(out.citations, []);
  });

  test('strips doi: prefix and trims punctuation', async () => {
    const client = makeClient();
    nock(BASE).get('/references/doi:10.1234%2Ftest').reply(200, []);
    nock(BASE).get('/citations/doi:10.1234%2Ftest').reply(200, []);
    const out = await client.fetchCitationRelations('doi:10.1234/test.');
    assertEqual(out.doi, '10.1234/test');
  });
});
