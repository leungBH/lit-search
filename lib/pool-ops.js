import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readLiteraturePool, resolvePoolPath, writeResultFiles } from './output-files.js';
import { enrichMetadataInPool } from './metadata-enricher.js';
import { mergePdfCandidates } from './pdf-candidates.js';
import { enhanceOutputPapers, searchPapers } from './search.js';
import { resolvePublicationsInPool } from './publication-resolver.js';
import { OpenCitationsAPI, UnpaywallAPI } from './apis/index.js';

export async function mergePools(inputs, outputDir, options = {}) {
  const pools = inputs.map(readLiteraturePool);
  const mergedPapers = deduplicatePapers(pools.flatMap((pool) => pool.papers || [])).map(
    (paper, index) => ({
      ...paper,
      seq_id: index + 1,
      citation_key: rebuildCitationKey(paper, index + 1),
    })
  );

  const merged = {
    metadata: {
      query: `merged:${inputs.length}`,
      queryExpansion: 'none',
      searchScope: 'merged-pool',
      keywords: [],
      yearRange: null,
      totalRetrieved: pools.reduce((sum, pool) => sum + (pool.papers?.length || 0), 0),
      afterDedup: mergedPapers.length,
      afterFilter: mergedPapers.length,
      finalCount: mergedPapers.length,
      engines: [],
      engineStats: [],
    },
    papers: mergedPapers,
  };

  const engines = options.engines || {};
  const apiKeys = options.apiKeys || {};
  const enhancementStats = await enhanceOutputPapers(merged.papers, {
    unpaywall:
      engines.unpaywall !== false
        ? new UnpaywallAPI(
            apiKeys.unpaywallEmail || apiKeys.crossrefMailto,
            options.logger || console
          )
        : null,
    openCitations:
      engines.openCitations === true ? new OpenCitationsAPI(options.logger || console) : null,
  });
  merged.metadata.enhancements = enhancementStats;

  const publicationResolution = await resolvePublicationsInPool(merged, {
    resolvePreprint: options.resolvePreprint === true,
    preferPublished: options.preferPublished === true,
    apiKeys,
    logger: options.logger || null,
  });

  const files = writeResultFiles(publicationResolution.pool, outputDir, {
    mode: 'merge',
    outputDir,
  });

  return { pool: publicationResolution.pool, files };
}

export async function enrichMetadata(inputPath, options = {}) {
  const poolFile = resolvePoolPath(inputPath);
  const pool = readLiteraturePool(poolFile);
  const outputDir = dirname(poolFile);
  const checkpointInterval = Number(options.checkpointInterval || 0);
  const result = await enrichMetadataInPool(pool, {
    ...options,
    onCheckpoint:
      checkpointInterval > 0
        ? (checkpoint) => {
            writeResultFiles(checkpoint.pool, outputDir, {
              mode: 'enrich-checkpoint',
              outputDir,
            });
            options.logger?.info?.(
              `   Checkpoint saved after ${checkpoint.stats.complete + checkpoint.stats.attempted}/${checkpoint.stats.total} paper(s)`
            );
          }
        : options.onCheckpoint,
  });
  const files = writeResultFiles(result.pool, outputDir, {
    mode: 'enrich',
    outputDir,
  });
  return { ...result, files, outputDir };
}

export async function resolveCitationsFile(filePath, options) {
  const text = readFileSync(filePath, 'utf-8');
  const citations = parseCitations(text);
  const resolved = [];
  const unresolved = [];

  for (const citation of citations) {
    const query = citation.doi || citation.title;
    if (!query) {
      unresolved.push(citation);
      continue;
    }

    const search = options._searchPapers || searchPapers;
    const result = await search({
      query,
      limit: options.limit || 3,
      yearStart: citation.year || null,
      yearEnd: citation.year || null,
      queryExpansion: 'none',
      searchScope: citation.doi ? 'default-engine-search' : 'title-only',
      relevanceFilter: !citation.doi,
      engines: options.engines || {},
      apiKeys: options.apiKeys || {},
      logger: options.logger || null,
    });

    if (result.papers.length > 0) {
      resolved.push({
        ...result.papers[0],
        discovery: {
          type: 'citation_resolve',
          input: citation.raw,
          parsedTitle: citation.title || null,
          parsedDoi: citation.doi || null,
        },
      });
    } else {
      unresolved.push(citation);
    }
  }

  const papers = resolved.map((paper, index) => ({
    ...paper,
    seq_id: index + 1,
    citation_key: rebuildCitationKey(paper, index + 1),
  }));

  const pool = {
    metadata: {
      query: `resolved:${filePath}`,
      queryExpansion: 'none',
      searchScope: 'citation-resolve',
      keywords: citations.map((citation) => citation.title || citation.doi || '').filter(Boolean),
      yearRange: null,
      totalRetrieved: resolved.length,
      afterDedup: papers.length,
      afterFilter: papers.length,
      finalCount: papers.length,
      unresolvedCount: unresolved.length,
      engines: [],
      engineStats: [],
    },
    papers,
    unresolvedCitations: unresolved,
  };

  const outputDir = options.outputDir || join(dirname(resolve(filePath)), 'resolved_literature');
  const publicationResolution = await resolvePublicationsInPool(pool, {
    resolvePreprint: options.resolvePreprint === true,
    preferPublished: options.preferPublished === true,
    apiKeys: options.apiKeys || {},
    logger: options.logger || null,
  });

  const files = writeResultFiles(publicationResolution.pool, outputDir, {
    mode: 'resolve',
    outputDir,
  });

  return { pool: publicationResolution.pool, files, unresolved };
}

export function parseCitations(text) {
  const normalized = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  if (/^\s*@\w+\s*\{/m.test(normalized)) {
    return parseBibTeXCitations(normalized);
  }

  const hasNumberedMarkers = /^\s*\d+\.\s/m.test(normalized) || /^\s*\[\d+\]\s/m.test(normalized);
  const chunks = hasNumberedMarkers
    ? normalized.split(/\n(?=\s*\d+\.\s|\s*\[\d+\]\s)/)
    : normalized.split('\n');

  return chunks
    .map((item) => item.trim())
    .filter(Boolean)
    .map((raw) => ({
      raw,
      doi: extractDoi(raw),
      title: extractTitle(raw),
      year: extractYear(raw),
    }));
}

function parseBibTeXCitations(text) {
  const entries = [];
  const regex = /@\w+\s*\{[^@]*\}/gs;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0].trim();
    if (!raw) continue;
    const yearRaw = extractBibTeXField(raw, 'year');
    entries.push({
      raw,
      doi: extractDoi(raw),
      title: extractBibTeXField(raw, 'title') || extractTitle(raw),
      year: yearRaw ? Number(yearRaw) || extractYear(raw) : extractYear(raw),
    });
  }
  return entries;
}

function extractBibTeXField(entry, field) {
  const regex = new RegExp(`\\b${field}\\s*=\\s*[{"]([^{}]*?)[}"]`, 'i');
  const match = entry.match(regex);
  return match ? match[1].replace(/[{}]/g, '').trim() : null;
}

export function extractDoi(value) {
  const match = value.match(/10\.\d{4,9}\/[^\s"'<>}]+/i);
  return match ? match[0].replace(/[).,;}]+$/g, '') : null;
}

export function extractTitle(value) {
  const quoted = value.match(/[“"](.*?)[”"]/);
  if (quoted?.[1]) return quoted[1].trim();

  const cleaned = value
    .replace(/10\.\d{4,9}\/[^\s"'<>]+/i, '')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/^\s*\[\d+\]\s*/, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/[|,;:]/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || null;
}

export function extractYear(value) {
  const matches = [...value.matchAll(/\b(19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  return matches.length ? matches[0] : null;
}

function deduplicatePapers(papers) {
  const result = [];
  for (const paper of papers) {
    const existing = result.find((item) => isDuplicate(item, paper));
    if (existing) {
      mergePaperMetadata(existing, paper);
      continue;
    }
    result.push(paper);
  }
  return result;
}

function mergePaperMetadata(target, source) {
  target.pdf_candidates = mergePdfCandidates(
    target.pdf_candidates || [],
    source.pdf_candidates || []
  );
  target.keywords = mergeList(target.keywords, source.keywords);
  target.topics = mergeList(target.topics, source.topics);
  target.fields_of_study = mergeList(target.fields_of_study, source.fields_of_study);
  target.identifiers = {
    ...(target.identifiers || {}),
    ...(source.identifiers || {}),
  };
  target.identity = {
    ...(target.identity || {}),
    ...(source.identity || {}),
  };
  target.metadata_sources = {
    ...(target.metadata_sources || {}),
    ...(source.metadata_sources || {}),
  };
  if (!target.preprint && source.preprint) target.preprint = source.preprint;
  target.citation_metadata = chooseCitationMetadata(
    target.citation_metadata,
    source.citation_metadata
  );
  target.publication_status = choosePublicationStatus(
    target.publication_status,
    source.publication_status
  );
  if (source.citation_metadata_preference === 'published_version') {
    target.citation_metadata_preference = source.citation_metadata_preference;
  }

  target.abstract = chooseBetterText(target.abstract, source.abstract);
  if (source.abstract && target.abstract === source.abstract) {
    target.abstract_status = source.abstract_status || target.abstract_status || 'present';
    target.abstract_source =
      source.abstract_source || target.abstract_source || source.source || 'original';
  }

  for (const field of [
    'journal',
    'venue',
    'booktitle',
    'volume',
    'number',
    'issue',
    'pages',
    'first_page',
    'last_page',
    'publisher',
    'doi',
    'url',
    'language',
    'work_type',
  ]) {
    if (!hasValue(target[field]) && hasValue(source[field])) target[field] = source[field];
  }
  if ((source.citation_count || 0) > (target.citation_count || 0)) {
    target.citation_count = source.citation_count;
  }
}

function chooseBetterText(a, b) {
  if (!hasValue(a)) return hasValue(b) ? b : a;
  if (!hasValue(b)) return a;
  return String(b).length > String(a).length ? b : a;
}

function hasValue(value) {
  return (
    value !== null &&
    value !== undefined &&
    value !== '' &&
    String(value).trim().toUpperCase() !== 'N/A'
  );
}

function mergeList(...values) {
  return [...new Set(values.flat().filter(Boolean))];
}

function chooseCitationMetadata(a, b) {
  if (!a) return b || a;
  if (!b) return a;
  const score = citationMetadataScore;
  return score(b) > score(a) ? b : a;
}

function citationMetadataScore(value) {
  if (!value) return 0;
  let score = Number(value.confidence || 0);
  if (value.doi) score += 2;
  if (value.journal && !/^arxiv$/i.test(value.journal)) score += 1;
  if (value.pages) score += 0.5;
  if (value.source === 'openalex.formal_record') score += 1;
  return score;
}

function choosePublicationStatus(a, b) {
  const rank = { published: 3, accepted: 2, preprint_only: 1, unknown: 0 };
  return (rank[b] || 0) > (rank[a] || 0) ? b : a;
}

function isDuplicate(a, b) {
  if (a.doi && b.doi && normalize(a.doi) === normalize(b.doi)) return true;
  const titleA = normalize(a.title);
  const titleB = normalize(b.title);
  return titleA && titleB && titleSimilarity(titleA, titleB) > 0.85;
}

function titleSimilarity(a, b) {
  if (a === b) return 1;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (!longer) return 1;
  return (longer.length - levenshtein(longer, shorter)) / longer.length;
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function rebuildCitationKey(paper, seqId) {
  const firstAuthor =
    Array.isArray(paper.authors) && paper.authors.length > 0
      ? paper.authors[0].split(' ').pop() || 'unknown'
      : 'unknown';
  return `${firstAuthor}${paper.year || 'nd'}_${seqId}`;
}
