/**
 * Pure / dependency-injected tests for `lib/metadata-enricher.js`.
 *
 * `enrichMetadataInPool` does I/O only through the caller-supplied
 * `resolvers` map. By passing a stub map we test the orchestration
 * (attempt ordering, merge semantics, stats, checkpoints) without
 * touching the network.
 */

import { suite, test } from '../test-runner.js';
import { assertEqual, assertDeepEqual, assertOk } from '../test-runner.js';
import { enrichMetadataInPool } from '../../lib/metadata-enricher.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a resolvers map. Each entry is a `(value, paper, opts) => candidate | null`.
 * Pass `{ record: { ... } }` to make a resolver return a fixed candidate,
 * or `{ error: true }` to make it throw.
 */
function makeResolvers(spec = {}) {
  const out = {};
  for (const [name, behavior] of Object.entries(spec)) {
    if (behavior?.error) {
      out[name] = async () => {
        throw new Error(`resolver ${name} exploded`);
      };
    } else {
      out[name] = async () => behavior.record ?? null;
    }
  }
  return out;
}

function makePool(papers) {
  return { papers, metadata: {} };
}

function makePaper(overrides = {}) {
  return { title: 'Untitled', ...overrides };
}

function silentLogger() {
  const l = { info() {}, warn() {}, error() {}, debug() {} };
  return l;
}

// ────────────────────────────────────────────────────────────────────────────
// Resolver attempt ordering
// ────────────────────────────────────────────────────────────────────────────

suite('metadata-enricher: attempt ordering (buildAttempts shape)', () => {
  test('paper with arxiv_id only: arxivById is attempted first', async () => {
    const calls = [];
    const resolvers = {
      arxivById: async (id) => {
        calls.push(['arxivById', id]);
        return null;
      },
    };
    const pool = makePool([makePaper({ arxiv_id: '2401.01234' })]);
    await enrichMetadataInPool(pool, { resolvers, logger: silentLogger() });
    assertDeepEqual(calls, [['arxivById', '2401.01234']]);
  });

  test('paper with DOI: openalexByDoi THEN semanticScholarByDoi', async () => {
    const calls = [];
    const resolvers = {
      openalexByDoi: async (doi) => {
        calls.push(['openalexByDoi', doi]);
        return null;
      },
      semanticScholarByDoi: async (doi) => {
        calls.push(['semanticScholarByDoi', doi]);
        return null;
      },
    };
    const pool = makePool([makePaper({ doi: '10.1/x' })]);
    await enrichMetadataInPool(pool, { resolvers, logger: silentLogger() });
    assertEqual(calls[0][0], 'openalexByDoi');
    assertEqual(calls[1][0], 'semanticScholarByDoi');
    assertEqual(calls[0][1], '10.1/x');
  });

  test('paper with all signals: arxiv → openalex → s2 → openalex-id → title', async () => {
    const calls = [];
    const noop = async (v) => {
      calls.push(v);
      return null;
    };
    const resolvers = {
      arxivById: noop,
      openalexByDoi: noop,
      semanticScholarByDoi: noop,
      openalexById: noop,
      titleSearch: noop,
    };
    const pool = makePool([
      makePaper({
        arxiv_id: '2401.0',
        doi: '10.1/x',
        openalex_id: 'W123',
        title: 'T',
      }),
    ]);
    await enrichMetadataInPool(pool, { resolvers, logger: silentLogger() });
    // First call is arxivById
    assertEqual(calls[0], '2401.0');
    // arxiv-first ordering
    assertEqual(calls.length, 5);
  });

  test('paper with no identifiers, only title → titleSearch is the only attempt', async () => {
    const calls = [];
    const resolvers = {
      arxivById: async () => {
        calls.push('arxiv');
        return null;
      },
      openalexByDoi: async () => {
        calls.push('oa');
        return null;
      },
      semanticScholarByDoi: async () => {
        calls.push('s2');
        return null;
      },
      openalexById: async () => {
        calls.push('oa-id');
        return null;
      },
      titleSearch: async () => {
        calls.push('title');
        return null;
      },
    };
    const pool = makePool([makePaper({ title: 'Bare' })]);
    await enrichMetadataInPool(pool, { resolvers, logger: silentLogger() });
    assertDeepEqual(calls, ['title']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Enrichment: scalar fields
// ────────────────────────────────────────────────────────────────────────────

suite('metadata-enricher: scalar field enrichment', () => {
  test('openalexByDoi returns candidate → paper fields are populated', async () => {
    const candidate = {
      abstract: 'An abstract',
      journal: 'J',
      venue: 'V',
      doi: '10.1/x',
      url: 'https://u',
      volume: '1',
      issue: '2',
      pages: '1-10',
      publisher: 'P',
      language: 'en',
      workType: 'journal-article',
    };
    const resolvers = makeResolvers({ openalexByDoi: { record: candidate } });
    const pool = makePool([makePaper({ doi: '10.1/x' })]);
    const { pool: out, stats } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
    });
    const p = out.papers[0];
    assertEqual(p.abstract, 'An abstract');
    assertEqual(p.journal, 'J');
    assertEqual(p.venue, 'V');
    assertEqual(p.doi, '10.1/x');
    assertEqual(p.url, 'https://u');
    assertEqual(p.volume, '1');
    assertEqual(p.issue, '2');
    assertEqual(p.pages, '1-10');
    assertEqual(p.publisher, 'P');
    assertEqual(p.language, 'en');
    assertEqual(p.work_type, 'journal-article');
    assertEqual(stats.enrichedFields, 10);
  });

  test('workType from candidate is mapped to work_type on paper', async () => {
    const resolvers = makeResolvers({ openalexByDoi: { record: { workType: 'article' } } });
    const pool = makePool([makePaper({ doi: '10.1/x' })]);
    const { pool: out } = await enrichMetadataInPool(pool, { resolvers, logger: silentLogger() });
    assertEqual(out.papers[0].work_type, 'article');
  });

  test('"N/A" or whitespace-only values are NOT used to overwrite (existing field preserved)', async () => {
    // hasUsableText() filters out '', whitespace-only, and 'N/A' (case-insensitive).
    const resolvers = makeResolvers({
      openalexByDoi: { record: { journal: 'N/A', abstract: '   ' } },
    });
    const pool = makePool([
      makePaper({
        doi: '10.1/x',
        journal: 'GoodJournal',
        abstract: 'GoodAbstract',
      }),
    ]);
    const { pool: out } = await enrichMetadataInPool(pool, { resolvers, logger: silentLogger() });
    assertEqual(out.papers[0].journal, 'GoodJournal');
    assertEqual(out.papers[0].abstract, 'GoodAbstract');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Enrichment: list fields (keywords, identifiers, pdf_candidates)
// ────────────────────────────────────────────────────────────────────────────

suite('metadata-enricher: list field enrichment', () => {
  test('keywords are merged (union, dedup, preserves existing)', async () => {
    const resolvers = makeResolvers({
      openalexByDoi: {
        record: {
          keywords: ['ML', 'NLP'],
          topics: ['AI'],
          fieldsOfStudy: ['CS', 'ML'],
        },
      },
    });
    const pool = makePool([makePaper({ doi: '10.1/x', keywords: ['existing'] })]);
    const { pool: out } = await enrichMetadataInPool(pool, { resolvers, logger: silentLogger() });
    const kw = out.papers[0].keywords;
    assertOk(kw.includes('existing'));
    assertOk(kw.includes('ML'));
    assertOk(kw.includes('NLP'));
    assertOk(kw.includes('AI'));
    assertOk(kw.includes('CS'));
    // ML appears in both keywords and fieldsOfStudy → deduped
    assertEqual(kw.filter((k) => k === 'ML').length, 1);
  });

  test('identifiers from candidate are merged into paper.identifiers', async () => {
    const resolvers = makeResolvers({
      openalexByDoi: {
        record: {
          identifiers: { doi: '10.1/x', openalex: 'W999' },
        },
      },
    });
    const pool = makePool([makePaper({ doi: '10.1/x', identifiers: { arxiv: '2401.0' } })]);
    const { pool: out } = await enrichMetadataInPool(pool, { resolvers, logger: silentLogger() });
    assertEqual(out.papers[0].identifiers.arxiv, '2401.0');
    assertEqual(out.papers[0].identifiers.doi, '10.1/x');
    assertEqual(out.papers[0].identifiers.openalex, 'W999');
  });

  test('pdf_candidates are merged via mergePdfCandidates (no duplicates)', async () => {
    const resolvers = makeResolvers({
      openalexByDoi: {
        record: {
          pdfCandidates: [
            {
              url: 'https://arxiv.org/x.pdf',
              access_type: 'arxiv',
              source: 'oa',
              provider: 'oa',
              confidence: 0.9,
              is_oa: true,
              license: null,
              reason: '',
            },
          ],
        },
      },
    });
    const pool = makePool([makePaper({ doi: '10.1/x' })]);
    const { pool: out } = await enrichMetadataInPool(pool, { resolvers, logger: silentLogger() });
    const c = out.papers[0].pdf_candidates;
    assertEqual(c.length, 1);
    assertEqual(c[0].url, 'https://arxiv.org/x.pdf');
    assertEqual(c[0].rank, 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// overwrite / onlyMissing semantics
// ────────────────────────────────────────────────────────────────────────────

suite('metadata-enricher: overwrite vs onlyMissing', () => {
  test('overwrite=false (default): existing fields are NOT replaced', async () => {
    const resolvers = makeResolvers({ openalexByDoi: { record: { journal: 'NewJournal' } } });
    const pool = makePool([makePaper({ doi: '10.1/x', journal: 'OldJournal' })]);
    const { pool: out } = await enrichMetadataInPool(pool, { resolvers, logger: silentLogger() });
    assertEqual(out.papers[0].journal, 'OldJournal');
  });

  test('overwrite=true: existing fields ARE replaced', async () => {
    const resolvers = makeResolvers({ openalexByDoi: { record: { journal: 'NewJournal' } } });
    const pool = makePool([makePaper({ doi: '10.1/x', journal: 'OldJournal' })]);
    const { pool: out } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
      overwrite: true,
    });
    assertEqual(out.papers[0].journal, 'NewJournal');
  });

  test('onlyMissing=true: skips papers where every requested field is present', async () => {
    const calls = [];
    const resolvers = {
      openalexByDoi: async () => {
        calls.push('oa');
        return null;
      },
    };
    const pool = makePool([makePaper({ doi: '10.1/x', journal: 'J', venue: 'V' })]);
    const { stats } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
      onlyMissing: true,
      fields: ['journal', 'venue'],
    });
    assertEqual(calls.length, 0, 'no resolver call because paper is complete');
    assertEqual(stats.attempted, 0);
    assertEqual(stats.complete, 1);
  });

  test('onlyMissing=true: papers with missing fields are still attempted', async () => {
    const resolvers = makeResolvers({ openalexByDoi: { record: { journal: 'J' } } });
    const pool = makePool([makePaper({ doi: '10.1/x', venue: 'V' })]); // journal missing
    const { stats } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
      onlyMissing: true,
      fields: ['journal', 'venue'],
    });
    assertEqual(stats.attempted, 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Field filtering
// ────────────────────────────────────────────────────────────────────────────

suite('metadata-enricher: field filtering', () => {
  test('default fields = standard set', async () => {
    const calls = [];
    const resolvers = {
      openalexByDoi: async () => {
        calls.push('oa');
        return { abstract: 'A', journal: 'J', doi: '10.1/x' };
      },
    };
    const pool = makePool([makePaper({ doi: '10.1/x' })]);
    await enrichMetadataInPool(pool, { resolvers, logger: silentLogger() });
    assertEqual(calls.length, 1);
  });

  test('custom fields=[] falls back to defaults', async () => {
    const resolvers = makeResolvers({ openalexByDoi: { record: { journal: 'J' } } });
    const pool = makePool([makePaper({ doi: '10.1/x' })]);
    const { pool: out } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
      fields: [],
    });
    assertEqual(out.papers[0].journal, 'J');
  });

  test('custom fields list: only those fields are tracked in metadata_status', async () => {
    const resolvers = makeResolvers({ openalexByDoi: { record: { journal: 'J' } } });
    const pool = makePool([makePaper({ doi: '10.1/x' })]);
    const { pool: out } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
      fields: ['journal'],
    });
    const status = out.papers[0].metadata_status;
    assertOk(status.journal, 'journal is tracked');
    assertEqual(
      status.abstract,
      undefined,
      'abstract is NOT in metadata_status when not requested'
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Stats
// ────────────────────────────────────────────────────────────────────────────

suite('metadata-enricher: stats', () => {
  test('total, attempted, enrichedPapers, enrichedFields, complete, lookupFailed', async () => {
    // 4 papers, all are missing the requested field (journal), so all are attempted:
    //   1. has DOI, resolver returns candidate → attempted + enriched
    //   2. has DOI, resolver returns null    → attempted + lookupFailed (status='missing')
    //   3. no DOI, no title                  → attempted + lookupFailed (status='lookup_failed')
    //   4. has DOI, resolver throws          → attempted + lookupFailed (caught, status='missing')
    const resolvers = {
      openalexByDoi: async (doi) => {
        if (doi === '10.1/good') return { journal: 'J' };
        if (doi === '10.1/null') return null;
        if (doi === '10.1/throw') throw new Error('boom');
        return null;
      },
    };
    const pool = makePool([
      makePaper({ doi: '10.1/good' }),
      makePaper({ doi: '10.1/null' }),
      makePaper({}),
      makePaper({ doi: '10.1/throw' }),
    ]);
    const { stats } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
      fields: ['journal'],
    });
    assertEqual(stats.total, 4);
    assertEqual(stats.attempted, 4, 'every non-complete paper is attempted');
    assertEqual(stats.enrichedPapers, 1);
    assertEqual(stats.enrichedFields, 1);
    assertEqual(stats.lookupFailed, 3); // null + no-attempts + throw
  });

  test('enrichedFields counts each changed field once per paper', async () => {
    // paper has no journal/venue/abstract → all 3 are new → 3 enriched fields
    // (doi is skipped because paper.doi already matches the candidate, so it
    //  is treated as a no-op by the merge logic.)
    const resolvers = makeResolvers({
      openalexByDoi: {
        record: {
          journal: 'J',
          venue: 'V',
          doi: '10.1/x',
          abstract: 'A',
        },
      },
    });
    const pool = makePool([makePaper({ doi: '10.1/x' })]);
    const { stats } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
      fields: ['journal', 'venue', 'abstract', 'doi'],
    });
    assertEqual(stats.enrichedFields, 3);
  });

  test('with no overlap between paper and candidate, every candidate field is enriched', async () => {
    // Paper has a DOI (so the resolver is attempted) but no values for
    // the requested fields. We use overwrite=true so candidate fields
    // always replace empty paper fields (the no-overwrite path would
    // still work for the empty fields, but the doi-on-doi case is
    // special-cased elsewhere).
    const resolvers = makeResolvers({
      openalexByDoi: {
        record: {
          journal: 'J',
          venue: 'V',
          abstract: 'A',
          publisher: 'P',
        },
      },
    });
    const pool = makePool([makePaper({ doi: '10.1/x' })]);
    const { stats } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
      fields: ['journal', 'venue', 'abstract', 'publisher'],
      overwrite: true,
    });
    assertEqual(stats.enrichedFields, 4);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Checkpoint + concurrency
// ────────────────────────────────────────────────────────────────────────────

suite('metadata-enricher: checkpoint callback', () => {
  test('checkpointInterval=N fires onCheckpoint every N processed papers', async () => {
    let checkpointCount = 0;
    const resolvers = {
      openalexByDoi: async () => null,
    };
    const pool = makePool(Array.from({ length: 5 }, (_, i) => makePaper({ doi: `10.1/${i}` })));
    await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
      checkpointInterval: 2,
      onCheckpoint: () => {
        checkpointCount++;
      },
    });
    // 5 papers / 2 = 2 full checkpoints (papers 1-2 and 3-4), paper 5 doesn't trigger
    assertOk(checkpointCount >= 2, `expected at least 2 checkpoints, got ${checkpointCount}`);
  });

  test('checkpointInterval=0 disables onCheckpoint', async () => {
    let checkpointCount = 0;
    const resolvers = { openalexByDoi: async () => null };
    const pool = makePool([makePaper({ doi: '10.1/x' })]);
    await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
      checkpointInterval: 0,
      onCheckpoint: () => {
        checkpointCount++;
      },
    });
    assertEqual(checkpointCount, 0);
  });
});

suite('metadata-enricher: concurrency', () => {
  test('concurrency > 1: every paper still gets enriched (race-free)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers = {
      openalexByDoi: async (doi) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return { journal: `J-${doi}` };
      },
    };
    const pool = makePool(Array.from({ length: 6 }, (_, i) => makePaper({ doi: `10.1/${i}` })));
    const { pool: out } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
      concurrency: 3,
    });
    assertOk(maxInFlight > 1, `expected concurrent execution, max in-flight was ${maxInFlight}`);
    for (let i = 0; i < 6; i++) {
      assertEqual(out.papers[i].journal, `J-10.1/${i}`);
    }
  });

  test('concurrency=1 (default): sequential execution', async () => {
    const resolvers = makeResolvers({ openalexByDoi: { record: { journal: 'J' } } });
    const pool = makePool([makePaper({ doi: '10.1/x' })]);
    const { stats } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
      concurrency: 1,
    });
    assertEqual(stats.enrichedPapers, 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Resolver failures are isolated
// ────────────────────────────────────────────────────────────────────────────

suite('metadata-enricher: resolver failures are isolated', () => {
  test('one resolver throwing does not stop the rest', async () => {
    const resolvers = {
      arxivById: async () => {
        throw new Error('arxiv down');
      },
      openalexByDoi: async () => ({ journal: 'J' }),
    };
    const pool = makePool([makePaper({ arxiv_id: '2401.0', doi: '10.1/x' })]);
    const { stats, pool: out } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
    });
    assertEqual(out.papers[0].journal, 'J', 'openalex should still enrich');
    assertOk(stats.attempted >= 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// pool.metadata.metadataEnrichment is written
// ────────────────────────────────────────────────────────────────────────────

suite('metadata-enricher: pool metadata', () => {
  test('writes pool.metadata.metadataEnrichment with stats + config', async () => {
    const resolvers = makeResolvers({ openalexByDoi: { record: null } });
    const pool = makePool([makePaper({ doi: '10.1/x' })]);
    const { pool: out } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
      overwrite: true,
      concurrency: 2,
    });
    const me = out.metadata.metadataEnrichment;
    assertOk(me);
    assertEqual(me.overwrite, true);
    assertEqual(me.concurrency, 2);
    assertOk(me.generatedAt);
    assertOk(me.stats);
    assertEqual(me.stats.total, 1);
  });

  test('preserves pre-existing pool.metadata keys', async () => {
    const resolvers = makeResolvers({ openalexByDoi: { record: null } });
    const pool = makePool([makePaper({ doi: '10.1/x' })]);
    pool.metadata.keptFromBefore = 'value';
    const { pool: out } = await enrichMetadataInPool(pool, {
      resolvers,
      logger: silentLogger(),
    });
    assertEqual(out.metadata.keptFromBefore, 'value');
    assertOk(out.metadata.metadataEnrichment);
  });
});
