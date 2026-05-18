/**
 * Result file rendering helpers.
 */

export function renderOutput(result, format = 'md') {
  if (format === 'bib') {
    return renderBibTeX(result);
  }

  return renderMarkdown(result);
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
    lines.push(`- 摘要: ${paper.abstract || 'N/A'}`);
    lines.push(`- 关键词: ${formatList(paper.keywords)}`);
    lines.push(`- 作者: ${formatAuthorPreview(paper.authors)}`);
    lines.push(`- 年份: ${paper.year ?? 'N/A'}`);
    lines.push(`- 出版物名称: ${paper.journal || paper.venue || 'N/A'}`);
    lines.push(`- 来源: ${paper.source || 'N/A'}`);
    lines.push(`- DOI: ${paper.doi || 'N/A'}`);
    lines.push(`- URL: ${paper.url || 'N/A'}`);
    lines.push(`- PDF: ${paper.pdf_url || 'N/A'}`);
    lines.push(`- 备注: ${formatDownloadNote(paper)}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function renderPdfStatus(result) {
  const lines = [];
  const papers = result.papers || [];

  lines.push('# PDF Status');
  lines.push('');
  lines.push('| # | Title | DOI | PDF URL | Status | Failure reason | Local path | Next action |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');

  for (const paper of papers) {
    const status = getPdfStatus(paper);
    lines.push([
      paper.seq_id || '',
      escapeTable(paper.title || 'N/A'),
      escapeTable(paper.doi || 'N/A'),
      escapeTable(paper.pdf_url || 'N/A'),
      escapeTable(status.status),
      escapeTable(status.failureReason || ''),
      escapeTable(status.localPath || ''),
      escapeTable(status.nextAction || '')
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
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

function formatAuthorPreview(authors) {
  if (!authors || authors.length === 0) return 'N/A';
  const visible = authors.slice(0, 3).join(', ');
  return authors.length > 3 ? `${visible}, 等` : visible;
}

function formatDownloadNote(paper) {
  const download = paper.pdf_download;

  if (!paper.pdf_url) {
    return '无 PDF 链接';
  }

  if (!download) {
    return '未尝试下载 PDF';
  }

  if (download.status === 'success') {
    return 'PDF 下载成功';
  }

  return `PDF 下载失败：${download.code || 'download_failed'}。${download.message || '未知原因'}${download.action ? ` 建议：${download.action}` : ''}`;
}

function getPdfStatus(paper) {
  const download = paper.pdf_download;

  if (download?.status === 'success') {
    return {
      status: 'downloaded',
      localPath: download.filePath || '',
      failureReason: '',
      nextAction: ''
    };
  }

  if (!paper.pdf_url) {
    return {
      status: 'missing_url',
      failureReason: 'No PDF URL was provided by this source.',
      nextAction: 'Use DOI/title to search open-access repositories or publisher landing pages.'
    };
  }

  if (!download) {
    return {
      status: 'not_attempted',
      failureReason: '',
      nextAction: 'Run lit-search pdf on this literature pool to download available PDFs.'
    };
  }

  return {
    status: download.status === 'skipped' ? 'skipped' : 'failed',
    failureReason: `${download.code || 'download_failed'}: ${download.message || 'Unknown reason'}`,
    nextAction: download.action || ''
  };
}

function escapeTable(value) {
  return String(value ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
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
