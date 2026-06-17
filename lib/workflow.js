import { join } from 'node:path';
import { searchPapers } from './search.js';
import { renderOutput } from './output.js';
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
    preferPublished = false
  } = options;

  const resolvedOutputDir = outputDir || join(outputBaseDir, generateOutputFolderName());

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

  const publicationResolution = await resolvePublicationsInPool(result, {
    resolvePreprint,
    preferPublished,
    apiKeys,
    logger
  });

  const files = writeResultFiles(publicationResolution.pool, resolvedOutputDir, {
    mode: 'search',
    outputDir: resolvedOutputDir
  });

  const bibtex = renderOutput(publicationResolution.pool, 'bib');

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
          description: 'Search parameters, source list, timestamps, and retrieval statistics for reproducibility.'
        },
        {
          type: 'json',
          role: 'literature_pool',
          path: files.poolJsonFile,
          description: 'Complete normalized literature results for machine processing.'
        },
        {
          type: 'bibtex',
          role: 'citation_export',
          path: files.bibFile,
          description: 'BibTeX citation file for LaTeX, Zotero, EndNote, and Mendeley workflows.'
        }
      ]
    }
  };
}
