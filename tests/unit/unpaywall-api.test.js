/**
 * Unpaywall API client unit tests.
 *
 * Unpaywall only has `fetchByDoi(doi, signal)` and requires an email
 * (else returns null). The endpoint is `/v2/{doi}?email=...`.
 */
import nock from 'nock';
import { UnpaywallAPI } from '../../lib/apis/unpaywall.js';
import {
  suite,
  test,
  beforeEach,
  assertEqual,
  assertOk,
  assertTruthy,
  assertFalsy,
  silentLogger,
  cleanNockBeforeEach,
} from './helpers.js';

const BASE = 'https://api.unpaywall.org/v2';

function makeClient(opts = {}) {
  return new UnpaywallAPI(opts.email ?? 'me@example.org', silentLogger);
}

function envelope(overrides = {}) {
  return {
    doi: '10.1234/test',
    is_oa: true,
    oa_status: 'gold',
    genre: 'journal-article',
    title: 'A test paper',
    year: 2024,
    journal_name: 'Journal of Tests',
    publisher: 'Test Press',
    best_oa_location: {
      url_for_pdf: 'https://example.org/paper.pdf',
      license: 'cc-by',
      host_type: 'publisher',
      version: 'publishedVersion',
    },
    oa_locations: [],
    ...overrides,
  };
}

suite('unpaywall: UnpaywallAPI constructor', () => {
  test('stores email and logger; default timeout', () => {
    const c = new UnpaywallAPI('me@example.org', silentLogger);
    assertEqual(c.email, 'me@example.org');
    assertEqual(c.logger, silentLogger);
    assertEqual(c.queryTimeoutMs, 12000);
  });

  test('coerces empty email to null', () => {
    const c = new UnpaywallAPI('', silentLogger);
    assertFalsy(c.email);
  });
});

suite('unpaywall: fetchByDoi', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns normalized OA record on success', async () => {
    const client = makeClient();
    nock(BASE).get('/10.1234%2Ftest').query(true).reply(200, envelope());
    const out = await client.fetchByDoi('10.1234/test');
    assertOk(out);
    assertEqual(out.doi, '10.1234/test');
    assertEqual(out.is_oa, true);
    assertEqual(out.oa_status, 'gold');
    assertEqual(out.title, 'A test paper');
    assertEqual(out.year, 2024);
    assertEqual(out.journal, 'Journal of Tests');
    assertEqual(out.publisher, 'Test Press');
    assertEqual(out.license, 'cc-by');
    assertEqual(out.pdfCandidates.length, 1);
    const c0 = out.pdfCandidates[0];
    assertEqual(c0.source, 'unpaywall');
    assertEqual(c0.url, 'https://example.org/paper.pdf');
    assertEqual(c0.access_type, 'publisher_oa_pdf');
    assertEqual(c0.license, 'cc-by');
  });

  test('returns null for empty/null doi', async () => {
    const client = makeClient();
    assertFalsy(await client.fetchByDoi(null));
    assertFalsy(await client.fetchByDoi(''));
  });

  test('returns null when email is not configured', async () => {
    const client = new UnpaywallAPI(null, silentLogger);
    assertFalsy(await client.fetchByDoi('10.1234/test'));
  });

  test('returns null on 404', async () => {
    const client = makeClient();
    nock(BASE).get(/.+/).query(true).reply(404, 'not found');
    assertFalsy(await client.fetchByDoi('10.1234/missing'));
  });

  test('returns null on network error', async () => {
    const client = makeClient();
    nock(BASE).get(/.+/).query(true).replyWithError({ message: 'boom', code: 'ECONNRESET' });
    assertFalsy(await client.fetchByDoi('10.1234/test'));
  });

  test('strips doi: prefix and trims punctuation', async () => {
    const client = makeClient();
    nock(BASE).get('/10.1234%2Ftest').query(true).reply(200, envelope());
    const out = await client.fetchByDoi('doi:10.1234/test.');
    assertOk(out);
    assertEqual(out.doi, '10.1234/test');
  });

  test('infers access_type from version: acceptedManuscript', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/.+/)
      .query(true)
      .reply(
        200,
        envelope({
          best_oa_location: {
            url: 'https://repo.example.org/paper',
            host_type: 'repository',
            version: 'acceptedVersion',
            license: null,
          },
        })
      );
    const out = await client.fetchByDoi('10.1234/test');
    assertEqual(out.pdfCandidates[0].access_type, 'accepted_manuscript');
  });
});
