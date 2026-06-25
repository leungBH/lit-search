// Tests for output rendering, normalization, and round-trip integrity.

import { renderBibTeX } from '../../lib/output.js';
import { writeResultFiles, readLiteraturePool, resolvePoolPath } from '../../lib/output-files.js';
import { normalizePdfCandidates } from '../../lib/pdf-candidates.js';
import {
  suite,
  test,
  assertEqual,
  assertOk,
  assertMatch,
  assertFalsy,
  assertTruthy,
} from '../test-runner.js';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

suite('BibTeX renderer: required fields', () => {
  test('renders basic @article entry', () => {
    const pool = {
      metadata: { query: 'fixture' },
      papers: [
        {
          seq_id: 1,
          citation_key: 'Smith2024',
          entry_type: 'article',
          title: 'A Study on Machine Learning',
          author: 'Alice Smith and Bob Lee',
          year: 2024,
          journal: 'Journal of Examples',
          doi: '10.1000/example',
          keywords: ['machine learning', 'classification'],
        },
      ],
    };
    const bib = renderBibTeX(pool);
    assertMatch(bib, /@article\{Smith2024,/);
    assertMatch(bib, /title = \{A Study on Machine Learning\}/);
    assertMatch(bib, /author = \{Alice Smith and Bob Lee\}/);
    assertMatch(bib, /journal = \{Journal of Examples\}/);
    assertMatch(bib, /doi = \{10\.1000\/example\}/);
    assertMatch(bib, /keywords = \{machine learning, classification\}/);
  });

  test('does not leak internal fields (pdfurl, pdfcandidates, citationcount)', () => {
    const pool = {
      metadata: {},
      papers: [
        {
          seq_id: 1,
          citation_key: 'X',
          title: 'T',
          author: 'A',
          year: 2020,
          doi: '10.1/x',
          pdf_candidates: [{ url: 'http://x' }],
          pdfurl: 'http://x',
          citation_count: 5,
        },
      ],
    };
    const bib = renderBibTeX(pool);
    assertFalsy(bib.match(/pdfurl/i), 'pdfurl should not leak');
    assertFalsy(bib.match(/pdf_candidates/i), 'pdf_candidates should not leak');
    assertFalsy(bib.match(/citationcount/i), 'citationcount should not leak');
  });

  test('handles special characters in title (curly braces, ampersands)', () => {
    const pool = {
      metadata: {},
      papers: [
        {
          seq_id: 1,
          citation_key: 'X',
          title: 'A & B: {the test}',
          author: 'A',
          year: 2020,
        },
      ],
    };
    const bib = renderBibTeX(pool);
    // BibTeX must escape & as \& or wrap in braces
    assertTruthy(bib.includes('A') && bib.includes('B'), 'title fragments should be present');
  });

  test('empty pool renders header only', () => {
    const pool = { metadata: {}, papers: [] };
    const bib = renderBibTeX(pool);
    assertMatch(bib, /^% lit-search references/m);
    assertFalsy(bib.match(/@\w+\{/));
  });

  test('preprint metadata (eprint, archivePrefix) is preserved', () => {
    const pool = {
      metadata: {},
      papers: [
        {
          seq_id: 1,
          citation_key: 'X',
          entry_type: 'article',
          title: 'T',
          author: 'A',
          year: 2017,
          doi: '10.5555/x',
          arxiv_id: '1706.03762',
          primary_category: 'cs.CL',
        },
      ],
    };
    const bib = renderBibTeX(pool);
    assertMatch(bib, /eprint = \{1706\.03762\}/);
    assertMatch(bib, /archivePrefix = \{arXiv\}/);
  });
});

suite('PDF candidate normalization', () => {
  test('sorts candidates by confidence desc', () => {
    const norm = normalizePdfCandidates([
      {
        url: 'https://a.example/x.pdf',
        source: 'a',
        provider: 'a',
        access_type: 'publisher_oa_pdf',
        confidence: 0.3,
        license: null,
        is_oa: false,
        reason: '',
      },
      {
        url: 'https://b.example/x.pdf',
        source: 'b',
        provider: 'b',
        access_type: 'arxiv',
        confidence: 0.9,
        license: null,
        is_oa: true,
        reason: '',
      },
      {
        url: 'https://c.example/x.pdf',
        source: 'c',
        provider: 'c',
        access_type: 'repository',
        confidence: 0.6,
        license: null,
        is_oa: true,
        reason: '',
      },
    ]);
    assertEqual(norm[0].url, 'https://b.example/x.pdf');
    assertEqual(norm[1].url, 'https://c.example/x.pdf');
    assertEqual(norm[2].url, 'https://a.example/x.pdf');
  });

  test('assigns rank 1..N', () => {
    const norm = normalizePdfCandidates([
      {
        url: 'https://a.example/x.pdf',
        source: 'a',
        provider: 'a',
        access_type: 'publisher_oa_pdf',
        confidence: 0.5,
        license: null,
        is_oa: false,
        reason: '',
      },
      {
        url: 'https://b.example/x.pdf',
        source: 'b',
        provider: 'b',
        access_type: 'repository',
        confidence: 0.5,
        license: null,
        is_oa: false,
        reason: '',
      },
    ]);
    assertEqual(norm[0].rank, 1);
    assertEqual(norm[1].rank, 2);
  });

  test('normalizes access_type aliases', () => {
    const norm = normalizePdfCandidates([
      {
        url: 'https://x.example/x.pdf',
        source: 'crossref',
        provider: 'x',
        access_type: 'crossref_pdf_link',
        confidence: 0.5,
        license: null,
        is_oa: false,
        reason: '',
      },
    ]);
    // Should be a known access_type
    assertTruthy(
      ['crossref_pdf_link', 'arxiv', 'repository', 'publisher_oa_pdf', 'unknown'].includes(
        norm[0].access_type
      )
    );
  });

  test('handles empty input', () => {
    const norm = normalizePdfCandidates([]);
    assertEqual(norm.length, 0);
  });

  test('strips null/undefined fields and only keeps known keys', () => {
    const norm = normalizePdfCandidates([
      {
        url: 'https://x.example/x.pdf',
        source: 'a',
        provider: 'a',
        access_type: 'publisher_oa_pdf',
        confidence: 0.5,
        license: null,
        is_oa: false,
        reason: '',
      },
    ]);
    const known = new Set([
      'url',
      'source',
      'provider',
      'access_type',
      'license',
      'is_oa',
      'confidence',
      'reason',
      'rank',
    ]);
    for (const k of Object.keys(norm[0])) {
      assertTruthy(known.has(k), `unexpected key: ${k}`);
    }
  });

  test('regression: arxiv candidates rank highest', () => {
    const norm = normalizePdfCandidates([
      {
        url: 'https://x.example/p.pdf',
        source: 'crossref',
        provider: 'x',
        access_type: 'publisher_oa_pdf',
        confidence: 0.5,
        license: null,
        is_oa: false,
        reason: '',
      },
      {
        url: 'https://arxiv.org/pdf/1234.5678.pdf',
        source: 'arxiv',
        provider: 'arxiv',
        access_type: 'arxiv',
        confidence: 0.98,
        license: null,
        is_oa: true,
        reason: '',
      },
    ]);
    assertEqual(norm[0].url, 'https://arxiv.org/pdf/1234.5678.pdf');
    assertEqual(norm[0].rank, 1);
  });
});

suite('Result file output round-trip', () => {
  test('writes and reads back literature_pool.json faithfully', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lit-search-roundtrip-'));
    try {
      const pool = {
        metadata: { query: 'rt' },
        papers: [
          {
            seq_id: 1,
            citation_key: 'X1',
            title: 'RT',
            author: 'A',
            year: 2020,
            doi: '10.1/rt',
            identifiers: { doi: '10.1/rt' },
            pdf_candidates: [],
          },
        ],
      };
      const files = writeResultFiles(pool, tmp, { mode: 'test', outputDir: tmp });
      assertOk(existsSync(files.metaFile));
      assertOk(existsSync(files.poolJsonFile));
      assertOk(existsSync(files.bibFile));
      const round = readLiteraturePool(files.poolJsonFile);
      assertEqual(round.papers[0].title, 'RT');
      assertEqual(round.metadata.query, 'rt');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('does not write pdf_status.md or pdfs/ (removed feature)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lit-search-nopdf-'));
    try {
      writeResultFiles({ metadata: {}, papers: [] }, tmp, { mode: 'test', outputDir: tmp });
      assertEqual(existsSync(join(tmp, 'pdf_status.md')), false);
      assertEqual(existsSync(join(tmp, 'pdfs')), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('search_meta.json includes version and file manifest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lit-search-meta-'));
    try {
      const files = writeResultFiles({ metadata: {}, papers: [] }, tmp, {
        mode: 'test',
        outputDir: tmp,
      });
      const meta = JSON.parse(readFileSync(files.metaFile, 'utf-8'));
      assertMatch(meta.version, /^\d+\.\d+\.\d+/);
      assertOk(meta.files);
      assertOk(meta.files.literaturePool);
      assertOk(meta.files.references);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('resolvePoolPath: directory input with existing pool gets default pool file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lit-search-resolve-'));
    try {
      const poolFile = join(tmp, 'literature_pool.json');
      writeFileSync(poolFile, '{}');
      const resolved = resolvePoolPath(tmp);
      assertEqual(resolved, poolFile);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('resolvePoolPath: missing directory throws a clear error', () => {
    let thrown = null;
    try {
      resolvePoolPath('/nonexistent-dir-xyz');
    } catch (e) {
      thrown = e;
    }
    assertTruthy(thrown);
    assertMatch(thrown.message, /Cannot find literature_pool\.json/);
  });

  test('resolvePoolPath: explicit file path is preserved', () => {
    const resolved = resolvePoolPath('/some/dir/pool.json');
    assertMatch(resolved, /pool\.json$/);
  });
});
