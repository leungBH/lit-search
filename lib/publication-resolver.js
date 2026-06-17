import { OpenAlexAPI } from './apis/openalex.js';

const PUBLISHED_PREFERENCE = 'published_version';
const BEST_AVAILABLE_PREFERENCE = 'best_available';

export async function resolvePublicationsInPool(pool, options = {}) {
  const resolvePreprint = options.resolvePreprint === true;
  const preferPublished = options.preferPublished === true;
  const enabled = resolvePreprint || preferPublished;
  const openalex = options.openalex || new OpenAlexAPI(options.apiKeys?.openalex || null, options.logger || console);
  const stats = {
    enabled,
    resolvePreprint,
    preferPublished,
    total: pool.papers?.length || 0,
    attempted: 0,
    resolvedPublished: 0,
    preprintOnly: 0,
    unknown: 0,
    sources: ['arxiv', 'openalex']
  };

  const papers = [];
  for (const paper of pool.papers || []) {
    const resolved = enabled
      ? await resolvePublicationForPaper(paper, { openalex, preferPublished, logger: options.logger })
      : attachPublicationModel(paper);
    if (resolved.publication_status === 'published') stats.resolvedPublished++;
    else if (resolved.publication_status === 'preprint_only') stats.preprintOnly++;
    else stats.unknown++;
    if (enabled && shouldAttemptResolution(paper)) stats.attempted++;
    papers.push(resolved);
  }

  pool.papers = papers;
  pool.metadata = {
    ...(pool.metadata || {}),
    publicationResolution: stats
  };
  return { pool, stats };
}

export async function resolvePublicationForPaper(paper, options = {}) {
  const base = attachPublicationModel(paper);
  if (!shouldAttemptResolution(base)) {
    return base;
  }

  const candidate = await findFormalRecord(base, options);
  if (!candidate) {
    base.publication_status = base.preprint ? 'preprint_only' : inferPublicationStatus(base);
    base.citation_metadata_preference = base.preprint
      ? 'preprint_only_until_published_metadata_found'
      : BEST_AVAILABLE_PREFERENCE;
    return base;
  }

  const citationMetadata = buildCitationMetadata(candidate, 'openalex.formal_record', 0.86);
  const resolved = {
    ...base,
    citation_metadata: citationMetadata,
    publication_status: 'published',
    citation_metadata_preference: options.preferPublished ? PUBLISHED_PREFERENCE : BEST_AVAILABLE_PREFERENCE,
    metadata_sources: {
      ...(base.metadata_sources || {}),
      citation_metadata: {
        source: 'openalex',
        resolver: candidate.doi ? 'openalex.doi_or_formal_match' : 'openalex.title_match',
        confidence: citationMetadata.confidence,
        reason: 'Formal publication metadata was found and selected for citation.'
      }
    }
  };

  if (options.preferPublished) {
    applyCitationMetadataToTopLevel(resolved, citationMetadata);
  }

  return resolved;
}

export function attachPublicationModel(paper) {
  const identity = buildIdentity(paper);
  const preprint = buildPreprint(paper, identity);
  const existingCitation = paper.citation_metadata || buildCitationMetadata(paper, paper.source || 'original', 0.5);
  const publicationStatus = paper.publication_status || inferPublicationStatus({ ...paper, identity, preprint });

  return {
    ...paper,
    identity,
    citation_metadata: existingCitation,
    preprint,
    metadata_sources: {
      ...(paper.metadata_sources || {}),
      identity: {
        source: 'lit-search',
        resolver: 'identity.signals',
        confidence: 0.8,
        reason: 'Identity signals were derived from normalized paper metadata.'
      },
      ...(preprint ? {
        preprint: {
          source: 'arxiv',
          resolver: 'arxiv.metadata',
          confidence: 0.9,
          reason: 'arXiv metadata is preserved separately from citation metadata.'
        }
      } : {})
    },
    publication_status: publicationStatus,
    citation_metadata_preference: paper.citation_metadata_preference || (
      publicationStatus === 'published' ? BEST_AVAILABLE_PREFERENCE : 'preprint_only_until_published_metadata_found'
    )
  };
}

async function findFormalRecord(paper, options) {
  const openalex = options.openalex;
  if (!openalex) return null;
  const doi = normalizeDoi(paper.identity?.doi || paper.doi || paper.identifiers?.doi);
  if (doi && typeof openalex.fetchWorkByDoi === 'function') {
    const byDoi = await safeLookup(() => openalex.fetchWorkByDoi(doi));
    if (isFormalCandidate(byDoi, paper)) return byDoi;
  }

  const openalexId = paper.identity?.openalex_id || paper.openalex_id || paper.identifiers?.openalex;
  if (openalexId && typeof openalex.fetchWorkById === 'function') {
    const byId = await safeLookup(() => openalex.fetchWorkById(openalexId));
    if (isFormalCandidate(byId, paper)) return byId;
  }

  if (!paper.title || typeof openalex.searchWorks !== 'function') return null;
  const matches = await safeLookup(() => openalex.searchWorks(paper.title, {
    limit: 3,
    searchScope: 'title-only',
    yearRange: paper.year ? { start: Math.max(1900, Number(paper.year) - 1), end: Number(paper.year) + 2 } : null
  }));
  return (Array.isArray(matches) ? matches : []).find(match => isHighConfidenceFormalMatch(paper, match)) || null;
}

async function safeLookup(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function shouldAttemptResolution(paper) {
  return Boolean(
    paper.source === 'arxiv' ||
    paper.arxiv_id ||
    paper.identifiers?.arxiv ||
    paper.identity?.arxiv_id ||
    paper.preprint
  );
}

function buildIdentity(paper) {
  const identifiers = paper.identifiers || {};
  const doi = normalizeDoi(paper.doi || identifiers.doi);
  const arxivId = paper.arxiv_id || identifiers.arxiv || null;
  return {
    doi,
    arxiv_id: arxivId,
    semantic_scholar_id: paper.semantic_scholar_id || identifiers.semanticScholar || null,
    openalex_id: paper.openalex_id || identifiers.openalex || null,
    crossref_id: paper.crossref_id || identifiers.crossref || null,
    core_id: paper.core_id || identifiers.core || null,
    europe_pmc_id: paper.europe_pmc_id || identifiers.europepmc || null,
    dblp_key: paper.dblp_key || identifiers.dblp || null,
    doaj_id: paper.doaj_id || identifiers.doaj || null,
    pmid: paper.pmid || identifiers.pmid || null,
    pmcid: paper.pmcid || identifiers.pmcid || null,
    title_author_year_fingerprint: buildFingerprint(paper)
  };
}

function buildPreprint(paper, identity) {
  if (!identity.arxiv_id && paper.source !== 'arxiv') return paper.preprint || null;
  return {
    source: 'arxiv',
    arxiv_id: identity.arxiv_id || null,
    title: paper.title || null,
    authors: paper.authors || [],
    year: paper.year || null,
    doi: normalizeDoi(paper.identifiers?.doi || paper.doi) || null,
    journal_ref: paper.journal && !/^arxiv$/i.test(paper.journal) ? paper.journal : null,
    comment: paper.note || null,
    primary_category: paper.primary_category || null,
    url: paper.url || (identity.arxiv_id ? `https://arxiv.org/abs/${identity.arxiv_id}` : null)
  };
}

function buildCitationMetadata(paper, source, confidence) {
  const entryType = inferEntryType(paper);
  return {
    title: paper.title || null,
    author: paper.author || formatAuthors(paper.authors),
    authors: Array.isArray(paper.authors) ? paper.authors : [],
    year: paper.year || null,
    journal: paper.journal || null,
    venue: paper.venue || null,
    booktitle: paper.booktitle || null,
    volume: paper.volume || null,
    number: paper.number || paper.issue || null,
    issue: paper.issue || null,
    pages: paper.pages || null,
    first_page: paper.first_page || paper.firstPage || null,
    last_page: paper.last_page || paper.lastPage || null,
    publisher: paper.publisher || null,
    doi: normalizeDoi(paper.doi || paper.identifiers?.doi) || null,
    url: paper.url || null,
    entry_type: entryType,
    source,
    source_id: paper.id || paper.openalex_id || paper.identifiers?.openalex || null,
    confidence,
    reason: source === 'openalex.formal_record'
      ? 'OpenAlex formal publication record selected for citation metadata.'
      : 'Best available normalized metadata selected for citation metadata.'
  };
}

function applyCitationMetadataToTopLevel(paper, citation) {
  const fields = ['year', 'journal', 'venue', 'booktitle', 'volume', 'number', 'issue', 'pages', 'first_page', 'last_page', 'publisher', 'doi', 'url', 'entry_type'];
  for (const field of fields) {
    if (hasValue(citation[field])) {
      paper[field] = citation[field];
      paper.metadata_sources[field] = {
        source: citation.source,
        resolver: 'citation_metadata.prefer_published',
        confidence: citation.confidence,
        reason: 'Top-level citation field updated from preferred formal publication metadata.'
      };
    }
  }
}

function isFormalCandidate(candidate, original) {
  if (!candidate) return false;
  if (isArxivDoi(candidate.doi)) return false;
  if (candidate.doi && !isArxivLike(candidate)) return true;
  if (candidate.doi && original.preprint) return true;
  return Boolean(candidate.journal && !isArxivLike(candidate));
}

function isHighConfidenceFormalMatch(original, candidate) {
  if (!isFormalCandidate(candidate, original)) return false;
  const titleScore = titleSimilarity(normalizeTitle(original.title), normalizeTitle(candidate.title));
  if (titleScore < 0.92) return false;
  const yearOk = !original.year || !candidate.year || Math.abs(Number(original.year) - Number(candidate.year)) <= 2;
  if (!yearOk) return false;
  return hasSharedAuthor(original.authors, candidate.authors);
}

function inferPublicationStatus(paper) {
  if (paper.citation_metadata?.doi && !isArxivLike(paper.citation_metadata)) return 'published';
  if (paper.doi && !isArxivLike(paper)) return 'published';
  if (paper.preprint || paper.source === 'arxiv' || paper.arxiv_id) return 'preprint_only';
  return 'unknown';
}

function inferEntryType(paper) {
  const type = String(paper.entry_type || '').toLowerCase();
  if (['article', 'book', 'inbook', 'incollection', 'inproceedings', 'phdthesis', 'mastersthesis', 'techreport', 'misc'].includes(type)) {
    return type;
  }
  if (paper.booktitle) return 'inproceedings';
  if (paper.journal && !/^arxiv$/i.test(paper.journal)) return 'article';
  if (paper.venue && !paper.journal) return 'inproceedings';
  return 'misc';
}

function isArxivLike(paper) {
  const text = [paper.source, paper.journal, paper.venue, paper.publisher, paper.url].filter(Boolean).join(' ');
  return /\barxiv\b|arxiv\.org/i.test(text);
}

function isArxivDoi(doi) {
  return /10\.48550\/arxiv/i.test(String(doi || ''));
}

function buildFingerprint(paper) {
  const firstAuthor = Array.isArray(paper.authors) && paper.authors.length > 0 ? paper.authors[0] : '';
  return [
    normalizeTitle(paper.title),
    normalizePerson(firstAuthor),
    paper.year || ''
  ].filter(Boolean).join('|') || null;
}

function normalizeDoi(value) {
  if (!value) return null;
  return String(value)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .replace(/[).,;]+$/g, '')
    .toLowerCase();
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePerson(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function hasSharedAuthor(a = [], b = []) {
  const left = new Set((Array.isArray(a) ? a : []).map(normalizePerson).filter(Boolean).map(lastName));
  const right = (Array.isArray(b) ? b : []).map(normalizePerson).filter(Boolean).map(lastName);
  return right.some(name => left.has(name));
}

function lastName(name) {
  const parts = String(name || '').split(' ').filter(Boolean);
  return parts[parts.length - 1] || name;
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
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

function formatAuthors(authors) {
  return Array.isArray(authors) && authors.length ? authors.join(' and ') : null;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '' && String(value).trim().toUpperCase() !== 'N/A';
}
