import { join } from 'node:path';
import { searchPapers } from './search.js';
import { renderBibTeX } from './output.js';
import { generateOutputFolderName, writeResultFiles } from './output-files.js';
import { resolvePublicationsInPool } from './publication-resolver.js';

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
    resolvePreprint = false,
    preferPublished = false,
    onProgress = null,
    signal = null,
  } = options;

  const resolvedOutputDir = outputDir || join(outputBaseDir, generateOutputFolderName());

  // 阶段 1：多源检索（占 70% 进度）
  const report = typeof onProgress === 'function' ? onProgress : () => {};
  const phase2Base = 70;
  const phase3Base = 90;

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
    logger,
    // 检索阶段把子进度压到 [0, 70) 区间
    onProgress: onProgress
      ? async (p, t, m) => report(Math.round((p / t) * phase2Base), 100, m)
      : null,
    signal,
  });

  // 阶段 2：解析出版信息（占 70%–90%）
  const publicationResolution = await resolvePublicationsInPool(result, {
    resolvePreprint,
    preferPublished,
    apiKeys,
    logger,
    signal,
    onProgress: onProgress
      ? async (p, t, m) =>
          report(phase2Base + Math.round((p / t) * (phase3Base - phase2Base)), 100, m)
      : null,
  });

  // 阶段 3：写文件（占 90%–100%）
  if (onProgress) await report(phase3Base, 100, '写文件...');
  const files = writeResultFiles(publicationResolution.pool, resolvedOutputDir, {
    mode: 'search',
    outputDir: resolvedOutputDir,
  });

  if (onProgress) await report(100, 100, '完成');

  const bibtex = renderBibTeX(publicationResolution.pool);

  return {
    result: publicationResolution.pool,
    bibtex,
    output: {
      outputDir: resolvedOutputDir,
      bibFile: files.bibFile,
      poolJsonFile: files.poolJsonFile,
      metaFile: files.metaFile,
      files: [
        {
          type: 'json',
          role: 'search_metadata',
          path: files.metaFile,
          description:
            'Search parameters, source list, timestamps, and retrieval statistics for reproducibility.',
        },
        {
          type: 'json',
          role: 'literature_pool',
          path: files.poolJsonFile,
          description: 'Complete normalized literature results for machine processing.',
        },
        {
          type: 'bibtex',
          role: 'citation_export',
          path: files.bibFile,
          description: 'BibTeX citation file for LaTeX, Zotero, EndNote, and Mendeley workflows.',
        },
      ],
    },
  };
}
