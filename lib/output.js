/**
 * Output rendering helpers.
 *
 * The machine-readable source of truth is literature_pool.json.
 * references.bib is intentionally conservative and LaTeX-friendly.
 */

export function renderOutput(result, format = 'bib') {
  if (format !== 'bib') {
    throw new Error('Only BibTeX rendering is supported. Use literature_pool.json for complete results.');
  }
  return renderBibTeX(result);
}

export function renderBibTeX(result) {
  const { metadata = {}, papers = [] } = result;
  const lines = [];

  lines.push('% lit-search references');
  lines.push(`% Query: ${metadata.query || ''}`);
  lines.push(`% Query expansion: ${metadata.queryExpansion || ''}`);
  lines.push(`% Search scope: ${metadata.searchScope || ''}`);
  lines.push(`% Keywords searched: ${(metadata.keywords || []).join(', ')}`);
  lines.push(`% Year range: ${formatYearRange(metadata.yearRange)}`);
  lines.push(`% Final count: ${metadata.finalCount ?? papers.length}`);
  lines.push('');

  for (const paper of papers) {
    lines.push(renderBibEntry(paper));
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function renderBibEntry(paper) {
  const fields = [
    ['title', paper.title],
    ['author', paper.author || formatAuthors(paper.authors)],
    ['year', paper.year],
    ['journal', paper.journal],
    ['booktitle', paper.booktitle || inferBooktitle(paper)],
    ['volume', paper.volume],
    ['number', paper.number || paper.issue],
    ['pages', paper.pages],
    ['publisher', paper.publisher],
    ['doi', paper.doi],
    ['url', paper.url],
    ['abstract', paper.abstract],
    ['keywords', formatKeywords(paper.keywords)],
    ['language', paper.language],
    ['note', paper.note]
  ];

  if (paper.arxiv_id) {
    fields.push(['eprint', paper.arxiv_id]);
    fields.push(['archivePrefix', 'arXiv']);
  }

  if (paper.primary_category) {
    fields.push(['primaryClass', paper.primary_category]);
  }

  if (paper.issn?.length) {
    fields.push(['issn', paper.issn.join(', ')]);
  }

  if (paper.isbn?.length) {
    fields.push(['isbn', paper.isbn.join(', ')]);
  }

  const body = fields
    .filter(([, value]) => hasBibValue(value))
    .map(([key, value]) => `  ${key} = ${formatBibValue(value)}`)
    .join(',\n');

  return `@${inferBibEntryType(paper)}{${sanitizeBibKey(paper.citation_key)},\n${body}\n}`;
}

function inferBibEntryType(paper) {
  const type = String(paper.entry_type || '').toLowerCase();
  if (['article', 'book', 'inbook', 'incollection', 'inproceedings', 'phdthesis', 'mastersthesis', 'techreport', 'misc'].includes(type)) {
    return type;
  }
  if (paper.booktitle) return 'inproceedings';
  if (!paper.journal && paper.venue) return 'inproceedings';
  if (paper.journal) return 'article';
  return 'misc';
}

function inferBooktitle(paper) {
  if (paper.journal || !paper.venue) return null;
  return paper.venue;
}

function formatAuthors(authors) {
  if (!Array.isArray(authors) || authors.length === 0) return null;
  return authors.join(' and ');
}

function formatKeywords(keywords) {
  if (!keywords) return null;
  return Array.isArray(keywords) ? keywords.join(', ') : keywords;
}

function formatYearRange(yearRange) {
  if (!yearRange) return 'Any';
  return `${yearRange.start || '...'} - ${yearRange.end || '...'}`;
}

function hasBibValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '' && String(value).trim().toUpperCase() !== 'N/A';
}

function formatBibValue(value) {
  if (typeof value === 'number') return `{${value}}`;
  return `{${escapeBibValue(String(value))}}`;
}

function escapeBibValue(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeBibKey(value) {
  return String(value || 'litsearch')
    .replace(/[^\w:-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'litsearch';
}
