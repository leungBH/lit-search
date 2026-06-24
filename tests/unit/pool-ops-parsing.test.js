/**
 * Pure parsing tests for `lib/pool-ops.js`.
 *
 * The parsing helpers (parseCitations, extractDoi, extractTitle, extractYear)
 * are fully pure and exported. The merge logic is internal and only
 * reachable through `mergePools()` which reads from disk — that path is
 * covered by the e2e tests in tests/e2e/.
 */

import { suite, test } from '../test-runner.js';
import { assertEqual, assertDeepEqual, assertOk } from '../test-runner.js';
import {
  parseCitations,
  extractDoi,
  extractTitle,
  extractYear
} from '../../lib/pool-ops.js';

// ────────────────────────────────────────────────────────────────────────────
// extractDoi
// ────────────────────────────────────────────────────────────────────────────

suite('pool-ops: extractDoi', () => {
  test('bare DOI in text', () => {
    assertEqual(extractDoi('see 10.1145/3411764.3445105 for details'), '10.1145/3411764.3445105');
  });

  test('DOI with trailing punctuation is stripped', () => {
    assertEqual(extractDoi('paper (10.1234/abc).'), '10.1234/abc');
    assertEqual(extractDoi('paper 10.1234/abc,'), '10.1234/abc');
    assertEqual(extractDoi('paper 10.1234/abc;'), '10.1234/abc');
    assertEqual(extractDoi('paper 10.1234/abc)'), '10.1234/abc');
  });

  test('DOI inside quotes is extracted', () => {
    assertEqual(extractDoi('"https://doi.org/10.1234/abc"'), '10.1234/abc');
  });

  test('returns null when no DOI', () => {
    assertEqual(extractDoi('just a plain title'), null);
    assertEqual(extractDoi(''), null);
  });

  test('rejects too-short registrants (less than 4 digits)', () => {
    assertEqual(extractDoi('10.123/x'), null);
    assertEqual(extractDoi('10.1/x'), null);
  });

  test('rejects malformed prefixes (must start with 10.)', () => {
    assertEqual(extractDoi('11.1234/abc'), null);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// extractTitle
// ────────────────────────────────────────────────────────────────────────────

suite('pool-ops: extractTitle', () => {
  test('content inside straight double quotes wins over surrounding text', () => {
    assertEqual(extractTitle('Title: "Attention is all you need" (2017)'), 'Attention is all you need');
  });

  test('content inside smart quotes (curly) wins over surrounding text', () => {
    assertEqual(extractTitle('Title: "Attention is all you need" (2017)'), 'Attention is all you need');
  });

  test('inline DOI is stripped from bare title', () => {
    assertEqual(extractTitle('Some paper 10.1145/abc (2017)'), 'Some paper');
  });

  test('numbered prefix "N." is stripped', () => {
    assertEqual(extractTitle('1. Attention is all you need'), 'Attention is all you need');
    assertEqual(extractTitle('42. Some paper title'), 'Some paper title');
  });

  test('bracketed prefix "[N]" is stripped', () => {
    assertEqual(extractTitle('[3] Some paper title'), 'Some paper title');
  });

  test('year "(2017)" is stripped', () => {
    assertEqual(extractTitle('Attention is all you need (2017)'), 'Attention is all you need');
  });

  test('returns null for empty or whitespace-only', () => {
    assertEqual(extractTitle(''), null);
    assertEqual(extractTitle('   '), null);
    assertEqual(extractTitle('()'), null);
  });

  test('returns null when stripping leaves nothing', () => {
    assertEqual(extractTitle('2020'), null);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// extractYear
// ────────────────────────────────────────────────────────────────────────────

suite('pool-ops: extractYear', () => {
  test('extracts 4-digit year from text', () => {
    assertEqual(extractYear('Some title 2017'), 2017);
    assertEqual(extractYear('2017 Some title'), 2017);
  });

  test('returns the FIRST year when multiple are present', () => {
    assertEqual(extractYear('paper 1990 cited in 2020'), 1990);
  });

  test('returns null when no year', () => {
    assertEqual(extractYear('just a title'), null);
    assertEqual(extractYear(''), null);
  });

  test('rejects years outside 1900-2099 (parser scope)', () => {
    assertEqual(extractYear('paper from 1899'), null);
    assertEqual(extractYear('paper from 2100'), null);
  });

  test('accepts years at the boundary', () => {
    assertEqual(extractYear('paper from 1900'), 1900);
    assertEqual(extractYear('paper from 2099'), 2099);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// parseCitations
// ────────────────────────────────────────────────────────────────────────────

suite('pool-ops: parseCitations (bare titles, one per line)', () => {
  test('single bare title → 1 citation', () => {
    const out = parseCitations('Attention is all you need');
    assertEqual(out.length, 1);
    assertEqual(out[0].raw, 'Attention is all you need');
    assertEqual(out[0].doi, null);
    assertEqual(out[0].title, 'Attention is all you need');
    assertEqual(out[0].year, null);
  });

  test('each non-empty line is a citation', () => {
    const text = `Paper one
Paper two
Paper three`;
    const out = parseCitations(text);
    assertEqual(out.length, 3);
    assertEqual(out[0].title, 'Paper one');
    assertEqual(out[1].title, 'Paper two');
    assertEqual(out[2].title, 'Paper three');
  });

  test('empty lines are filtered', () => {
    const text = `Paper one

Paper two
   `;
    const out = parseCitations(text);
    assertEqual(out.length, 2);
  });

  test('BOM prefix is stripped', () => {
    const out = parseCitations('\uFEFFPaper one');
    assertEqual(out.length, 1);
    assertEqual(out[0].title, 'Paper one');
  });

  test('CRLF line endings are normalized', () => {
    const out = parseCitations('Paper one\r\nPaper two\r\n');
    assertEqual(out.length, 2);
  });

  test('each parsed citation retains its raw line', () => {
    const out = parseCitations('Some raw line text');
    assertEqual(out[0].raw, 'Some raw line text');
  });
});

suite('pool-ops: parseCitations (numbered and bracketed lists)', () => {
  test('numbered list "N. title" is split correctly', () => {
    const text = `1. First paper
2. Second paper
3. Third paper`;
    const out = parseCitations(text);
    assertEqual(out.length, 3);
    assertEqual(out[0].title, 'First paper');
    assertEqual(out[1].title, 'Second paper');
  });

  test('bracketed list "[N] title" is split correctly', () => {
    const text = `[1] First paper
[2] Second paper`;
    const out = parseCitations(text);
    assertEqual(out.length, 2);
    assertEqual(out[0].title, 'First paper');
  });

  test('mixed DOI + bare title in numbered mode', () => {
    const text = `1. 10.1145/abc
2. Bare title here
3. Another bare title with year 2020`;
    const out = parseCitations(text);
    assertEqual(out.length, 3);
    assertEqual(out[0].doi, '10.1145/abc');
    assertEqual(out[1].title, 'Bare title here');
    assertEqual(out[2].year, 2020);
  });
});

suite('pool-ops: parseCitations (BibTeX entries)', () => {
  test('single @article entry is recognized', () => {
    const text = `@article{vaswani2017,
  title = {Attention is all you need},
  author = {Vaswani, Ashish},
  year = {2017},
  doi = {10.48550/arxiv.1706.03762}
}`;
    const out = parseCitations(text);
    assertEqual(out.length, 1);
    assertEqual(out[0].doi, '10.48550/arxiv.1706.03762');
    assertEqual(out[0].title, 'Attention is all you need');
    assertEqual(out[0].year, 2017);
  });

  test('multiple BibTeX entries', () => {
    const text = `@article{a, title = {Paper A}, year = {2020}}
@inproceedings{b, title = {Paper B}, year = {2021}}`;
    const out = parseCitations(text);
    assertEqual(out.length, 2);
    assertEqual(out[0].title, 'Paper A');
    assertEqual(out[1].title, 'Paper B');
  });

  test('DOI is detected inside BibTeX even without explicit doi field', () => {
    const text = `@article{a, title = {X}, note = {see 10.1145/abc}}`;
    const out = parseCitations(text);
    assertEqual(out[0].doi, '10.1145/abc');
  });
});

suite('pool-ops: parseCitations (encoding & line endings)', () => {
  test('handles Windows CRLF in BibTeX', () => {
    const text = `@article{a,\r\n  title = {X},\r\n  year = {2020}\r\n}`;
    const out = parseCitations(text);
    assertEqual(out.length, 1);
    assertEqual(out[0].title, 'X');
  });

  test('handles old-Mac CR only', () => {
    const text = 'Paper one\rPaper two';
    const out = parseCitations(text);
    // CR is normalized to \n, so we get 2 entries
    assertEqual(out.length, 2);
  });

  test('handles mixed bare and quoted titles', () => {
    const text = `1. Bare title here
2. "Quoted title here"`;
    const out = parseCitations(text);
    assertEqual(out.length, 2);
    // Quoted title wins over surrounding text in extractTitle
    assertEqual(out[1].title, 'Quoted title here');
  });
});
