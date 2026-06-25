import { ArxivAPI, OpenAlexAPI, SemanticScholarAPI } from './apis/index.js';
import { mergePdfCandidates } from './pdf-candidates.js';

const DEFAULT_FIELDS = [
  'abstract',
  'keywords',
  'journal',
  'venue',
  'doi',
  'url',
  'volume',
  'issue',
  'pages',
  'publisher',
  'language',
  'work_type',
  'identifiers',
  'pdf_candidates',
];

export async function enrichMetadataInPool(pool, options = {}) {
  const onlyMissing = options.onlyMissing === true;
  const overwrite = onlyMissing ? false : options.overwrite === true;
  const logger = options.logger || null;
  const resolvers = options.resolvers || createDefaultResolvers(options);
  const fields = normalizeFields(options.fields);
  const concurrency = normalizePositiveInteger(options.concurrency, 1);
  const checkpointInterval = normalizeNonNegativeInteger(options.checkpointInterval, 0);
  const onCheckpoint = typeof options.onCheckpoint === 'function' ? options.onCheckpoint : null;
  const papers = pool.papers || [];
  const stats = {
    total: papers.length,
    complete: 0,
    attempted: 0,
    enrichedPapers: 0,
    enrichedFields: 0,
    lookupFailed: 0,
  };

  let nextIndex = 0;
  let processedSinceCheckpoint = 0;
  let checkpointChain = Promise.resolve();

  const workerCount = Math.min(concurrency, Math.max(papers.length, 1));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < papers.length) {
        const index = nextIndex++;
        await processPaper(papers[index]);
      }
    })
  );
  await checkpointChain;

  updatePoolMetadata(pool, {
    overwrite,
    onlyMissing,
    fields,
    concurrency,
    checkpointInterval,
    stats,
  });

  return { pool, stats };

  async function processPaper(paper) {
    initializeMetadataStatus(paper, fields);
    if (!overwrite && isMetadataComplete(paper, fields)) {
      stats.complete++;
      await maybeCheckpoint();
      return;
    }

    stats.attempted++;
    const result = await enrichOnePaper(paper, resolvers, { ...options, fields, overwrite });
    applyMetadataEnrichment(paper, result, fields);

    if (result.enrichedFields.length) {
      stats.enrichedPapers++;
      stats.enrichedFields += result.enrichedFields.length;
    } else stats.lookupFailed++;

    logger?.info?.(
      `   Metadata ${paper.seq_id || ''}: ${result.enrichedFields.length ? `enriched ${result.enrichedFields.length} field(s)` : 'no updates'}`
    );
    await maybeCheckpoint();
  }

  async function maybeCheckpoint() {
    if (!onCheckpoint || checkpointInterval <= 0) return;
    processedSinceCheckpoint++;
    if (processedSinceCheckpoint < checkpointInterval) return;
    processedSinceCheckpoint = 0;
    updatePoolMetadata(pool, {
      overwrite,
      onlyMissing,
      fields,
      concurrency,
      checkpointInterval,
      stats,
    });
    checkpointChain = checkpointChain.then(() =>
      onCheckpoint({ pool, stats, reason: 'checkpoint' })
    );
    await checkpointChain;
  }
}

async function enrichOnePaper(paper, resolvers, options) {
  const attempts = buildAttempts(paper);
  const attempted = [];
  const resolvedFields = {};
  const enrichedFields = [];

  for (const attempt of attempts) {
    const resolver = resolvers[attempt.resolver];
    if (!resolver) continue;
    attempted.push(attempt.label);

    try {
      const candidate = await resolver(attempt.value, paper, options);
      if (candidate) {
        const changed = mergeMetadataFromCandidate(paper, candidate, {
          fields: options.fields,
          overwrite: options.overwrite,
          resolverLabel: attempt.label,
          resolvedFields,
        });
        enrichedFields.push(...changed);
      }
    } catch (error) {
      attempted.push(`${attempt.label}:failed:${error.message || String(error)}`);
    }
  }

  return {
    status: enrichedFields.length ? 'enriched' : attempted.length ? 'missing' : 'lookup_failed',
    attempted,
    resolvedFields,
    enrichedFields: [...new Set(enrichedFields)],
    reason: enrichedFields.length
      ? 'Metadata fields were enriched from resolver results.'
      : attempted.length
        ? 'Resolvers returned no usable metadata for requested fields.'
        : 'No DOI, arXiv ID, source ID, or title was available for lookup.',
  };
}

function buildAttempts(paper) {
  const attempts = [];
  const doi = normalizeDoi(paper.doi || paper.identifiers?.doi);
  const arxivId = paper.arxiv_id || paper.identifiers?.arxiv;
  const semanticScholarId = paper.semantic_scholar_id || paper.identifiers?.semanticScholar;
  const openalexId = paper.openalex_id || paper.identifiers?.openalex;

  if (arxivId) {
    attempts.push({
      label: 'arxiv.id',
      resolver: 'arxivById',
      source: 'arxiv',
      value: arxivId,
      reason: 'Matched by arXiv ID.',
    });
  }
  if (doi) {
    attempts.push({
      label: 'openalex.doi',
      resolver: 'openalexByDoi',
      source: 'openalex',
      value: doi,
      reason: 'Matched by DOI.',
    });
    attempts.push({
      label: 'semantic-scholar.doi',
      resolver: 'semanticScholarByDoi',
      source: 'semantic-scholar',
      value: doi,
      reason: 'Matched by DOI.',
    });
  }
  if (semanticScholarId) {
    attempts.push({
      label: 'semantic-scholar.id',
      resolver: 'semanticScholarById',
      source: 'semantic-scholar',
      value: semanticScholarId,
      reason: 'Matched by Semantic Scholar ID.',
    });
  }
  if (openalexId) {
    attempts.push({
      label: 'openalex.id',
      resolver: 'openalexById',
      source: 'openalex',
      value: openalexId,
      reason: 'Matched by OpenAlex ID.',
    });
  }
  if (paper.title) {
    attempts.push({
      label: 'title.search',
      resolver: 'titleSearch',
      source: 'title-search',
      value: paper.title,
      reason: 'Matched by title similarity fallback.',
    });
  }

  return attempts;
}

function createDefaultResolvers(options) {
  const apiKeys = options.apiKeys || {};
  const logger = options.logger || null;
  const arxiv = new ArxivAPI();
  const openalex = new OpenAlexAPI(apiKeys.openalex, logger);
  const semanticScholar = new SemanticScholarAPI(apiKeys.s2, logger);

  return {
    arxivById: (id, _paper, opts) => arxiv.fetchById(id, opts.signal),
    openalexByDoi: (doi, _paper, opts) => openalex.fetchWorkByDoi(doi, opts.signal),
    openalexById: (id, _paper, opts) => openalex.fetchWorkById(id, opts.signal),
    semanticScholarByDoi: (doi, _paper, opts) => semanticScholar.fetchPaperByDoi(doi, opts.signal),
    semanticScholarById: (id, _paper, opts) => semanticScholar.fetchPaper(id, opts.signal),
    titleSearch: async (title, paper, opts) => {
      const openalexResults = await openalex.searchWorks(title, {
        limit: 3,
        searchScope: 'title-only',
        signal: opts.signal,
      });
      const semanticResults = await semanticScholar.searchPapers(title, {
        limit: 3,
        signal: opts.signal,
      });
      return (
        [...openalexResults, ...semanticResults]
          .filter(
            (candidate) => titleSimilarity(normalize(candidate.title), normalize(paper.title)) > 0.9
          )
          .sort((a, b) => Number(Boolean(b.abstract)) - Number(Boolean(a.abstract)))[0] || null
      );
    },
  };
}

function applyMetadataEnrichment(paper, result, fields) {
  initializeMetadataStatus(paper, fields);

  for (const field of fields) {
    if (result.resolvedFields[field]) {
      paper.metadata_status[field] = {
        status: 'enriched',
        source: result.resolvedFields[field],
      };
    } else if (!hasFieldValue(paper, field)) {
      paper.metadata_status[field] = {
        status: result.status === 'lookup_failed' ? 'lookup_failed' : 'missing',
        source: null,
      };
    }
  }

  paper.abstract_status = paper.metadata_status.abstract?.status || paper.abstract_status;
  paper.abstract_source = paper.metadata_status.abstract?.source || paper.abstract_source || null;
  paper.metadata_enrichment = {
    attempted: result.attempted,
    resolved_fields: result.resolvedFields,
    missing_fields: fields.filter((field) => !hasFieldValue(paper, field)),
    reason: result.reason,
  };
}

function mergeMetadataFromCandidate(paper, candidate, options) {
  const changed = [];
  const { fields, overwrite, resolverLabel, resolvedFields } = options;

  setScalarField(
    paper,
    candidate,
    'abstract',
    fields,
    overwrite,
    resolverLabel,
    resolvedFields,
    changed
  );
  setScalarField(
    paper,
    candidate,
    'journal',
    fields,
    overwrite,
    resolverLabel,
    resolvedFields,
    changed
  );
  setScalarField(
    paper,
    candidate,
    'venue',
    fields,
    overwrite,
    resolverLabel,
    resolvedFields,
    changed
  );
  setScalarField(
    paper,
    candidate,
    'doi',
    fields,
    overwrite,
    resolverLabel,
    resolvedFields,
    changed
  );
  setScalarField(
    paper,
    candidate,
    'url',
    fields,
    overwrite,
    resolverLabel,
    resolvedFields,
    changed
  );
  setScalarField(
    paper,
    candidate,
    'volume',
    fields,
    overwrite,
    resolverLabel,
    resolvedFields,
    changed
  );
  setScalarField(
    paper,
    candidate,
    'issue',
    fields,
    overwrite,
    resolverLabel,
    resolvedFields,
    changed
  );
  setScalarField(
    paper,
    candidate,
    'pages',
    fields,
    overwrite,
    resolverLabel,
    resolvedFields,
    changed
  );
  setScalarField(
    paper,
    candidate,
    'publisher',
    fields,
    overwrite,
    resolverLabel,
    resolvedFields,
    changed
  );
  setScalarField(
    paper,
    candidate,
    'language',
    fields,
    overwrite,
    resolverLabel,
    resolvedFields,
    changed
  );
  setScalarField(
    paper,
    candidate,
    'work_type',
    fields,
    overwrite,
    resolverLabel,
    resolvedFields,
    changed,
    'workType'
  );

  if (fields.includes('keywords')) {
    const merged = mergeList(
      paper.keywords,
      candidate.keywords,
      candidate.topics,
      candidate.fieldsOfStudy
    );
    if (merged.length > (paper.keywords || []).length) {
      paper.keywords = merged;
      resolvedFields.keywords ||= resolverLabel;
      changed.push('keywords');
    }
  }

  if (
    fields.includes('identifiers') &&
    candidate.identifiers &&
    Object.keys(candidate.identifiers).length
  ) {
    const before = JSON.stringify(paper.identifiers || {});
    paper.identifiers = { ...(paper.identifiers || {}), ...(candidate.identifiers || {}) };
    if (JSON.stringify(paper.identifiers) !== before) {
      resolvedFields.identifiers ||= resolverLabel;
      changed.push('identifiers');
    }
  }

  if (fields.includes('pdf_candidates')) {
    const before = (paper.pdf_candidates || []).length;
    paper.pdf_candidates = mergePdfCandidates(
      paper.pdf_candidates || [],
      candidate.pdfCandidates || [],
      candidate.pdf_candidates || []
    );
    if (paper.pdf_candidates.length > before) {
      resolvedFields.pdf_candidates ||= resolverLabel;
      changed.push('pdf_candidates');
    }
  }

  return changed;
}

function setScalarField(
  paper,
  candidate,
  field,
  fields,
  overwrite,
  resolverLabel,
  resolvedFields,
  changed,
  candidateField = field
) {
  if (!fields.includes(field)) return;
  const value = candidate[candidateField];
  if (!hasUsableText(value)) return;
  if (!overwrite && hasUsableText(paper[field])) return;
  paper[field] = value;
  resolvedFields[field] ||= resolverLabel;
  changed.push(field);
}

function hasUsableText(value) {
  const text = String(value || '').trim();
  return Boolean(text && text.toUpperCase() !== 'N/A');
}

function normalizeDoi(value) {
  return String(value || '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .trim();
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeList(...values) {
  return [...new Set(values.flat().filter(Boolean))];
}

function normalizeFields(fields) {
  if (!fields) return DEFAULT_FIELDS;
  const list = Array.isArray(fields) ? fields : String(fields).split(',');
  const requested = list.map((field) => field.trim()).filter(Boolean);
  return requested.length ? requested : DEFAULT_FIELDS;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function updatePoolMetadata(pool, options) {
  pool.metadata = {
    ...(pool.metadata || {}),
    metadataEnrichment: {
      generatedAt: new Date().toISOString(),
      overwrite: options.overwrite,
      onlyMissing: options.onlyMissing,
      fields: options.fields,
      concurrency: options.concurrency,
      checkpointInterval: options.checkpointInterval,
      stats: options.stats,
    },
  };
}

function initializeMetadataStatus(paper, fields) {
  paper.metadata_status = paper.metadata_status || {};
  for (const field of fields) {
    if (!paper.metadata_status[field]) {
      paper.metadata_status[field] = {
        status: hasFieldValue(paper, field) ? 'present' : 'missing',
        source: hasFieldValue(paper, field) ? 'original' : null,
      };
    }
  }
  paper.abstract_status = paper.metadata_status.abstract?.status || paper.abstract_status;
  paper.abstract_source = paper.metadata_status.abstract?.source || paper.abstract_source;
}

function isMetadataComplete(paper, fields) {
  return fields.every((field) => hasFieldValue(paper, field));
}

function hasFieldValue(paper, field) {
  if (field === 'keywords') return Array.isArray(paper.keywords) && paper.keywords.length > 0;
  if (field === 'identifiers')
    return paper.identifiers && Object.values(paper.identifiers).some(Boolean);
  if (field === 'pdf_candidates')
    return Array.isArray(paper.pdf_candidates) && paper.pdf_candidates.length > 0;
  return hasUsableText(paper[field]);
}

function titleSimilarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
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
