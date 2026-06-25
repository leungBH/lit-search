import { createRequestSignal, isAbortError } from './request-utils.js';

const BASE_URL = 'https://doaj.org/api/search/articles';

export class DoajAPI {
  constructor(logger = console) {
    this.logger = logger;
    this.queryTimeoutMs = 15000;
  }

  async searchWorks(query, options = {}) {
    const {
      limit = 50,
      yearRange = null,
      searchScope = 'default-engine-search',
      signal = null,
    } = options;
    const request = createRequestSignal(signal, this.queryTimeoutMs);
    const params = new URLSearchParams({
      page: '1',
      pageSize: String(Math.min(limit, 100)),
    });
    const doajQuery = buildDoajQuery(query, searchScope, yearRange);

    try {
      const response = await fetch(`${BASE_URL}/${encodeURIComponent(doajQuery)}?${params}`, {
        signal: request.signal,
      });
      if (!response.ok) throw new Error(`DOAJ API error: ${response.status}`);
      const data = await response.json();
      return (data.results || []).slice(0, limit).map((item) => this._normalizeItem(item));
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

  _normalizeItem(item) {
    const bibjson = item.bibjson || {};
    const doi = extractIdentifier(bibjson.identifier, 'doi');
    const issn = [
      extractIdentifier(bibjson.identifier, 'pissn'),
      extractIdentifier(bibjson.identifier, 'eissn'),
    ].filter(Boolean);
    const journal = bibjson.journal?.title || null;
    const year = bibjson.year ? Number(bibjson.year) : null;
    const url = collectLinks(bibjson.link)[0] || (doi ? `https://doi.org/${doi}` : null);
    return {
      id: item.id || doi || url || null,
      title: bibjson.title || '',
      authors: (bibjson.author || []).map((author) => author.name).filter(Boolean),
      year,
      venue: journal,
      journal,
      publisher: bibjson.journal?.publisher || null,
      doi,
      abstract: bibjson.abstract || null,
      tldr: null,
      citationCount: 0,
      pdfCandidates: collectDoajPdfCandidates(bibjson, doi),
      url,
      volume: bibjson.journal?.volume || null,
      issue: bibjson.journal?.number || null,
      pages: normalizePages(bibjson.start_page, bibjson.end_page),
      firstPage: bibjson.start_page || null,
      lastPage: bibjson.end_page || null,
      keywords: [
        ...(bibjson.keywords || []),
        ...(bibjson.subject || []).map((subject) => subject.term).filter(Boolean),
      ],
      topics: [],
      language: Array.isArray(bibjson.language)
        ? bibjson.language.join(', ')
        : bibjson.language || null,
      workType: 'journal-article',
      identifiers: {
        doi,
        issn,
        doaj: item.id || null,
      },
      source: 'doaj',
    };
  }
}

function buildDoajQuery(query, searchScope, yearRange) {
  const escaped = String(query || '').trim();
  const parts = [];
  if (searchScope === 'title-only') {
    parts.push(`bibjson.title:"${escaped}"`);
  } else if (searchScope === 'title-abstract') {
    parts.push(`bibjson.title:"${escaped}" OR bibjson.abstract:"${escaped}"`);
  } else {
    parts.push(escaped);
  }
  if (yearRange?.start) parts.push(`bibjson.year:[${yearRange.start} TO *]`);
  if (yearRange?.end) parts.push(`bibjson.year:[* TO ${yearRange.end}]`);
  return parts.join(' AND ');
}

function extractIdentifier(identifiers = [], type) {
  const found = (Array.isArray(identifiers) ? identifiers : []).find((item) => item.type === type);
  return found?.id || null;
}

function collectLinks(links = []) {
  return (Array.isArray(links) ? links : []).map((link) => link.url).filter(Boolean);
}

function collectDoajPdfCandidates(bibjson, doi) {
  const candidates = [];
  for (const link of bibjson.link || []) {
    if (!link?.url) continue;
    const type = String(link.type || '').toLowerCase();
    const looksPdf =
      type.includes('fulltext') || type.includes('pdf') || /\.pdf($|[?#])/i.test(link.url);
    if (!looksPdf) continue;
    candidates.push({
      source: 'doaj',
      provider: safeHostname(link.url) || 'DOAJ',
      url: link.url,
      access_type: 'publisher_oa_pdf',
      license: bibjson.license?.[0]?.type || null,
      is_oa: true,
      confidence: /\.pdf($|[?#])/i.test(link.url) ? 0.85 : 0.65,
      reason: 'DOAJ article metadata provided an open-access full-text link.',
      resolver: 'doaj.link',
    });
  }
  if (doi) {
    candidates.push({
      source: 'doaj',
      provider: 'doi.org',
      url: `https://doi.org/${doi}`,
      access_type: 'doi_landing_page',
      license: bibjson.license?.[0]?.type || null,
      is_oa: true,
      confidence: 0.28,
      reason: 'DOAJ article has a DOI; DOI landing page is available as fallback.',
      resolver: 'doi.landing',
    });
  }
  return candidates;
}

function normalizePages(firstPage, lastPage) {
  if (firstPage && lastPage) return `${firstPage}-${lastPage}`;
  return firstPage || lastPage || null;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export default DoajAPI;
