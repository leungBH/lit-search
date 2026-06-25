// Unit tests for resolve-citation parser.
// This is the regression suite for the v1.4 bugs where:
//   - 114-line citation files collapsed into 1 unresolved record
//   - bare titles returned all-null fields
// Every test here must run in <100ms and not require network.

import { parseCitations, extractDoi, extractTitle, extractYear } from '../../lib/pool-ops.js';
import {
  suite,
  test,
  assertEqual,
  assertTruthy,
  assertFalsy,
  assertOk,
  assertMatch,
} from '../test-runner.js';

suite('resolve-citation parser: one-citation-per-line (regression: v1.4 bug)', () => {
  test('single bare title is parsed as exactly 1 citation', () => {
    const result = parseCitations('Attention Is All You Need');
    assertEqual(result.length, 1);
    assertEqual(result[0].title, 'Attention Is All You Need');
    assertEqual(result[0].raw, 'Attention Is All You Need');
    assertEqual(result[0].doi, null);
    assertEqual(result[0].year, null);
  });

  test('114-line file parses as exactly 114 citations (regression: was 1)', () => {
    const lines = Array.from({ length: 114 }, (_, i) => `Paper Title Number ${i}`);
    const result = parseCitations(lines.join('\n'));
    assertEqual(result.length, 114);
    assertEqual(result[0].title, 'Paper Title Number 0');
    assertEqual(result[113].title, 'Paper Title Number 113');
    assertEqual(result[113].raw, 'Paper Title Number 113');
  });

  test('each parsed citation retains its raw line (regression: was null)', () => {
    const result = parseCitations('Attention Is All You Need\nBERT Pre-training');
    assertEqual(result.length, 2);
    assertTruthy(result[0].raw && result[0].raw.length > 0, 'raw should not be null');
    assertTruthy(result[1].raw && result[1].raw.length > 0, 'raw should not be null');
    assertMatch(result[0].raw, 'Attention');
    assertMatch(result[1].raw, 'BERT');
  });

  test('Windows CRLF line endings are normalized', () => {
    const result = parseCitations('Attention Is All You Need\r\nBERT Pre-training\r\n');
    assertEqual(result.length, 2);
  });

  test('BOM prefix is stripped', () => {
    const result = parseCitations('\uFEFFAttention Is All You Need\nBERT Pre-training\n');
    assertEqual(result.length, 2);
    assertEqual(result[0].title, 'Attention Is All You Need');
  });

  test('empty lines are filtered', () => {
    const result = parseCitations('Title One\n\n\nTitle Two\n\n');
    assertEqual(result.length, 2);
  });

  test('trailing whitespace is trimmed', () => {
    const result = parseCitations('  Title One  \n  Title Two  \n');
    assertEqual(result.length, 2);
    assertEqual(result[0].title, 'Title One');
  });

  test('1-line file and 114-line file produce proportional counts', () => {
    const one = parseCitations('Title A');
    const many = parseCitations(Array.from({ length: 114 }, (_, i) => `Title ${i}`).join('\n'));
    assertEqual(one.length, 1);
    assertEqual(many.length, 114);
  });
});

suite('resolve-citation parser: numbered and bracketed lists', () => {
  test('numbered list "N. title"', () => {
    const result = parseCitations('1. Attention Is All You Need\n2. BERT Pre-training');
    assertEqual(result.length, 2);
    assertEqual(result[0].title, 'Attention Is All You Need');
    assertEqual(result[1].title, 'BERT Pre-training');
  });

  test('bracketed list "[N] title"', () => {
    const result = parseCitations('[1] Attention Is All You Need\n[2] BERT Pre-training');
    assertEqual(result.length, 2);
    assertEqual(result[0].title, 'Attention Is All You Need');
  });

  test('numbered-mode requires every chunk to start with a marker (documented contract)', () => {
    // When numbered markers are present, plain lines are merged into the preceding chunk.
    // This is the documented contract: if your file uses "1." / "[1]" markers,
    // every citation must start with one. Mixed mode is not supported.
    const result = parseCitations('1. First\nplain title\n2. Second');
    assertEqual(result.length, 2);
    assertEqual(result[0].title, 'First plain title');
    assertEqual(result[1].title, 'Second');
  });

  test('regression: DOI like "10.1145/..." is NOT treated as numbered marker', () => {
    const result = parseCitations('10.1145/3292500.3330701\n10.1145/3458824.3460001');
    assertEqual(result.length, 2);
    assertEqual(result[0].doi, '10.1145/3292500.3330701');
    assertEqual(result[1].doi, '10.1145/3458824.3460001');
    assertEqual(result[0].title, null);
  });

  test('mixed DOI + bare title keeps 2 entries', () => {
    const result = parseCitations('10.1145/3292500.3330701\nAttention Is All You Need');
    assertEqual(result.length, 2);
    assertTruthy(result[0].doi, 'first should be a DOI');
    assertEqual(result[1].title, 'Attention Is All You Need');
  });
});

suite('resolve-citation parser: BibTeX entries', () => {
  test('single @article entry', () => {
    const bib =
      '@article{vaswani2017attention,\n  title={Attention Is All You Need},\n  author={Vaswani, Ashish},\n  year={2017}\n}';
    const result = parseCitations(bib);
    assertEqual(result.length, 1);
    assertEqual(result[0].title, 'Attention Is All You Need');
    assertEqual(result[0].year, 2017);
  });

  test('multiple @article entries', () => {
    const bib = `@article{a2017, title={Paper A}, year={2017}}\n@article{b2019, title={Paper B}, year={2019}}`;
    const result = parseCitations(bib);
    assertEqual(result.length, 2);
    assertEqual(result[0].title, 'Paper A');
    assertEqual(result[1].title, 'Paper B');
  });

  test('@misc and @inproceedings both recognized', () => {
    const bib = `@misc{arxiv1, title={Arxiv Paper}, year={2020}}\n@inproceedings{conf1, title={Conf Paper}, year={2021}}`;
    const result = parseCitations(bib);
    assertEqual(result.length, 2);
  });

  test('DOI in BibTeX is extracted', () => {
    const bib = '@article{x, title={X}, year={2020}, doi={10.1145/1234567}}';
    const result = parseCitations(bib);
    assertEqual(result.length, 1);
    assertEqual(result[0].doi, '10.1145/1234567');
  });
});

suite('resolve-citation parser: extractTitle (regression: returned null for bare titles)', () => {
  test('returns title for bare text', () => {
    assertEqual(extractTitle('Attention Is All You Need'), 'Attention Is All You Need');
  });

  test('returns content inside straight double quotes', () => {
    assertEqual(extractTitle('"Attention Is All You Need"'), 'Attention Is All You Need');
  });

  test('returns content inside smart quotes', () => {
    assertEqual(extractTitle('\u201CAttention Is All You Need\u201D'), 'Attention Is All You Need');
  });

  test('strips year from "Title (2017)"', () => {
    assertEqual(extractTitle('Attention Is All You Need (2017)'), 'Attention Is All You Need');
  });

  test('strips numbered prefix', () => {
    assertEqual(extractTitle('1. Attention Is All You Need'), 'Attention Is All You Need');
  });

  test('strips bracketed prefix', () => {
    assertEqual(extractTitle('[1] Attention Is All You Need'), 'Attention Is All You Need');
  });

  test('strips inline DOI', () => {
    assertEqual(
      extractTitle('10.1145/3292500.3330701 Attention Is All You Need'),
      'Attention Is All You Need'
    );
  });

  test('returns null for whitespace-only input', () => {
    assertEqual(extractTitle('   \n  \t'), null);
  });

  test('returns null for empty input', () => {
    assertEqual(extractTitle(''), null);
  });

  test('year-like "2020" alone is not a title', () => {
    assertEqual(extractTitle('2020'), null);
  });
});

suite('resolve-citation parser: extractDoi', () => {
  test('extracts bare DOI', () => {
    assertEqual(extractDoi('10.1145/3292500.3330701'), '10.1145/3292500.3330701');
  });

  test('extracts DOI surrounded by whitespace', () => {
    assertEqual(extractDoi('  10.1145/3292500.3330701  '), '10.1145/3292500.3330701');
  });

  test('extracts DOI and strips trailing punctuation', () => {
    assertEqual(extractDoi('See 10.1145/3292500.3330701.'), '10.1145/3292500.3330701');
    assertEqual(extractDoi('See 10.1145/3292500.3330701,'), '10.1145/3292500.3330701');
    assertEqual(extractDoi('See 10.1145/3292500.3330701)'), '10.1145/3292500.3330701');
  });

  test('returns null when no DOI present', () => {
    assertEqual(extractDoi('Attention Is All You Need'), null);
  });

  test('returns null for DOI-like but invalid (too short registrant)', () => {
    assertEqual(extractDoi('10.1/abc'), null);
  });
});

suite('resolve-citation parser: extractYear', () => {
  test('extracts 4-digit year', () => {
    assertEqual(extractYear('Attention Is All You Need 2017'), 2017);
  });

  test('extracts year in parentheses', () => {
    assertEqual(extractYear('Attention Is All You Need (2017)'), 2017);
  });

  test('returns first year when multiple', () => {
    assertEqual(extractYear('Title 2017, 2018, 2019'), 2017);
  });

  test('returns null when no year', () => {
    assertEqual(extractYear('Attention Is All You Need'), null);
  });

  test('rejects 1900-ish or 21xx like 1899, 2100', () => {
    assertEqual(extractYear('Title 1899'), null);
    assertEqual(extractYear('Title 2100'), null);
  });
});

suite('resolve-citation parser: output shape contract', () => {
  test('every parsed citation has {raw, doi, title, year} shape', () => {
    const result = parseCitations('10.1145/foo\n"Title X"\nPlain Title\nSecond Plain Title');
    assertEqual(result.length, 4);
    for (const c of result) {
      assertOk(typeof c === 'object', 'citation should be an object');
      assertOk('raw' in c, 'must have raw');
      assertOk('doi' in c, 'must have doi');
      assertOk('title' in c, 'must have title');
      assertOk('year' in c, 'must have year');
      assertOk(typeof c.raw === 'string' && c.raw.length > 0, 'raw must be a non-empty string');
    }
  });

  test('regression: no citation should have all-null fields', () => {
    // The original v1.4 bug: 114 input lines → 1 unresolved record with all-null fields.
    // After fix, every line should at minimum have a title or doi or year.
    const result = parseCitations('10.1145/foo\n"Title X"\nPlain Title\nSecond Plain Title');
    for (const c of result) {
      const hasAny = c.doi || c.title || c.year;
      assertTruthy(hasAny, `citation should not be all-null: ${JSON.stringify(c)}`);
    }
  });
});
