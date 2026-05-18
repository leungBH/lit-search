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
    downloadPdf = false,
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

  let pdfSummary = buildInitialPdfSummary(result.papers, resolvedOutputDir);
  let files = writeResultFiles(result, resolvedOutputDir, {
    mode: 'search',
    outputDir: resolvedOutputDir,
    downloadPdf
  });

  if (downloadPdf) {
    hooks.onBeforePdfDownload?.();
    pdfSummary = await downloadPaperPdfs(result.papers, resolvedOutputDir, { logger });
    files = writeResultFiles(result, resolvedOutputDir, {
      mode: 'search',
      outputDir: resolvedOutputDir,
      downloadPdf
    });
  }

  const markdown = renderOutput(result, 'md');
  const bibtex = renderOutput(result, 'bib');

  return {
    result,
    markdown,
    bibtex,
    output: {
      outputDir: resolvedOutputDir,
      literaturePoolFile: files.literaturePoolFile,
      markdownFile: files.markdownFile,
      bibFile: files.bibFile,
      pdfStatusFile: files.pdfStatusFile,
      poolJsonFile: files.poolJsonFile,
      metaFile: files.metaFile,
      pdfDir: pdfSummary.pdfDir,
      files: [
        {
          type: 'markdown',
          role: 'literature_pool',
          path: files.literaturePoolFile,
          description: 'Human-readable literature pool in Markdown.'
        },
        {
          type: 'bibtex',
          role: 'citation_export',
          path: files.bibFile,
          description: 'BibTeX citation file for Zotero, EndNote, Mendeley, and LaTeX workflows.'
        },
        {
          type: 'markdown',
          role: 'pdf_status',
          path: files.pdfStatusFile,
          description: 'PDF download status and suggested next actions.'
        },
        {
          type: 'json',
          role: 'machine_readable_pool',
          path: files.poolJsonFile,
          description: 'Machine-readable literature pool for pdf/status/merge workflows.'
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

export async function downloadPoolPdfs(pool, outputDir, options = {}) {
  const pdfSummary = await downloadPaperPdfs(options.papers || pool.papers || [], outputDir, options);
  const files = writeResultFiles(pool, outputDir, {
    mode: 'pdf',
    outputDir,
    downloadPdf: true
  });
  return {
    pool,
    output: {
      outputDir,
      literaturePoolFile: files.literaturePoolFile,
      markdownFile: files.markdownFile,
      bibFile: files.bibFile,
      pdfStatusFile: files.pdfStatusFile,
      poolJsonFile: files.poolJsonFile,
      metaFile: files.metaFile,
      pdfDir: pdfSummary.pdfDir
    },
    pdfSummary: toStructuredPdfSummary(pdfSummary)
  };
}

function buildInitialPdfSummary(papers, outputDir) {
  return {
    pdfDir: join(outputDir, 'pdfs'),
    total: papers.length,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    results: papers.map(paper => ({
      paper,
      status: paper.pdf_url ? 'not_attempted' : 'skipped',
      code: paper.pdf_url ? 'not_attempted' : 'no_pdf_url',
      message: paper.pdf_url ? 'PDF download has not been attempted.' : 'No PDF URL was provided by this source.',
      action: paper.pdf_url ? 'Run lit-search pdf on this literature pool to download available PDFs.' : 'Use DOI/title to search open-access repositories or publisher landing pages.'
    }))
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
