/**
 * PubMed API client unit tests.
 *
 * PubmedAPI uses global `fetch` (same as OpenAlex and Crossref), and nock
 * 14 intercepts it via undici. PubMed returns XML, so we mock the
 * <PubmedArticle> envelope. Mocks cover both /esearch (returns JSON with
 * ID list) and /efetch (returns XML with full records).
 */
import nock from 'nock';
import { PubMedAPI } from '../../lib/apis/pubmed.js';
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

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

function makeClient(opts = {}) {
  return new PubMedAPI(opts.apiKey ?? null, opts.logger ?? silentLogger);
}

function makeArticle(overrides = {}) {
  return {
    pmid: '12345',
    title: 'A test paper',
    authors: [
      { foreName: 'Alice', lastName: 'A' },
      { foreName: 'Bob', lastName: 'B' },
    ],
    doi: '10.1234/test',
    pmcid: 'PMC9999999',
    year: '2024',
    journal: 'Journal of Tests',
    isoAbbreviation: 'J Tests',
    volume: '10',
    issue: '2',
    pages: '1-20',
    abstract:
      '<AbstractText Label="Background">Hello</AbstractText> <AbstractText Label="Methods">world</AbstractText>',
    keywords: ['kw1', 'kw2'],
    mesh: ['topic1'],
    language: 'eng',
    ...overrides,
  };
}

function articleXml(article) {
  const authorXml = article.authors
    .map(
      (a) =>
        `<Author ><ForeName>${a.foreName}</ForeName><LastName>${a.lastName}</LastName></Author>`
    )
    .join('');
  const keywordXml = article.keywords.map((k) => `<Keyword>${k}</Keyword>`).join('');
  const meshXml = article.mesh.map((m) => `<DescriptorName>${m}</DescriptorName>`).join('');
  return [
    '<PubmedArticle>',
    '<MedlineCitation>',
    `<PMID>${article.pmid}</PMID>`,
    '<Article>',
    '<Journal>',
    `<Title>${article.journal}</Title>`,
    `<ISOAbbreviation>${article.isoAbbreviation}</ISOAbbreviation>`,
    '<JournalIssue>',
    `<Volume>${article.volume}</Volume>`,
    `<Issue>${article.issue}</Issue>`,
    '</JournalIssue>',
    '</Journal>',
    '<ArticleTitle>' + article.title + '</ArticleTitle>',
    `<Pagination><MedlinePgn>${article.pages}</MedlinePgn></Pagination>`,
    `<Language>${article.language}</Language>`,
    `<Abstract>${article.abstract}</Abstract>`,
    `<AuthorList>${authorXml}</AuthorList>`,
    '</Article>',
    `<MeshHeadingList>${meshXml}</MeshHeadingList>`,
    '<PublicationDateList>',
    `<Year>${article.year}</Year>`,
    '</PublicationDateList>',
    '</MedlineCitation>',
    '<PubmedData>',
    `<ArticleIdList><ArticleId IdType="doi">${article.doi}</ArticleId><ArticleId IdType="pmc">${article.pmcid}</ArticleId></ArticleIdList>`,
    `<KeywordList>${keywordXml}</KeywordList>`,
    '</PubmedData>',
    '</PubmedArticle>',
  ].join('');
}

function efetchXml(articles) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<PubmedArticleSet>',
    ...articles.map(articleXml),
    '</PubmedArticleSet>',
  ].join('\n');
}

function esearchJson(ids, extra = {}) {
  return {
    esearchresult: {
      count: String(ids.length),
      retmax: String(ids.length),
      retstart: '0',
      idlist: ids,
      ...extra,
    },
  };
}

suite('pubmed: PubMedAPI constructor', () => {
  beforeEach(cleanNockBeforeEach);

  test('stores apiKey, logger, and timeout', () => {
    const c = new PubMedAPI('key', silentLogger);
    assertEqual(c.apiKey, 'key');
    assertEqual(c.logger, silentLogger);
    assertEqual(c.queryTimeoutMs, 15000);
  });
});

suite('pubmed: searchWorks', () => {
  beforeEach(cleanNockBeforeEach);

  test('returns normalized papers on success', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/\/esearch\.fcgi/)
      .query(true)
      .reply(200, esearchJson(['12345']));
    nock(BASE)
      .get(/\/efetch\.fcgi/)
      .query(true)
      .reply(200, efetchXml([makeArticle()]));
    const out = await client.searchWorks('test query');
    assertEqual(out.length, 1);
    const p = out[0];
    assertEqual(p.source, 'pubmed');
    assertEqual(p.title, 'A test paper');
    assertEqual(p.doi, '10.1234/test');
    assertEqual(p.identifiers.pmid, '12345');
    assertEqual(p.identifiers.pmcid, 'PMC9999999');
    assertEqual(p.id, '12345');
    assertDeepEqual(p.authors, ['Alice A', 'Bob B']);
    assertEqual(p.year, 2024);
    assertEqual(p.venue, 'Journal of Tests');
    assertEqual(p.journal, 'Journal of Tests');
    assertEqual(p.volume, '10');
    assertEqual(p.issue, '2');
    assertEqual(p.pages, '1-20');
    assertEqual(p.firstPage, '1');
    assertEqual(p.lastPage, '20');
    assertEqual(p.language, 'eng');
    assertEqual(p.workType, 'journal-article');
    assertEqual(p.abstract, 'Hello world');
    assertDeepEqual(p.keywords, ['kw1', 'kw2']);
    assertDeepEqual(p.topics, ['topic1']);
    assertEqual(p.url, 'https://pubmed.ncbi.nlm.nih.gov/12345/');
    // pdfCandidates: one for pmcid, one for doi landing page
    assertEqual(p.pdfCandidates.length, 2);
    assertEqual(p.pdfCandidates[0].provider, 'PubMed Central');
    assertEqual(p.pdfCandidates[1].provider, 'doi.org');
  });

  test('returns [] when esearch returns no ids', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/\/esearch\.fcgi/)
      .query(true)
      .reply(200, esearchJson([]));
    const out = await client.searchWorks('nothing');
    assertEqual(out.length, 0);
  });

  test('searchScope=title-only uses [Title] field tag', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/\/esearch\.fcgi/)
      .query((q) => q.term && q.term.includes('[Title]'))
      .reply(200, esearchJson(['1']));
    nock(BASE)
      .get(/\/efetch\.fcgi/)
      .query(true)
      .reply(200, efetchXml([makeArticle()]));
    const out = await client.searchWorks('q', { searchScope: 'title-only' });
    assertEqual(out.length, 1);
  });

  test('applies yearRange as Date - Publication filter', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/\/esearch\.fcgi/)
      .query((q) => q.term && q.term.includes('Date - Publication'))
      .reply(200, esearchJson(['1']));
    nock(BASE)
      .get(/\/efetch\.fcgi/)
      .query(true)
      .reply(200, efetchXml([makeArticle()]));
    const out = await client.searchWorks('q', { yearRange: { start: 2020, end: 2025 } });
    assertEqual(out.length, 1);
  });

  test('sends api_key param when set', async () => {
    const client = makeClient({ apiKey: 'my-key' });
    nock(BASE)
      .get(/\/esearch\.fcgi/)
      .query((q) => q.api_key === 'my-key')
      .reply(200, esearchJson(['1']));
    nock(BASE)
      .get(/\/efetch\.fcgi/)
      .query((q) => q.api_key === 'my-key')
      .reply(200, efetchXml([makeArticle()]));
    const out = await client.searchWorks('q');
    assertEqual(out.length, 1);
  });

  test('throws on esearch 5xx', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/\/esearch\.fcgi/)
      .query(true)
      .reply(500, 'boom');
    await assertRejects(() => client.searchWorks('q'), /PubMed API error: 500/);
  });

  test('throws on efetch 5xx', async () => {
    const client = makeClient();
    nock(BASE)
      .get(/\/esearch\.fcgi/)
      .query(true)
      .reply(200, esearchJson(['1']));
    nock(BASE)
      .get(/\/efetch\.fcgi/)
      .query(true)
      .reply(500, 'boom');
    await assertRejects(() => client.searchWorks('q'), /PubMed API error: 500/);
  });

  test('throws "请求已取消" when external signal aborts', async () => {
    // replyWithError avoids nock double-reply crash (see openalex-api.test.js for details).
    const client = makeClient();
    nock(BASE)
      .get(/\/esearch\.fcgi/)
      .query(true)
      .replyWithError(new Error('aborted'));
    const controller = new AbortController();
    const promise = client.searchWorks('q', { signal: controller.signal });
    controller.abort();
    await assertRejects(() => promise, /./);
  });
});
