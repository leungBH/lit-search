/**
 * Result file rendering helpers.
 */

export function renderOutput(result, format = 'md') {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }
  if (format === 'bib') {
    return renderBibTeX(result);
  }

  return renderMarkdown(result);
}

export function resolveOutputFormat(outputFile, explicitFormat = null) {
  if (explicitFormat) return explicitFormat;
  if (outputFile.toLowerCase().endsWith('.json')) return 'json';
  if (outputFile.toLowerCase().endsWith('.bib')) return 'bib';
  return 'md';
}

export function renderMarkdown(result) {
  const lines = [];
  const { metadata, papers } = result;

  lines.push('# lit-search Results');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Query: ${metadata.query}`);
  lines.push(`- Query expansion: ${metadata.queryExpansion}`);
  lines.push(`- Keywords searched: ${metadata.keywords.join(', ')}`);
  lines.push(`- Year range: ${formatYearRange(metadata.yearRange)}`);
  lines.push(`- Retrieved: ${metadata.totalRetrieved}`);
  lines.push(`- Deduplicated: ${metadata.afterDedup}`);
  lines.push(`- Filtered: ${metadata.afterFilter}`);
  lines.push(`- Final count: ${metadata.finalCount}`);
  lines.push('');

  lines.push('## Engine Stats');
  lines.push('');
  lines.push('| Engine | Status | Count |');
  lines.push('| --- | --- | ---: |');
  for (const stat of metadata.engineStats || []) {
    lines.push(`| ${escapePipes(stat.engine)} | ${escapePipes(stat.status)} | ${stat.totalPapers} |`);
  }
  lines.push('');

  lines.push('## Papers');
  lines.push('');

  if (!papers.length) {
    lines.push('No papers found.');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  for (const paper of papers) {
    lines.push(`### ${paper.seq_id}. ${paper.title}`);
    lines.push('');
    lines.push(`- Authors: ${formatList(paper.authors)}`);
    lines.push(`- Year: ${paper.year ?? 'N/A'}`);
    lines.push(`- Source: ${paper.source || 'N/A'}`);
    lines.push(`- Journal/Venue: ${paper.journal || paper.venue || 'N/A'}`);
    lines.push(`- Volume/Issue/Pages: ${formatVolumeIssuePages(paper)}`);
    lines.push(`- DOI: ${paper.doi || 'N/A'}`);
    lines.push(`- URL: ${paper.url || 'N/A'}`);
    lines.push(`- PDF: ${paper.pdf_url || 'N/A'}`);
    lines.push(`- Citation Count: ${paper.citation_count ?? 0}`);
    lines.push(`- Type: ${paper.work_type || 'N/A'}`);
    lines.push(`- Language: ${paper.language || 'N/A'}`);
    lines.push(`- Keywords: ${formatList(paper.keywords)}`);
    if (paper.fields_of_study?.length) {
      lines.push(`- Fields of Study: ${formatList(paper.fields_of_study)}`);
    }
    if (paper.primary_category) {
      lines.push(`- Primary Category: ${paper.primary_category}`);
    }
    if (paper.note) {
      lines.push(`- Note: ${paper.note}`);
    }
    lines.push(`- Abstract: ${paper.abstract || 'N/A'}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function renderBibTeX(result) {
  const { metadata, papers } = result;
  const lines = [];

  lines.push(`% lit-search results`);
  lines.push(`% Query: ${metadata.query}`);
  lines.push(`% Query expansion: ${metadata.queryExpansion}`);
  lines.push(`% Search scope: ${metadata.searchScope}`);
  lines.push(`% Keywords searched: ${metadata.keywords.join(', ')}`);
  lines.push(`% Year range: ${formatYearRange(metadata.yearRange)}`);
  lines.push(`% Final count: ${metadata.finalCount}`);
  lines.push('');

  for (const paper of papers) {
    lines.push(renderBibEntry(paper));
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function renderBibEntry(paper) {
  const entryType = inferBibEntryType(paper);
  const fields = [
    ['title', paper.title],
    ['author', paper.author],
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
    ['note', paper.note],
    ['source', paper.source],
    ['citationcount', paper.citation_count]
  ];

  if (paper.pdf_url) {
    fields.push(['pdfurl', paper.pdf_url]);
  }

  if (paper.arxiv_id) {
    fields.push(['eprint', paper.arxiv_id]);
    fields.push(['archiveprefix', 'arXiv']);
  }

  if (paper.primary_category) {
    fields.push(['primaryclass', paper.primary_category]);
  }

  if (paper.openalex_id) {
    fields.push(['openalexid', paper.openalex_id]);
  }

  if (paper.semantic_scholar_id) {
    fields.push(['semanticscholarid', paper.semantic_scholar_id]);
  }

  if (paper.crossref_id) {
    fields.push(['crossrefid', paper.crossref_id]);
  }

  if (paper.core_id) {
    fields.push(['coreid', paper.core_id]);
  }

  if (paper.issn?.length) {
    fields.push(['issn', paper.issn.join(', ')]);
  }

  if (paper.isbn?.length) {
    fields.push(['isbn', paper.isbn.join(', ')]);
  }

  const body = fields
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `  ${key} = ${formatBibValue(value)}`)
    .join(',\n');

  return `@${entryType}{${sanitizeBibKey(paper.citation_key)},\n${body}\n}`;
}

function formatYearRange(yearRange) {
  if (!yearRange) return 'Any';
  return `${yearRange.start || '...'} - ${yearRange.end || '...'}`;
}

function formatList(values) {
  if (!values || values.length === 0) return 'N/A';
  return values.join(', ');
}

function formatVolumeIssuePages(paper) {
  const parts = [];
  if (paper.volume) parts.push(`vol. ${paper.volume}`);
  if (paper.issue) parts.push(`no. ${paper.issue}`);
  if (paper.pages) parts.push(`pp. ${paper.pages}`);
  return parts.length ? parts.join(', ') : 'N/A';
}

function escapePipes(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function inferBibEntryType(paper) {
  if (paper.entry_type === 'misc') return 'misc';
  if (paper.booktitle) return 'inproceedings';
  if (!paper.journal && paper.venue) return 'inproceedings';
  if (paper.journal) return 'article';
  if (paper.arxiv_id) return 'misc';
  return 'misc';
}

function inferBooktitle(paper) {
  if (paper.journal || !paper.venue) return null;
  return paper.venue;
}

function formatKeywords(keywords) {
  if (!keywords) return null;
  return Array.isArray(keywords) ? keywords.join(', ') : keywords;
}

function formatBibValue(value) {
  if (typeof value === 'number') {
    return `{${value}}`;
  }

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
