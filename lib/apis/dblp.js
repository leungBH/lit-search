import { createRequestSignal, isAbortError } from './request-utils.js';

const BASE_URL = 'https://dblp.org/search/publ/api';

export class DblpAPI {
  constructor(logger = console) {
    this.logger = logger;
    this.queryTimeoutMs = 15000;
  }

  async searchWorks(query, options = {}) {
    const { limit = 50, yearRange = null, searchScope = 'default-engine-search', signal = null } = options;
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      h: String(Math.min(limit, 100))
    });
    const request = createRequestSignal(signal, this.queryTimeoutMs);

    try {
      const response = await fetch(`${BASE_URL}?${params}`, { signal: request.signal });
      if (!response.ok) throw new Error(`DBLP API error: ${response.status}`);
      const data = await response.json();
      const hits = data.result?.hits?.hit || [];
      return hits
        .map(hit => this._normalizeHit(hit))
        .filter(paper => filterYear(paper, yearRange))
        .filter(paper => filterScope(paper, query, searchScope))
        .slice(0, limit);
    } catch (error) {
      if (isAbortError(error) || request.signal.aborted) {
        if (signal?.aborted) throw new Error('请求已取消');
        throw new Error('请求超时（15秒）');
      }
      throw error;
    } finally {
      request.cleanup();
    }
  }

  _normalizeHit(hit) {
    const info = hit.info || {};
    const authors = normalizeAuthors(info.authors?.author);
    const doi = extractDoi(info);
    const venue = info.venue || null;
    const pages = normalizePages(info.pages || null);
    const eeValues = Array.isArray(info.ee) ? info.ee : [info.ee].filter(Boolean);
    const url = eeValues[0] || info.url || null;
    return {
      id: info.key || hit['@id'] || url || doi || null,
      title: info.title || '',
      authors,
      year: info.year ? Number(info.year) : null,
      venue,
      journal: isJournalLike(info.type) ? venue : null,
      booktitle: isConferenceLike(info.type) ? venue : null,
      publisher: info.publisher || null,
      doi,
      abstract: null,
      tldr: null,
      citationCount: 0,
      pdfCandidates: doi ? [{
        source: 'dblp',
        provider: 'doi.org',
        url: `https://doi.org/${doi}`,
        access_type: 'doi_landing_page',
        license: null,
        is_oa: false,
        confidence: 0.22,
        reason: 'DBLP record has a DOI; DOI landing page is available as a manual fallback.',
        resolver: 'doi.landing'
      }] : [],
      url,
      volume: info.volume || null,
      issue: info.number || null,
      pages: pages.pages,
      firstPage: pages.firstPage,
      lastPage: pages.lastPage,
      keywords: [],
      topics: [],
      language: null,
      workType: info.type || null,
      identifiers: {
        doi,
        dblp: info.key || null
      },
      source: 'dblp'
    };
  }
}

function normalizeAuthors(authorField) {
  if (!authorField) return [];
  const authors = Array.isArray(authorField) ? authorField : [authorField];
  return authors
    .map(author => typeof author === 'string' ? author : author.text || author._ || '')
    .map(name => name.trim())
    .filter(Boolean);
}

function extractDoi(info) {
  const eeValues = Array.isArray(info.ee) ? info.ee : [info.ee].filter(Boolean);
  const doiUrl = eeValues.find(value => /doi\.org\/10\./i.test(String(value)));
  if (!doiUrl && info.doi) return normalizeDoi(info.doi);
  return doiUrl ? normalizeDoi(doiUrl) : null;
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

function normalizePages(value) {
  const pages = value ? String(value).replace(/--/g, '-') : null;
  if (!pages) return { pages: null, firstPage: null, lastPage: null };
  const [firstPage, lastPage] = pages.split('-').map(item => item.trim()).filter(Boolean);
  return { pages, firstPage: firstPage || null, lastPage: lastPage || null };
}

function filterYear(paper, yearRange) {
  if (!yearRange || !paper.year) return true;
  if (yearRange.start && paper.year < yearRange.start) return false;
  if (yearRange.end && paper.year > yearRange.end) return false;
  return true;
}

function filterScope(paper, query, searchScope) {
  if (searchScope !== 'title-only') return true;
  return normalizeText(paper.title).includes(normalizeText(query));
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isConferenceLike(type) {
  return /Conference|Conference and Workshop Papers/i.test(String(type || ''));
}

function isJournalLike(type) {
  return /Journal|Article/i.test(String(type || ''));
}

export default DblpAPI;
