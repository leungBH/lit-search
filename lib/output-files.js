import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { renderBibTeX, renderMarkdown, renderPdfStatus } from './output.js';

export function generateOutputFolderName() {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');

  return `lit_search_${date}_${time}`;
}

export function writeResultFiles(result, outputDir, options = {}) {
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'pdfs'), { recursive: true });

  const literaturePoolFile = join(outputDir, 'literature_pool.md');
  const legacyResultsFile = join(outputDir, 'results.md');
  const bibFile = join(outputDir, 'references.bib');
  const pdfStatusFile = join(outputDir, 'pdf_status.md');
  const poolJsonFile = join(outputDir, 'literature_pool.json');
  const metaFile = join(outputDir, 'search_meta.json');

  const markdown = renderMarkdown(result);
  writeFileSync(literaturePoolFile, markdown, 'utf-8');
  writeFileSync(legacyResultsFile, markdown, 'utf-8');
  writeFileSync(bibFile, renderBibTeX(result), 'utf-8');
  writeFileSync(pdfStatusFile, renderPdfStatus(result), 'utf-8');
  writeFileSync(poolJsonFile, `${JSON.stringify(result, null, 2)}\n`, 'utf-8');
  writeFileSync(metaFile, `${JSON.stringify(buildSearchMeta(result, options), null, 2)}\n`, 'utf-8');

  return {
    literaturePoolFile,
    markdownFile: literaturePoolFile,
    legacyResultsFile,
    bibFile,
    pdfStatusFile,
    poolJsonFile,
    metaFile
  };
}

export function resolvePoolPath(inputPath) {
  const absolute = resolve(inputPath);
  if (absolute.endsWith('.json')) return absolute;
  if (['literature_pool.md', 'results.md', 'pdf_status.md'].includes(basename(absolute))) {
    const siblingPool = join(dirname(absolute), 'literature_pool.json');
    if (existsSync(siblingPool)) return siblingPool;
  }
  if (existsSync(join(absolute, 'literature_pool.json'))) {
    return join(absolute, 'literature_pool.json');
  }
  throw new Error(`Cannot find literature_pool.json from: ${inputPath}`);
}

export function readLiteraturePool(inputPath) {
  const poolFile = resolvePoolPath(inputPath);
  return JSON.parse(readFileSync(poolFile, 'utf-8').replace(/^\uFEFF/, ''));
}

function buildSearchMeta(result, options) {
  return {
    tool: 'lit-search',
    generatedAt: new Date().toISOString(),
    mode: options.mode || 'search',
    outputDir: options.outputDir || null,
    downloadPdf: Boolean(options.downloadPdf),
    metadata: result.metadata
  };
}
