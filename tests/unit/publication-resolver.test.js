/**
 * Pure / dependency-injected tests for `lib/publication-resolver.js`.
 *
 * `attachPublicationModel` is fully pure. `resolvePublicationForPaper` and
 * `resolvePublicationsInPool` only do I/O through the caller-supplied
 * `openalex` object, so we stub it instead of mocking `fetch`.
 */

import { suite, test } from '../test-runner.js';
import {
  assertEqual,
  assertDeepEqual,
  assertOk,
  assertMatch,
  assertThrows
} from '../test-runner.js';
import {
  attachPublicationModel,
  resolvePublicationForPaper,
  resolvePublicationsInPool
} from '../../lib/publication-resolver.js';

// ────────────────────────────────────────────────────────────────────────────
// attachPublicationModel (pure)
// ────────────────────────────────────────────────────────────────────────────

suite('publication-resolver: attachPublicationModel (identity + preprint)', () => {
  test('builds identity with normalized DOI from paper.doi', () => {
    const out = attachPublicationModel({ title: 't', doi: 'https://dx.doi.org/10.1145/abc' });
    assertEqual(out.identity.doi, '10.1145/abc');
    assertOk(out.identity.title_author_year_fingerprint);
  });

  test('normalizes DOI from paper.identifiers.doi too', () => {
    // The trailing period is stripped by normalizeDoi's punctuation stripper.
    const out = attachPublicationModel({ title: 't', identifiers: { doi: '  DOI:10.1/X.  ' } });
    assertEqual(out.identity.doi, '10.1/x');
  });

  test('prefers paper.doi over identifiers.doi when both set', () => {
    const out = attachPublicationModel({ title: 't', doi: '10.1/A', identifiers: { doi: '10.1/B' } });
    assertEqual(out.identity.doi, '10.1/a');
  });

  test('preserves arxiv_id from paper or identifiers', () => {
    const a = attachPublicationModel({ title: 't', arxiv_id: '2401.01234' });
    assertEqual(a.identity.arxiv_id, '2401.01234');
    const b = attachPublicationModel({ title: 't', identifiers: { arxiv: '2401.99999' } });
    assertEqual(b.identity.arxiv_id, '2401.99999');
  });

  test('preprint object is built when source=arxiv', () => {
    const out = attachPublicationModel({
      title: 'T', source: 'arxiv', arxiv_id: '2401.01234',
      authors: ['Alice Smith', 'Bob Jones'], year: 2024, journal: 'arXiv'
    });
    assertEqual(out.preprint.source, 'arxiv');
    assertEqual(out.preprint.arxiv_id, '2401.01234');
    assertEqual(out.preprint.url, 'https://arxiv.org/abs/2401.01234');
    // journal='arXiv' is filtered out (treated as preprint venue)
    assertEqual(out.preprint.journal_ref, null);
  });

  test('preprint object is null when source is not arxiv and no arxiv_id', () => {
    const out = attachPublicationModel({ title: 't', source: 'openalex' });
    assertEqual(out.preprint, null);
  });

  test('fingerprint combines (title, last name of first author, year)', () => {
    const out = attachPublicationModel({
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      year: 2017
    });
    // normalizeTitle lowercases and strips punctuation
    assertMatch(out.identity.title_author_year_fingerprint, /attention is all you need/);
    assertMatch(out.identity.title_author_year_fingerprint, /vaswani/);
    assertMatch(out.identity.title_author_year_fingerprint, /2017/);
  });
});

suite('publication-resolver: attachPublicationModel (publication_status inference)', () => {
  test('citation_metadata with non-arxiv DOI → published', () => {
    const out = attachPublicationModel({
      title: 't', source: 'openalex',
      citation_metadata: { doi: '10.1145/abc', journal: 'CACM' }
    });
    assertEqual(out.publication_status, 'published');
  });

  test('paper.doi with non-arxiv journal → published', () => {
    const out = attachPublicationModel({
      title: 't', doi: '10.1145/abc', journal: 'CACM'
    });
    assertEqual(out.publication_status, 'published');
  });

  test('arxiv DOI in top-level paper.doi + arxiv-like journal (no other preprint signal) → "unknown"', () => {
    // Documented behavior: without source=arxiv / arxiv_id / preprint object,
    // the paper is "unknown" even if its DOI and journal are arxiv-like.
    // The "published" branch is skipped (arxiv-like), but the "preprint_only"
    // branch needs an explicit preprint signal.
    const out = attachPublicationModel({
      title: 't', doi: '10.48550/arxiv.2401.01234', journal: 'arXiv'
    });
    assertEqual(out.publication_status, 'unknown');
  });

  test('arxiv DOI + arxiv_id → preprint_only', () => {
    // Once the arxiv_id signal is present, the published branch is skipped
    // (arxiv-like) AND the preprint_only branch fires.
    const out = attachPublicationModel({
      title: 't', doi: '10.48550/arxiv.2401.01234', journal: 'arXiv',
      arxiv_id: '2401.01234'
    });
    assertEqual(out.publication_status, 'preprint_only');
  });

  test('arxiv DOI in citation_metadata WITHOUT top-level arxiv-like signals → "published" (known gap)', () => {
    // Documented behavior: inferPublicationStatus only checks the citation_metadata
    // for non-DOI signals (source/journal/venue/publisher/url). If the arxiv
    // signal is only in the DOI, it is NOT detected as preprint.
    // This is a quirk worth pinning — see lib/publication-resolver.js#inferPublicationStatus.
    const out = attachPublicationModel({
      title: 't', source: 'openalex',
      citation_metadata: { doi: '10.48550/arxiv.2401.01234' }
    });
    assertEqual(out.publication_status, 'published');
  });

  test('source=arxiv → preprint_only', () => {
    const out = attachPublicationModel({ title: 't', source: 'arxiv' });
    assertEqual(out.publication_status, 'preprint_only');
  });

  test('paper with arxiv_id but no other signals → preprint_only', () => {
    const out = attachPublicationModel({ title: 't', arxiv_id: '2401.01234' });
    assertEqual(out.publication_status, 'preprint_only');
  });

  test('no DOI, no preprint signals → unknown', () => {
    const out = attachPublicationModel({ title: 't', source: 'openalex' });
    assertEqual(out.publication_status, 'unknown');
  });

  test('explicit publication_status on input wins over inference', () => {
    const out = attachPublicationModel({ title: 't', source: 'arxiv', publication_status: 'published' });
    assertEqual(out.publication_status, 'published');
  });
});

suite('publication-resolver: attachPublicationModel (metadata_sources shape)', () => {
  test('always sets identity source with confidence 0.8', () => {
    const out = attachPublicationModel({ title: 't' });
    assertEqual(out.metadata_sources.identity.source, 'lit-search');
    assertEqual(out.metadata_sources.identity.confidence, 0.8);
  });

  test('sets preprint source only when preprint is built', () => {
    const a = attachPublicationModel({ title: 't', source: 'arxiv' });
    assertOk(a.metadata_sources.preprint, 'preprint source present for arxiv');
    assertEqual(a.metadata_sources.preprint.source, 'arxiv');

    const b = attachPublicationModel({ title: 't', source: 'openalex' });
    assertEqual(b.metadata_sources.preprint, undefined);
  });

  test('preserves existing metadata_sources keys', () => {
    const out = attachPublicationModel({
      title: 't',
      metadata_sources: { existing: { source: 'orig', confidence: 0.5, reason: 'kept' } }
    });
    assertOk(out.metadata_sources.existing);
    assertOk(out.metadata_sources.identity);
  });
});

suite('publication-resolver: attachPublicationModel (citation_metadata & preference)', () => {
  test('preserves existing paper.citation_metadata verbatim', () => {
    const cite = { title: 'X', source: 's2', confidence: 0.77, reason: 'kept' };
    const out = attachPublicationModel({ title: 't', citation_metadata: cite });
    assertEqual(out.citation_metadata, cite);
  });

  test('builds a fresh citation_metadata from paper when none provided', () => {
    const out = attachPublicationModel({
      title: 'T', authors: ['Alice'], year: 2020, doi: '10.1/x',
      source: 'openalex'
    });
    assertEqual(out.citation_metadata.title, 'T');
    assertEqual(out.citation_metadata.year, 2020);
    assertEqual(out.citation_metadata.doi, '10.1/x');
    assertEqual(out.citation_metadata.source, 'openalex');
  });

  test('citation_metadata_preference defaults to best_available when published', () => {
    const out = attachPublicationModel({
      title: 't', doi: '10.1145/abc', journal: 'CACM'
    });
    assertEqual(out.publication_status, 'published');
    assertEqual(out.citation_metadata_preference, 'best_available');
  });

  test('citation_metadata_preference defaults to preprint-only when not published', () => {
    const out = attachPublicationModel({ title: 't', source: 'arxiv' });
    assertEqual(out.citation_metadata_preference, 'preprint_only_until_published_metadata_found');
  });

  test('preserves explicit citation_metadata_preference on input', () => {
    const out = attachPublicationModel({
      title: 't', source: 'arxiv',
      citation_metadata_preference: 'best_available'
    });
    assertEqual(out.citation_metadata_preference, 'best_available');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolvePublicationForPaper (with stub openalex)
// ────────────────────────────────────────────────────────────────────────────

function makeStubOpenalex({ byDoi = null, byId = null, searchResults = [] } = {}) {
  const calls = { byDoi: [], byId: [], search: [] };
  return {
    calls,
    fetchWorkByDoi: async (doi) => { calls.byDoi.push(doi); return byDoi; },
    fetchWorkById:  async (id)  => { calls.byId.push(id);  return byId; },
    searchWorks:    async (q, o) => { calls.search.push({ q, o }); return searchResults; }
  };
}

suite('publication-resolver: resolvePublicationForPaper (no resolution needed)', () => {
  test('paper with no preprint signal is returned as base (openalex never called)', async () => {
    const openalex = makeStubOpenalex();
    const paper = { title: 't', doi: '10.1/x', source: 'openalex' };
    const out = await resolvePublicationForPaper(paper, { openalex });
    assertEqual(openalex.calls.byDoi.length, 0);
    assertEqual(openalex.calls.byId.length, 0);
    assertEqual(openalex.calls.search.length, 0);
    assertEqual(out.publication_status, 'published');
  });

  test('paper with arxiv_id and no formal record → preprint_only', async () => {
    const openalex = makeStubOpenalex(); // all nulls
    const paper = { title: 'On Things', source: 'arxiv', arxiv_id: '2401.01234' };
    const out = await resolvePublicationForPaper(paper, { openalex });
    assertEqual(out.publication_status, 'preprint_only');
    assertEqual(out.citation_metadata_preference, 'preprint_only_until_published_metadata_found');
  });

  test('paper with arxiv_id and no formal record but title yields no match → preprint_only', async () => {
    const openalex = makeStubOpenalex({ searchResults: [] });
    const paper = { title: 'On Things', source: 'arxiv', arxiv_id: '2401.01234', year: 2024 };
    const out = await resolvePublicationForPaper(paper, { openalex });
    assertEqual(openalex.calls.search.length, 1);
    assertEqual(out.publication_status, 'preprint_only');
  });

  test('missing openalex → preprint_only (DOI path skipped, title search skipped)', async () => {
    const paper = { title: 't', source: 'arxiv', arxiv_id: '2401.01234' };
    const out = await resolvePublicationForPaper(paper, { openalex: null });
    assertEqual(out.publication_status, 'preprint_only');
  });
});

suite('publication-resolver: resolvePublicationForPaper (DOI lookup)', () => {
  test('DOI lookup that returns a non-arxiv formal record → published', async () => {
    const candidate = {
      doi: '10.1145/abc', title: 'Some Paper', authors: ['Alice'], year: 2020,
      journal: 'CACM'
    };
    const openalex = makeStubOpenalex({ byDoi: candidate });
    const paper = { title: 'Some Paper', source: 'arxiv', arxiv_id: '2401.01234', doi: '10.1145/abc' };
    const out = await resolvePublicationForPaper(paper, { openalex });
    assertEqual(out.publication_status, 'published');
    assertEqual(out.citation_metadata.source, 'openalex.formal_record');
    assertEqual(out.citation_metadata.confidence, 0.86);
    assertOk(out.metadata_sources.citation_metadata);
  });

  test('DOI lookup that returns an arxiv DOI is rejected (no formal record)', async () => {
    const arxivLike = { doi: '10.48550/arxiv.2401.01234', title: 'T', authors: ['A'], year: 2024 };
    const openalex = makeStubOpenalex({ byDoi: arxivLike, searchResults: [] });
    const paper = { title: 'T', source: 'arxiv', arxiv_id: '2401.01234', doi: '10.1145/abc' };
    const out = await resolvePublicationForPaper(paper, { openalex });
    // falls through to title search, which returns nothing → preprint_only
    assertEqual(openalex.calls.search.length, 1);
    assertEqual(out.publication_status, 'preprint_only');
  });

  test('DOI lookup that throws is treated as no candidate', async () => {
    const openalex = {
      fetchWorkByDoi: async () => { throw new Error('network'); },
      fetchWorkById:  async () => null,
      searchWorks:    async () => []
    };
    const paper = { title: 'T', source: 'arxiv', arxiv_id: '2401.01234' };
    const out = await resolvePublicationForPaper(paper, { openalex });
    assertEqual(out.publication_status, 'preprint_only');
  });
});

suite('publication-resolver: resolvePublicationForPaper (OpenAlex ID lookup)', () => {
  test('openalex_id lookup returns a formal record → published', async () => {
    const candidate = {
      doi: '10.1145/abc', title: 'Paper', authors: ['A'], year: 2020, journal: 'CACM'
    };
    const openalex = {
      fetchWorkByDoi: async () => null,
      fetchWorkById:  async () => candidate,
      searchWorks:    async () => []
    };
    // must have a preprint signal (source=arxiv) for shouldAttemptResolution to pass
    const paper = { title: 'Paper', source: 'arxiv', arxiv_id: '2401.0', openalex_id: 'W123' };
    const out = await resolvePublicationForPaper(paper, { openalex });
    assertEqual(out.publication_status, 'published');
  });

  test('resolves openalex_id from paper.identifiers.openalex', async () => {
    const candidate = { doi: '10.1/x', title: 'X', authors: ['A'], year: 2020, journal: 'J' };
    const openalex = {
      fetchWorkByDoi: async () => null,
      fetchWorkById:  async (id) => { assertEqual(id, 'W999'); return candidate; },
      searchWorks:    async () => []
    };
    const paper = { title: 'X', source: 'arxiv', arxiv_id: '2401.0', identifiers: { openalex: 'W999' } };
    const out = await resolvePublicationForPaper(paper, { openalex });
    assertEqual(out.publication_status, 'published');
  });
});

suite('publication-resolver: resolvePublicationForPaper (title search)', () => {
  test('title search returns a high-confidence match → published', async () => {
    const candidate = {
      doi: '10.1/x', title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'], year: 2017, journal: 'NeurIPS'
    };
    const openalex = makeStubOpenalex({ searchResults: [candidate] });
    const paper = { title: 'Attention Is All You Need', source: 'arxiv', arxiv_id: '1706.03762', year: 2017, authors: ['Ashish Vaswani'] };
    const out = await resolvePublicationForPaper(paper, { openalex });
    assertEqual(out.publication_status, 'published');
  });

  test('title search returns only low-similarity candidates → preprint_only', async () => {
    const candidate = {
      doi: '10.1/x', title: 'Completely Different Topic',
      authors: ['Z'], year: 2017, journal: 'J'
    };
    const openalex = makeStubOpenalex({ searchResults: [candidate] });
    const paper = { title: 'Attention Is All You Need', source: 'arxiv', arxiv_id: '1706.03762' };
    const out = await resolvePublicationForPaper(paper, { openalex });
    assertEqual(out.publication_status, 'preprint_only');
  });

  test('title search with year filter passes yearRange ± 1..2', async () => {
    const openalex = makeStubOpenalex({ searchResults: [] });
    const paper = { title: 'T', source: 'arxiv', arxiv_id: '2401.0', year: 2024 };
    await resolvePublicationForPaper(paper, { openalex });
    const opts = openalex.calls.search[0].o;
    assertEqual(opts.searchScope, 'title-only');
    assertEqual(opts.yearRange.start, 2023); // max(1900, 2024-1)
    assertEqual(opts.yearRange.end, 2026);
  });
});

suite('publication-resolver: resolvePublicationForPaper (preferPublished top-level copy)', () => {
  test('preferPublished=true: top-level fields updated from citation_metadata', async () => {
    const candidate = {
      doi: '10.1/x', title: 'T', authors: ['A'], year: 2020,
      journal: 'J', volume: '1', issue: '2', pages: '1-10',
      publisher: 'P', url: 'https://x', entry_type: 'article'
    };
    const openalex = makeStubOpenalex({ byDoi: candidate });
    const paper = { title: 'T', source: 'arxiv', arxiv_id: '2401.0', doi: '10.1/x' };
    const out = await resolvePublicationForPaper(paper, { openalex, preferPublished: true });
    assertEqual(out.journal, 'J');
    assertEqual(out.volume, '1');
    assertEqual(out.issue, '2');
    assertEqual(out.pages, '1-10');
    assertEqual(out.publisher, 'P');
    assertEqual(out.url, 'https://x');
    assertEqual(out.year, 2020);
    // preference flips to published
    assertEqual(out.citation_metadata_preference, 'published_version');
  });

  test('preferPublished=false (default): top-level fields NOT overwritten', async () => {
    const candidate = {
      doi: '10.1/x', title: 'T', authors: ['A'], year: 2020, journal: 'J'
    };
    const openalex = makeStubOpenalex({ byDoi: candidate });
    const paper = { title: 'T', source: 'arxiv', arxiv_id: '2401.0', doi: '10.1/x', journal: 'arXiv' };
    const out = await resolvePublicationForPaper(paper, { openalex });
    // citation_metadata has the new journal, but top-level still has 'arXiv'
    assertEqual(out.citation_metadata.journal, 'J');
    assertEqual(out.journal, 'arXiv');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolvePublicationsInPool (with stub openalex)
// ────────────────────────────────────────────────────────────────────────────

suite('publication-resolver: resolvePublicationsInPool (stats)', () => {
  test('enabled=false: every paper is base model, no openalex calls', async () => {
    const openalex = makeStubOpenalex();
    const pool = { papers: [
      { title: 'A', source: 'arxiv' },
      { title: 'B', source: 'openalex', doi: '10.1/x' }
    ] };
    const { stats } = await resolvePublicationsInPool(pool, { openalex });
    assertEqual(openalex.calls.byDoi.length, 0);
    assertEqual(stats.attempted, 0);
    assertEqual(stats.total, 2);
  });

  test('enabled=true (resolvePreprint): arxiv papers attempted', async () => {
    const candidate = { doi: '10.1/x', title: 'T', authors: ['A'], year: 2020, journal: 'J' };
    const openalex = makeStubOpenalex({ byDoi: candidate });
    const pool = { papers: [
      { title: 'T', source: 'arxiv', arxiv_id: '2401.0', doi: '10.1/x' },
      { title: 'B', source: 'openalex' } // no preprint signal, not attempted
    ] };
    const { pool: out, stats } = await resolvePublicationsInPool(pool, {
      openalex, resolvePreprint: true
    });
    assertEqual(stats.attempted, 1);
    assertEqual(stats.resolvedPublished, 1);
    assertEqual(out.papers[0].publication_status, 'published');
  });

  test('stats.unknown counts non-published, non-preprint papers', async () => {
    const openalex = makeStubOpenalex();
    const pool = { papers: [
      { title: 'A', source: 'openalex' } // unknown: no DOI, no preprint
    ] };
    const { stats } = await resolvePublicationsInPool(pool, { openalex, resolvePreprint: true });
    assertEqual(stats.unknown, 1);
    assertEqual(stats.preprintOnly, 0);
    assertEqual(stats.resolvedPublished, 0);
  });

  test('stats.preprintOnly counts preprint papers with no formal match', async () => {
    const openalex = makeStubOpenalex({ searchResults: [] });
    const pool = { papers: [{ title: 'A', source: 'arxiv', arxiv_id: '2401.0' }] };
    const { stats } = await resolvePublicationsInPool(pool, { openalex, resolvePreprint: true });
    assertEqual(stats.preprintOnly, 1);
  });

  test('pool.metadata.publicationResolution is written', async () => {
    const openalex = makeStubOpenalex();
    const pool = { papers: [{ title: 't', source: 'openalex' }] };
    const { pool: out } = await resolvePublicationsInPool(pool, { openalex });
    assertOk(out.metadata.publicationResolution);
    assertEqual(out.metadata.publicationResolution.total, 1);
  });
});
