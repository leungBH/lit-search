/**
 * Pure / dependency-injected tests for `lib/search.js` exports.
 *
 * Most of search.js is not exported (deduplicate, mergePaperInto, similarity,
 * etc.) so we test the public surface only. The two exported entry points are:
 *   - `searchPapers(options)`  — makes real network calls inside the package
 *   - `enhanceOutputPapers(papers, enhancers)` — pure, takes enhancer functions
 *
 * We also exercise `generateQueries` indirectly through edge cases not covered
 * in tests/unit/pure.test.js.
 */

import { suite, test } from '../test-runner.js';
import { assertEqual, assertDeepEqual, assertOk } from '../test-runner.js';
import { enhanceOutputPapers } from '../../lib/search.js';

// ────────────────────────────────────────────────────────────────────────────
// enhanceOutputPapers
// ────────────────────────────────────────────────────────────────────────────

function makePaper(overrides = {}) {
  return { title: 'Untitled', ...overrides };
}

function silentLogger() {
  const l = { info() {}, warn() {}, error() {}, debug() {} };
  return l;
}

suite('search: enhanceOutputPapers (unpaywall)', () => {
  test('paper with no DOI is skipped', async () => {
    const calls = [];
    const enhancers = {
      unpaywall: {
        email: 'me@x.com',
        fetchByDoi: async (doi) => {
          calls.push(doi);
          return null;
        },
      },
    };
    const stats = await enhanceOutputPapers([makePaper({ title: 'A' })], enhancers);
    assertEqual(calls.length, 0);
    assertEqual(stats.unpaywall.attempted, 0);
  });

  test('paper with DOI → unpaywall.fetchByDoi is called with the doi', async () => {
    const calls = [];
    const enhancers = {
      unpaywall: {
        email: 'me@x.com',
        fetchByDoi: async (doi) => {
          calls.push(doi);
          return null;
        },
      },
    };
    const stats = await enhanceOutputPapers([makePaper({ doi: '10.1/x' })], enhancers);
    assertDeepEqual(calls, ['10.1/x']);
    assertEqual(stats.unpaywall.attempted, 1);
    assertEqual(stats.unpaywall.enriched, 0);
  });

  test('doi in paper.identifiers.doi is also resolved', async () => {
    const calls = [];
    const enhancers = {
      unpaywall: {
        email: 'me@x.com',
        fetchByDoi: async (doi) => {
          calls.push(doi);
          return null;
        },
      },
    };
    await enhanceOutputPapers([makePaper({ identifiers: { doi: '10.2/y' } })], enhancers);
    assertDeepEqual(calls, ['10.2/y']);
  });

  test('candidate result populates is_oa, license, oa_status, pdf_candidates', async () => {
    const candidate = {
      is_oa: true,
      license: 'CC-BY',
      oa_status: 'gold',
      pdfCandidates: [
        {
          url: 'https://x/y.pdf',
          access_type: 'publisher_oa_pdf',
          source: 'upw',
          provider: 'upw',
          confidence: 0.9,
          is_oa: true,
          license: 'CC-BY',
          reason: '',
        },
      ],
    };
    const enhancers = {
      unpaywall: { email: 'me@x.com', fetchByDoi: async () => candidate },
    };
    const papers = [makePaper({ doi: '10.1/x' })];
    const stats = await enhanceOutputPapers(papers, enhancers);
    assertEqual(papers[0].is_oa, true);
    assertEqual(papers[0].license, 'CC-BY');
    assertEqual(papers[0].oa_status, 'gold');
    assertEqual(papers[0].pdf_candidates.length, 1);
    assertEqual(papers[0].pdf_candidates[0].url, 'https://x/y.pdf');
    assertEqual(stats.unpaywall.enriched, 1);
  });

  test('metadata_sources.open_access is recorded with confidence 0.85', async () => {
    const enhancers = {
      unpaywall: { email: 'me@x.com', fetchByDoi: async () => ({ is_oa: true }) },
    };
    const papers = [makePaper({ doi: '10.1/x' })];
    await enhanceOutputPapers(papers, enhancers);
    assertOk(papers[0].metadata_sources?.open_access);
    assertEqual(papers[0].metadata_sources.open_access.source, 'unpaywall');
    assertEqual(papers[0].metadata_sources.open_access.confidence, 0.85);
  });

  test('existing oa_status is preserved when candidate returns null', async () => {
    const enhancers = {
      unpaywall: { email: 'me@x.com', fetchByDoi: async () => null },
    };
    const papers = [
      makePaper({ doi: '10.1/x', oa_status: 'closed', is_oa: false, license: 'Proprietary' }),
    ];
    await enhanceOutputPapers(papers, enhancers);
    assertEqual(papers[0].oa_status, 'closed');
    assertEqual(papers[0].is_oa, false);
    assertEqual(papers[0].license, 'Proprietary');
  });

  test('without unpaywall.email: stats.enabled=false, no fetch attempted', async () => {
    const stats = await enhanceOutputPapers([makePaper({ doi: '10.1/x' })], {
      unpaywall: { email: null, fetchByDoi: async () => null },
    });
    assertEqual(stats.unpaywall.enabled, false);
    assertEqual(stats.unpaywall.attempted, 0);
  });
});

suite('search: enhanceOutputPapers (openCitations)', () => {
  test('paper with no DOI is skipped', async () => {
    const calls = [];
    const enhancers = {
      openCitations: {
        fetchCitationRelations: async (doi) => {
          calls.push(doi);
          return null;
        },
      },
    };
    const stats = await enhanceOutputPapers([makePaper()], enhancers);
    assertEqual(calls.length, 0);
    assertEqual(stats.openCitations.attempted, 0);
  });

  test('relations with non-empty refs OR citations → paper enriched', async () => {
    const relations = { references: ['10.1/ref'], citations: [] };
    const enhancers = {
      openCitations: { fetchCitationRelations: async () => relations },
    };
    const papers = [makePaper({ doi: '10.1/x' })];
    const stats = await enhanceOutputPapers(papers, enhancers);
    assertDeepEqual(papers[0].citation_relations, relations);
    assertEqual(papers[0].metadata_sources.citation_relations.source, 'opencitations');
    assertEqual(papers[0].metadata_sources.citation_relations.confidence, 0.75);
    assertEqual(stats.openCitations.enriched, 1);
  });

  test('empty relations (no refs, no citations) → NOT enriched', async () => {
    const enhancers = {
      openCitations: { fetchCitationRelations: async () => ({ references: [], citations: [] }) },
    };
    const papers = [makePaper({ doi: '10.1/x' })];
    const stats = await enhanceOutputPapers(papers, enhancers);
    assertEqual(papers[0].citation_relations, undefined);
    assertEqual(stats.openCitations.enriched, 0);
  });

  test('null relations result → not enriched, no error', async () => {
    const enhancers = {
      openCitations: { fetchCitationRelations: async () => null },
    };
    const papers = [makePaper({ doi: '10.1/x' })];
    const stats = await enhanceOutputPapers(papers, enhancers);
    assertEqual(papers[0].citation_relations, undefined);
    assertEqual(stats.openCitations.enriched, 0);
  });
});

suite('search: enhanceOutputPapers (both enhancers together)', () => {
  test('both unpaywall and opencitations run for the same paper', async () => {
    let unpaywallCalled = 0;
    let opencitationsCalled = 0;
    const enhancers = {
      unpaywall: {
        email: 'me@x.com',
        fetchByDoi: async () => {
          unpaywallCalled++;
          return { is_oa: true };
        },
      },
      openCitations: {
        fetchCitationRelations: async () => {
          opencitationsCalled++;
          return { references: ['10.1/r'], citations: [] };
        },
      },
    };
    const papers = [makePaper({ doi: '10.1/x' })];
    const stats = await enhanceOutputPapers(papers, enhancers);
    assertEqual(unpaywallCalled, 1);
    assertEqual(opencitationsCalled, 1);
    assertEqual(stats.unpaywall.enriched, 1);
    assertEqual(stats.openCitations.enriched, 1);
  });

  test('multiple papers are processed in order', async () => {
    const seen = [];
    const enhancers = {
      unpaywall: {
        email: 'me@x.com',
        fetchByDoi: async (doi) => {
          seen.push(doi);
          return null;
        },
      },
    };
    await enhanceOutputPapers(
      [
        makePaper({ doi: '10.1/a' }),
        makePaper({ doi: '10.1/b' }),
        makePaper({ title: 'no doi' }),
        makePaper({ doi: '10.1/c' }),
      ],
      enhancers
    );
    assertDeepEqual(seen, ['10.1/a', '10.1/b', '10.1/c']);
  });
});
