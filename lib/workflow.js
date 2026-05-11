import { join } from 'node:path';
import { searchPapers } from './search.js';
import { renderOutput } from './output.js';
import { downloadPaperPdfs } from './pdf-downloader.js';
import { generateOutputFolderName, writeResultFiles } from './output-files.js';

export async function runLitSearchWorkflow(options) {
  const {
    query,
    keywords = [],
    excludeTerms = [],
    yearStart = null,
    yearEnd = null,
    limit = 3,
    queryExpansion = 'none',
    searchScope = 'default-engine-search',
    engines = {},
    apiKeys = {},
    logger = null,
    outputBaseDir = process.cwd(),
    outputDir = null,
    hooks = {}
  } = options;

  const resolvedOutputDir = outputDir || join(outputBaseDir, generateOutputFolderName(query));

  const result = await searchPapers({
    query,
    keywords,
    excludeTerms,
    yearStart,
    yearEnd,
    limit,
    queryExpansion,
    searchScope,
    engines,
    apiKeys,
    logger
  });

  hooks.onBeforePdfDownload?.();
  const pdfSummary = await downloadPaperPdfs(result.papers, resolvedOutputDir, { logger });
  const files = writeResultFiles(result, resolvedOutputDir);
  const markdown = renderOutput(result, 'md');
  const bibtex = renderOutput(result, 'bib');

  return {
    result,
    markdown,
    bibtex,
    output: {
      outputDir: resolvedOutputDir,
      markdownFile: files.markdownFile,
      bibFile: files.bibFile,
      pdfDir: pdfSummary.pdfDir,
      files: [
        {
          type: 'markdown',
          role: 'readable_results',
          path: files.markdownFile,
          description: 'Human-readable paper summaries in Markdown.'
        },
        {
          type: 'bibtex',
          role: 'citation_export',
          path: files.bibFile,
          description: 'BibTeX citation file for Zotero, EndNote, Mendeley, and LaTeX workflows.'
        },
        {
          type: 'directory',
          role: 'downloaded_pdfs',
          path: pdfSummary.pdfDir,
          description: 'Folder containing successfully downloaded PDF full texts.'
        }
      ]
    },
    pdfSummary: toStructuredPdfSummary(pdfSummary)
  };
}

export function toStructuredPdfSummary(pdfSummary) {
  return {
    pdfDir: pdfSummary.pdfDir,
    total: pdfSummary.total,
    downloaded: pdfSummary.downloaded,
    skipped: pdfSummary.skipped,
    failed: pdfSummary.failed,
    results: pdfSummary.results.map(item => ({
      seq_id: item.paper?.seq_id || null,
      title: item.paper?.title || null,
      source: item.paper?.source || null,
      pdf_url: item.paper?.pdf_url || null,
      status: item.status,
      code: item.code || null,
      message: item.message || null,
      action: item.action || null,
      filePath: item.filePath || null,
      details: item.details || null
    }))
  };
}
