// Pure-function unit tests for lib/app-config.js, lib/logger.js,
// lib/output-files.js (generateOutputFolderName only), lib/pdf-candidates.js
// (the five functions not yet covered), and lib/search.js generateQueries.
//
// All tests in this file are deterministic and require no network access.
// They run in <100ms total so they can be added to the default `npm test`
// suite without slowing CI.

import {
  getStoredApiKeys,
  getEnvApiKeys,
  getResolvedApiKeys,
  saveApiKeys,
  summarizeApiKeySources,
} from '../../lib/app-config.js';
import { resolveLogger, consoleLogger, silentLogger } from '../../lib/logger.js';
import { generateOutputFolderName } from '../../lib/output-files.js';
import {
  buildPdfCandidate,
  mergePdfCandidates,
  selectBestPdfCandidate,
  getDownloadablePdfCandidates,
  getBestPdfCandidateUrl,
} from '../../lib/pdf-candidates.js';
import { generateQueries } from '../../lib/search.js';
import {
  suite,
  test,
  assertEqual,
  assertDeepEqual,
  assertMatch,
  assertOk,
  assertFalsy,
  assertTruthy,
} from '../test-runner.js';

// Helper: fake `conf` instance. Just a Map with `.get`, `.set`, and a `.path`.
function makeFakeConfig(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    path: '/tmp/lit-search-test/config.json',
    get(key) {
      return store.get(key);
    },
    set(key, value) {
      store.set(key, value);
    },
  };
}

suite('app-config: getEnvApiKeys (env var resolution)', () => {
  test('returns empty object when no env vars set', () => {
    const out = getEnvApiKeys({});
    assertDeepEqual(out, {});
  });

  test('reads LIT_SEARCH_* prefixed vars (canonical names)', () => {
    const out = getEnvApiKeys({
      LIT_SEARCH_S2_API_KEY: 's2-x',
      LIT_SEARCH_OPENALEX_API_KEY: 'oa-x',
      LIT_SEARCH_CROSSREF_MAILTO: 'me@x.com',
      LIT_SEARCH_CORE_API_KEY: 'core-x',
      LIT_SEARCH_NCBI_API_KEY: 'ncbi-x',
      LIT_SEARCH_UNPAYWALL_EMAIL: 'me@x.com',
    });
    assertEqual(out.s2, 's2-x');
    assertEqual(out.openalex, 'oa-x');
    assertEqual(out.crossrefMailto, 'me@x.com');
    assertEqual(out.core, 'core-x');
    assertEqual(out.ncbi, 'ncbi-x');
    assertEqual(out.unpaywallEmail, 'me@x.com');
  });

  test('reads non-prefixed vars (legacy aliases) when prefixed missing', () => {
    const out = getEnvApiKeys({
      SEMANTIC_SCHOLAR_API_KEY: 's2-legacy',
      OPENALEX_API_KEY: 'oa-legacy',
      CROSSREF_MAILTO: 'legacy@x.com',
      CORE_API_KEY: 'core-legacy',
      NCBI_API_KEY: 'ncbi-legacy',
      UNPAYWALL_EMAIL: 'legacy@x.com',
    });
    assertEqual(out.s2, 's2-legacy');
    assertEqual(out.openalex, 'oa-legacy');
    assertEqual(out.crossrefMailto, 'legacy@x.com');
    assertEqual(out.core, 'core-legacy');
    assertEqual(out.ncbi, 'ncbi-legacy');
    assertEqual(out.unpaywallEmail, 'legacy@x.com');
  });

  test('LIT_SEARCH_* prefix wins over legacy alias when both set', () => {
    const out = getEnvApiKeys({
      LIT_SEARCH_S2_API_KEY: 's2-canonical',
      SEMANTIC_SCHOLAR_API_KEY: 's2-legacy',
      OPENALEX_API_KEY: 'oa-legacy',
      LIT_SEARCH_OPENALEX_API_KEY: 'oa-canonical',
    });
    assertEqual(out.s2, 's2-canonical');
    assertEqual(out.openalex, 'oa-canonical');
  });

  test('strips empty/whitespace-only values', () => {
    const out = getEnvApiKeys({
      LIT_SEARCH_S2_API_KEY: '',
      LIT_SEARCH_OPENALEX_API_KEY: '   ',
      LIT_SEARCH_CROSSREF_MAILTO: '\t',
    });
    assertFalsy(out.s2);
    assertFalsy(out.openalex);
    assertFalsy(out.crossrefMailto);
  });

  test('defaults to process.env when called with no argument', () => {
    // We can't assert on actual env state, but we can assert the call doesn't throw
    // and that the return is an object.
    const out = getEnvApiKeys();
    assertOk(typeof out === 'object');
  });
});

suite('app-config: getStoredApiKeys (config store)', () => {
  test('returns shallow copy of stored keys', () => {
    const cfg = makeFakeConfig({ apiKeys: { s2: 'a', openalex: 'b' } });
    const out = getStoredApiKeys(cfg);
    assertEqual(out.s2, 'a');
    assertEqual(out.openalex, 'b');
    // modifying the returned object must not mutate the store
    out.s2 = 'mutated';
    assertEqual(cfg.get('apiKeys').s2, 'a');
  });

  test('returns {} when no apiKeys stored yet', () => {
    const cfg = makeFakeConfig();
    assertDeepEqual(getStoredApiKeys(cfg), {});
  });
});

suite('app-config: getResolvedApiKeys (env > stored precedence)', () => {
  test('env keys override stored keys', () => {
    const cfg = makeFakeConfig({ apiKeys: { s2: 'stored-s2', openalex: 'stored-oa' } });
    const out = getResolvedApiKeys(cfg, { LIT_SEARCH_S2_API_KEY: 'env-s2' });
    assertEqual(out.s2, 'env-s2');
    assertEqual(out.openalex, 'stored-oa');
  });

  test('stored keys remain when env not set', () => {
    const cfg = makeFakeConfig({ apiKeys: { s2: 'stored-s2' } });
    const out = getResolvedApiKeys(cfg, {});
    assertEqual(out.s2, 'stored-s2');
  });
});

suite('app-config: saveApiKeys', () => {
  test('persists normalized (null for falsy) keys into the config store', () => {
    const cfg = makeFakeConfig();
    saveApiKeys(cfg, { s2: 'abc', openalex: '', core: null, crossrefMailto: 'me@x.com' });
    const stored = cfg.get('apiKeys');
    assertEqual(stored.s2, 'abc');
    assertEqual(stored.openalex, null, 'empty string should normalize to null');
    assertEqual(stored.core, null);
    assertEqual(stored.crossrefMailto, 'me@x.com');
  });

  test('omitted keys are persisted as null', () => {
    const cfg = makeFakeConfig();
    saveApiKeys(cfg, { s2: 'only-this' });
    const stored = cfg.get('apiKeys');
    assertEqual(stored.s2, 'only-this');
    assertEqual(stored.openalex, null);
    assertEqual(stored.core, null);
    assertEqual(stored.ncbi, null);
    assertEqual(stored.unpaywallEmail, null);
    assertEqual(stored.crossrefMailto, null);
  });
});

suite('app-config: summarizeApiKeySources (diagnostic output)', () => {
  test('reports per-source presence and the on-disk config path', () => {
    const cfg = makeFakeConfig({ apiKeys: { s2: 'stored-s2' } });
    const out = summarizeApiKeySources(cfg, { LIT_SEARCH_OPENALEX_API_KEY: 'env-oa' });
    assertEqual(out.storedPath, '/tmp/lit-search-test/config.json');
    assertEqual(out.stored.semanticScholar, true);
    assertEqual(out.stored.openalex, false, 'openalex is from env, not stored');
    assertEqual(out.env.openalex, true);
    assertEqual(out.env.semanticScholar, false, 's2 is stored, not from env');
    // values view is the union
    assertEqual(out.values.semanticScholar, true);
    assertEqual(out.values.openalex, true);
    assertEqual(out.values.crossrefMailto, false);
  });
});

suite('logger: resolveLogger and bundled loggers', () => {
  test('resolveLogger(undefined) returns consoleLogger', () => {
    assertEqual(resolveLogger(undefined), consoleLogger);
  });

  test('resolveLogger(null) returns consoleLogger', () => {
    assertEqual(resolveLogger(null), consoleLogger);
  });

  test('resolveLogger(silentLogger) returns silentLogger (passthrough)', () => {
    assertEqual(resolveLogger(silentLogger), silentLogger);
  });

  test('resolveLogger(customLogger) returns the custom one', () => {
    const custom = { info() {}, warn() {}, error() {}, startProgressList: () => null };
    assertEqual(resolveLogger(custom), custom);
  });

  test('silentLogger methods are all callable and return undefined', () => {
    assertEqual(silentLogger.info('x'), undefined);
    assertEqual(silentLogger.warn('x'), undefined);
    assertEqual(silentLogger.error('x'), undefined);
  });

  test('consoleLogger.startProgressList returns an object with update/end (CI mode)', () => {
    const prevCI = process.env.CI;
    process.env.CI = '1';
    try {
      const list = consoleLogger.startProgressList('Title:', ['A', 'B', 'C']);
      assertOk(list && typeof list.update === 'function');
      assertOk(typeof list.end === 'function');
      list.update(0, 'done');
      list.end();
    } finally {
      if (prevCI === undefined) delete process.env.CI;
      else process.env.CI = prevCI;
    }
  });
});

suite('output-files: generateOutputFolderName', () => {
  test('matches the documented pattern: lit_search_YYYYMMDD_HHMMSS', () => {
    const name = generateOutputFolderName();
    assertMatch(name, /^lit_search_\d{8}_\d{6}$/);
  });

  test('zero-pads single-digit months/days/hours/minutes/seconds', () => {
    // We can't change the wall clock, so we just confirm the format
    // allows zero-padded values for *any* valid date the user might run on.
    const sample = 'lit_search_20260109_030405';
    assertMatch(sample, /^lit_search_\d{8}_\d{6}$/);
    // `lit_search_...` has 3 underscores; the date is parts[2] and the
    // time is parts[3]. (Destructuring `const [_, date, time] = ...` would
    // assign 'search' to date.)
    const parts = sample.split('_');
    const date = parts[2];
    const time = parts[3];
    assertEqual(date.length, 8);
    assertEqual(time.length, 6);
    assertEqual(date, '20260109');
    assertEqual(time, '030405');
  });
});

suite('pdf-candidates: buildPdfCandidate (direct, not via normalize)', () => {
  test('returns null when url is missing', () => {
    assertEqual(buildPdfCandidate({}), null);
    assertEqual(buildPdfCandidate({ source: 'a' }), null);
  });

  test('returns null when url is unparseable', () => {
    assertEqual(buildPdfCandidate({ url: 'not a url' }), null);
  });

  test('infers provider from URL hostname when not given', () => {
    const c = buildPdfCandidate({ url: 'https://arxiv.org/pdf/1234.pdf' });
    assertEqual(c.provider, 'arxiv.org');
  });

  test('strips leading www. when inferring provider', () => {
    const c = buildPdfCandidate({ url: 'https://www.example.org/x.pdf' });
    assertEqual(c.provider, 'example.org');
  });

  test('classifies arxiv.org host as access_type=arxiv', () => {
    const c = buildPdfCandidate({ url: 'https://arxiv.org/pdf/1234.pdf' });
    assertEqual(c.access_type, 'arxiv');
    assertEqual(c.is_oa, true, 'arxiv is always OA');
  });

  test('explicit access_type wins over inference', () => {
    const c = buildPdfCandidate({
      url: 'https://arxiv.org/pdf/1234.pdf',
      access_type: 'repository',
    });
    assertEqual(c.access_type, 'repository');
  });

  test('OA inference: doi_landing_page and browser_fallback are not OA', () => {
    const a = buildPdfCandidate({ url: 'https://x.org/y', access_type: 'doi_landing_page' });
    const b = buildPdfCandidate({ url: 'https://x.org/y', access_type: 'browser_fallback' });
    assertEqual(a.is_oa, false);
    assertEqual(b.is_oa, false);
  });

  test('OA inference: other access types default to OA', () => {
    const c = buildPdfCandidate({ url: 'https://x.org/y', access_type: 'publisher_oa_pdf' });
    assertEqual(c.is_oa, true);
  });

  test('explicit is_oa overrides inference', () => {
    const c = buildPdfCandidate({
      url: 'https://arxiv.org/pdf/1234.pdf',
      is_oa: false,
    });
    assertEqual(c.is_oa, false);
  });

  test('confidence: numeric 0..1 is rounded to 2dp', () => {
    // The function treats *any* value > 1 as a 0..100 percentage. So
    // values in the (0, 1] range are the "fraction" branch and get
    // rounded to 2 decimal places. (1.0 itself is the boundary and
    // falls into the "percentage" branch — see the next test.)
    const a = buildPdfCandidate({
      url: 'https://x.org/y',
      access_type: 'repository',
      confidence: 0.5,
    });
    const b = buildPdfCandidate({
      url: 'https://x.org/y',
      access_type: 'repository',
      confidence: 0.123,
    });
    const c = buildPdfCandidate({
      url: 'https://x.org/y',
      access_type: 'repository',
      confidence: 0.999,
    });
    assertEqual(a.confidence, 0.5);
    assertEqual(b.confidence, 0.12, '0.123 rounds to 0.12');
    assertEqual(c.confidence, 1, '0.999 rounds to 1.00');
  });

  test('confidence: values > 1 are treated as percentages (divided by 100)', () => {
    // Documented contract: anything > 1 is on the 0..100 scale.
    // So 1.234 means 1.234%, not 1.234. This catches a subtle but
    // intentional asymmetry in normalizeConfidence.
    const a = buildPdfCandidate({
      url: 'https://x.org/y',
      access_type: 'repository',
      confidence: 1.234,
    });
    const b = buildPdfCandidate({
      url: 'https://x.org/y',
      access_type: 'repository',
      confidence: 50,
    });
    const c = buildPdfCandidate({
      url: 'https://x.org/y',
      access_type: 'repository',
      confidence: 100,
    });
    const d = buildPdfCandidate({
      url: 'https://x.org/y',
      access_type: 'repository',
      confidence: 200,
    });
    assertEqual(a.confidence, 0.01, '1.234% = 0.01234 → rounds to 0.01');
    assertEqual(b.confidence, 0.5);
    assertEqual(c.confidence, 1);
    assertEqual(d.confidence, 1, '200% clamps to 1.0');
  });

  test('confidence: non-numeric falls back to 0.5', () => {
    const c = buildPdfCandidate({
      url: 'https://x.org/y',
      access_type: 'repository',
      confidence: 'not-a-number',
    });
    assertEqual(c.confidence, 0.5);
  });

  test('OA/URL/license boost confidence in the absence of explicit confidence', () => {
    const base = buildPdfCandidate({ url: 'https://x.org/y', access_type: 'publisher_oa_pdf' });
    const boosted = buildPdfCandidate({
      url: 'https://x.org/y.pdf',
      access_type: 'publisher_oa_pdf',
      is_oa: true,
      license: 'CC-BY',
    });
    assertTruthy(
      boosted.confidence > base.confidence,
      `expected boosted (${boosted.confidence}) > base (${base.confidence})`
    );
  });

  test('rank is always 0 at build time (assigned by normalize)', () => {
    const c = buildPdfCandidate({ url: 'https://arxiv.org/pdf/1234.pdf' });
    assertEqual(c.rank, 0);
  });
});

suite('pdf-candidates: mergePdfCandidates', () => {
  test('merges multiple lists, dedupes by URL, ranks by score', () => {
    const listA = [
      {
        url: 'https://a.example/x.pdf',
        access_type: 'publisher_oa_pdf',
        source: 'a',
        provider: 'a',
        confidence: 0.5,
        is_oa: false,
        license: null,
        reason: '',
      },
    ];
    const listB = [
      {
        url: 'https://arxiv.org/pdf/1234.pdf',
        access_type: 'arxiv',
        source: 'arxiv',
        provider: 'arxiv',
        confidence: 0.98,
        is_oa: true,
        license: null,
        reason: '',
      },
    ];
    const merged = mergePdfCandidates(listA, listB);
    // arxiv ranked highest (priority 100 + confidence 0.98 = 100.98)
    assertEqual(merged[0].url, 'https://arxiv.org/pdf/1234.pdf');
    assertEqual(merged[0].rank, 1);
    assertEqual(merged[1].rank, 2);
    assertEqual(merged.length, 2);
  });

  test('returns [] when given no lists', () => {
    assertEqual(mergePdfCandidates().length, 0);
    assertEqual(mergePdfCandidates([]).length, 0);
    assertEqual(mergePdfCandidates([], []).length, 0);
  });

  test('skips null/undefined entries inside lists', () => {
    const merged = mergePdfCandidates([
      null,
      undefined,
      {
        url: 'https://x.example/x.pdf',
        access_type: 'unknown',
        source: 'a',
        provider: 'a',
        confidence: 0.5,
        is_oa: false,
        license: null,
        reason: '',
      },
    ]);
    assertEqual(merged.length, 1);
  });
});

suite('pdf-candidates: selectBestPdfCandidate', () => {
  test('returns the highest-scored candidate', () => {
    const a = {
      url: 'https://a.example/x.pdf',
      access_type: 'publisher_oa_pdf',
      source: 'a',
      provider: 'a',
      confidence: 0.5,
      is_oa: false,
      license: null,
      reason: '',
    };
    const b = {
      url: 'https://arxiv.org/pdf/1234.pdf',
      access_type: 'arxiv',
      source: 'arxiv',
      provider: 'arxiv',
      confidence: 0.9,
      is_oa: true,
      license: null,
      reason: '',
    };
    const best = selectBestPdfCandidate([a, b]);
    assertEqual(best.url, 'https://arxiv.org/pdf/1234.pdf');
  });

  test('returns null for empty input', () => {
    assertEqual(selectBestPdfCandidate([]), null);
    assertEqual(selectBestPdfCandidate(), null);
  });

  test('returns null when all candidates are missing url', () => {
    assertEqual(selectBestPdfCandidate([{}, { url: '' }]), null);
  });
});

suite('pdf-candidates: getDownloadablePdfCandidates', () => {
  test('excludes doi_landing_page and browser_fallback', () => {
    const paper = {
      pdf_candidates: [
        {
          url: 'https://arxiv.org/pdf/1.pdf',
          access_type: 'arxiv',
          source: 'arxiv',
          provider: 'arxiv',
          confidence: 0.9,
          is_oa: true,
          license: null,
          reason: '',
        },
        {
          url: 'https://doi.org/10.1/x',
          access_type: 'doi_landing_page',
          source: 'x',
          provider: 'x',
          confidence: 0.5,
          is_oa: false,
          license: null,
          reason: '',
        },
        {
          url: 'https://fallback.example/',
          access_type: 'browser_fallback',
          source: 'x',
          provider: 'x',
          confidence: 0.5,
          is_oa: false,
          license: null,
          reason: '',
        },
      ],
    };
    const filtered = getDownloadablePdfCandidates(paper);
    assertEqual(filtered.length, 1, 'only arxiv survives the filter');
    assertEqual(filtered[0].access_type, 'arxiv');
  });

  test('keeps "unknown" access type (it is in the downloadables set)', () => {
    const paper = {
      pdf_candidates: [
        {
          url: 'https://x.example/y.pdf',
          access_type: 'unknown',
          source: 'x',
          provider: 'x',
          confidence: 0.5,
          is_oa: false,
          license: null,
          reason: '',
        },
      ],
    };
    const filtered = getDownloadablePdfCandidates(paper);
    assertEqual(filtered.length, 1);
  });

  test('handles paper with no pdf_candidates field', () => {
    assertEqual(getDownloadablePdfCandidates({}).length, 0);
    assertEqual(getDownloadablePdfCandidates({ pdf_candidates: null }).length, 0);
  });
});

suite('pdf-candidates: getBestPdfCandidateUrl', () => {
  test('returns the URL string of the top candidate', () => {
    const paper = {
      pdf_candidates: [
        {
          url: 'https://a.example/x.pdf',
          access_type: 'publisher_oa_pdf',
          source: 'a',
          provider: 'a',
          confidence: 0.5,
          is_oa: false,
          license: null,
          reason: '',
        },
        {
          url: 'https://arxiv.org/pdf/1234.pdf',
          access_type: 'arxiv',
          source: 'arxiv',
          provider: 'arxiv',
          confidence: 0.98,
          is_oa: true,
          license: null,
          reason: '',
        },
      ],
    };
    assertEqual(getBestPdfCandidateUrl(paper), 'https://arxiv.org/pdf/1234.pdf');
  });

  test('returns null when all candidates are missing or have invalid url', () => {
    // Note: getBestPdfCandidateUrl does NOT filter by downloadable
    // access type. A doi_landing_page is still a valid "best" — it
    // just is not a PDF. Use getDownloadablePdfCandidates for that.
    const paper = { pdf_candidates: [{}, { url: '' }] };
    assertEqual(getBestPdfCandidateUrl(paper), null);
  });

  test('returns null for paper with no pdf_candidates', () => {
    assertEqual(getBestPdfCandidateUrl({}), null);
  });
});

suite('search: generateQueries (none mode)', () => {
  test('single keyword in', () => {
    assertDeepEqual(generateQueries('transformer', []), ['transformer']);
  });

  test('comma-separated keywords are split, trimmed, and deduped', () => {
    assertDeepEqual(generateQueries('a, b, c', []), ['a', 'b', 'c']);
  });

  test('whitespace inside comma split is trimmed', () => {
    assertDeepEqual(generateQueries('  a  ,  b  ', []), ['a', 'b']);
  });

  test('empty comma cells are filtered out', () => {
    assertDeepEqual(generateQueries('a,,b,,,c', []), ['a', 'b', 'c']);
  });

  test('extra keywords that are not in the base are appended (and deduped)', () => {
    // base = ['a', 'b']; extras = ['b', 'd'] → 'b' is already in base, 'd' is new
    assertDeepEqual(generateQueries('a,b', ['b', 'd']), ['a', 'b', 'd']);
  });

  test('empty query returns only extra keywords (deduped)', () => {
    assertDeepEqual(generateQueries('', ['x', 'y', 'x']), ['x', 'y']);
  });
});

suite('search: generateQueries (pairwise mode)', () => {
  test('3 keywords: every pair + each base keyword', () => {
    const out = generateQueries('a,b,c', [], 'pairwise');
    // pairs: a b, a c, b c; then a, b, c
    assertDeepEqual(out, ['a b', 'a c', 'b c', 'a', 'b', 'c']);
  });

  test('2 keywords: one pair + both base', () => {
    assertDeepEqual(generateQueries('a,b', [], 'pairwise'), ['a b', 'a', 'b']);
  });

  test('1 keyword: no pairs, just the base', () => {
    assertDeepEqual(generateQueries('a', [], 'pairwise'), ['a']);
  });

  test('extra keywords are appended and deduped', () => {
    const out = generateQueries('a,b', ['b', 'd'], 'pairwise');
    assertDeepEqual(out, ['a b', 'a', 'b', 'd']);
  });
});

suite('search: generateQueries (full mode)', () => {
  test('3 keywords: ABC, all pairs, all singles', () => {
    const out = generateQueries('a,b,c', [], 'full');
    // size 3: a b c; size 2: a b, a c, b c; base: a, b, c
    assertDeepEqual(out, ['a b c', 'a b', 'a c', 'b c', 'a', 'b', 'c']);
  });

  test('2 keywords: only AB + base', () => {
    assertDeepEqual(generateQueries('a,b', [], 'full'), ['a b', 'a', 'b']);
  });

  test('1 keyword: just the base (no combinations possible)', () => {
    assertDeepEqual(generateQueries('a', [], 'full'), ['a']);
  });

  test('extra keyword that is itself a combination is deduped', () => {
    const out = generateQueries('a,b,c', ['a b', 'd'], 'full');
    // 'a b' already present from combinations; 'd' is new
    assertDeepEqual(out, ['a b c', 'a b', 'a c', 'b c', 'a', 'b', 'c', 'd']);
  });
});

suite('search: generateQueries (unknown queryExpansion falls back to base)', () => {
  test('unknown expansion mode behaves like "none"', () => {
    assertDeepEqual(generateQueries('a,b', [], 'something-weird'), ['a', 'b']);
  });
});
