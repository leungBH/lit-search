/**
 * OpenAlex API Client
 * https://docs.openalex.org/
 */

import { createRequestSignal, isAbortError } from './request-utils.js';

const BASE_URL = 'https://api.openalex.org';

export class OpenAlexAPI {
  constructor(apiKey = null, logger = console) {
    this.apiKey = apiKey;
    this.logger = logger;
  }

  async searchWorks(query, options = {}) {
    const { limit = 50, yearRange = null, searchScope = 'default-engine-search', signal = null } = options;
    const papers = [];
    let cursor = '*';
    const maxRetries = 2;
    let retryCount = 0;

    const headers = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    // 构建过滤条件
    const filters = [];
    if (yearRange?.start) {
      filters.push(`from_publication_date:${yearRange.start}-01-01`);
    }
    if (yearRange?.end) {
      filters.push(`to_publication_date:${yearRange.end}-12-31`);
    }

    while (papers.length < limit) {
      const loopFilters = [...filters];
      const params = new URLSearchParams({
        'per-page': '100',
        cursor,
        mailto: this.apiKey ? '' : 'lit-search@example.com',
        select: 'id,title,display_name,authorships,publication_year,publication_date,primary_location,best_oa_location,locations,doi,open_access,cited_by_count,abstract_inverted_index,biblio,keywords,topics,language,type'
      });

      if (searchScope === 'title-only') {
        loopFilters.push(`title.search:${query}`);
      } else if (searchScope === 'title-abstract') {
        loopFilters.push(`title_and_abstract.search:${query}`);
      } else {
        params.set('search', query);
      }

      if (loopFilters.length > 0) {
        params.set('filter', loopFilters.join(','));
      }

      const request = createRequestSignal(signal, 15000);
      let response;

      try {
        response = await fetch(`${BASE_URL}/works?${params}`, {
          headers,
          signal: request.signal
        });
      } catch (error) {
        request.cleanup();
        if (isAbortError(error) || request.signal.aborted) {
          if (signal?.aborted) {
            throw new Error('请求已取消');
          }
          throw new Error('请求超时（15秒）');
        }
        throw error;
      }

      request.cleanup();

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          retryCount++;
          if (retryCount > maxRetries) {
            throw new Error(`OpenAlex API error: ${response.status}`);
          }
          await this._sleep(2000);
          continue;
        }
        throw new Error(`OpenAlex API error: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      if (results.length === 0) break;

      for (const work of results) {
        papers.push(this._normalizeWork(work));
      }

      retryCount = 0;

      cursor = data.meta?.next_cursor;
      if (!cursor) break;

      await this._sleep(100);

      if (results.length < 100) break;
    }

    return await this._enrichWorks(papers.slice(0, limit), signal);
  }

  async _enrichWorks(papers, signal) {
    const enriched = [];

    for (const paper of papers) {
      if (!shouldEnrichOpenAlexPaper(paper)) {
        enriched.push(paper);
        continue;
      }

      const detailPaper = await this._fetchWorkDetail(paper.id, signal);
      enriched.push(mergeOpenAlexPaper(paper, detailPaper));
      await this._sleep(this.apiKey ? 50 : 100);
    }

    return enriched;
  }

  async _fetchWorkDetail(workId, signal) {
    if (!workId) return null;

    const headers = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const url = new URL(workId);
    if (!this.apiKey) {
      url.searchParams.set('mailto', 'lit-search@example.com');
    }

    const request = createRequestSignal(signal, 15000);

    try {
      const response = await fetch(url, { headers, signal: request.signal });
      if (!response.ok) {
        return null;
      }

      const work = await response.json();
      return this._normalizeWork(work);
    } catch (error) {
      if (isAbortError(error) || request.signal.aborted) {
        return null;
      }
      return null;
    } finally {
      request.cleanup();
    }
  }

  _normalizeWork(work) {
    const year = work.publication_year ||
      (work.publication_date ? parseInt(work.publication_date.slice(0, 4)) : null);

    const authors = (work.authorships || [])
      .map(a => a.author?.display_name)
      .filter(Boolean);

    const venue = work.primary_location?.source?.display_name ||
      work.primary_location?.source?.host_organization_name || '';

    const doi = work.doi ? work.doi.replace('https://doi.org/', '') : null;

    const pdfCandidates = collectOpenAlexPdfCandidates(work);

    const landingPageUrl = work.primary_location?.landing_page_url ||
      work.best_oa_location?.landing_page_url ||
      work.id || null;

    let abstract = null;
    if (work.abstract_inverted_index) {
      abstract = this._reconstructAbstract(work.abstract_inverted_index);
    }

    const openAlexKeywords = (work.keywords || [])
      .map(keyword => keyword.display_name || keyword.keyword || keyword.name || '')
      .filter(Boolean);

    const topics = (work.topics || [])
      .map(topic => topic.display_name || topic.name || '')
      .filter(Boolean);

    return {
      id: work.id || null,
      title: work.title || '',
      authors,
      year,
      venue,
      journal: venue || null,
      doi,
      abstract,
      tldr: null,
      citationCount: work.cited_by_count || 0,
      pdfCandidates,
      url: landingPageUrl,
      volume: work.biblio?.volume || null,
      issue: work.biblio?.issue || null,
      firstPage: work.biblio?.first_page || null,
      lastPage: work.biblio?.last_page || null,
      pages: formatPages(work.biblio?.first_page, work.biblio?.last_page),
      keywords: openAlexKeywords,
      topics,
      language: work.language || null,
      workType: work.type || null,
      identifiers: {
        openalex: work.id || null,
        doi
      },
      source: 'openalex'
    };
  }

  _reconstructAbstract(invertedIndex) {
    if (!invertedIndex) return null;
    const wordPositions = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
      for (const pos of positions) {
        wordPositions.push({ word, position: pos });
      }
    }
    wordPositions.sort((a, b) => a.position - b.position);
    return wordPositions.map(w => w.word).join(' ');
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

function formatPages(firstPage, lastPage) {
  if (firstPage && lastPage) return `${firstPage}-${lastPage}`;
  return firstPage || lastPage || null;
}

function collectOpenAlexPdfCandidates(work) {
  const candidates = [];
  const addLocation = (location, role) => {
    if (!location) return;
    const pdfUrl = location.pdf_url || null;
    if (pdfUrl) {
      candidates.push({
        source: 'openalex',
        provider: location.source?.display_name || location.source?.host_organization_name || 'openalex',
        url: pdfUrl,
        sourceType: location.source?.type || null,
        sourceName: location.source?.display_name || location.source?.host_organization_name || null,
        access_type: inferOpenAlexAccessType(location, role),
        license: location.license || null,
        is_oa: location.is_oa === true,
        confidence: scoreOpenAlexPdfCandidate({
          url: pdfUrl,
          role,
          sourceType: location.source?.type || null,
          sourceName: location.source?.display_name || location.source?.host_organization_name || null,
          isOa: location.is_oa === true
        }) / 100,
        reason: `OpenAlex ${role} provided a pdf_url${location.source?.display_name ? ` from ${location.source.display_name}` : ''}.`,
        resolver: `openalex.${role}.pdf_url`
      });
    }
  };

  addLocation(work.best_oa_location, 'best_oa_location');
  addLocation(work.primary_location, 'primary_location');
  for (const location of work.locations || []) {
    addLocation(location, 'locations');
  }

  if (work.open_access?.oa_url) {
    candidates.push({
      source: 'openalex',
      provider: 'openalex',
      url: work.open_access.oa_url,
      access_type: 'openalex_content_api',
      license: work.open_access.oa_status || null,
      is_oa: true,
      confidence: 0.68,
      reason: 'OpenAlex open_access.oa_url was provided for this work.',
      resolver: 'openalex.open_access.oa_url'
    });
  }

  if (work.doi) {
    candidates.push({
      source: 'openalex',
      provider: 'doi.org',
      url: work.doi,
      access_type: 'doi_landing_page',
      license: null,
      is_oa: false,
      confidence: 0.22,
      reason: 'DOI landing page is available as a manual fallback.',
      resolver: 'doi.landing'
    });
  }

  const seen = new Set();
  return candidates.filter(candidate => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

function inferOpenAlexAccessType(location, role) {
  const host = safeHostname(location?.pdf_url || location?.landing_page_url || '');
  const sourceType = String(location?.source?.type || '').toLowerCase();
  const sourceName = String(location?.source?.display_name || location?.source?.host_organization_name || '').toLowerCase();

  if (/arxiv\.org$/.test(host)) return 'arxiv';
  if (/(ncbi\.nlm\.nih\.gov|pmc|pubmedcentral)/i.test(host)) return 'pmc';
  if (/core\.ac\.uk$/i.test(host)) return 'core';
  if (sourceType === 'repository') {
    return /(university|institution|repository|archive|scholarworks|eprints|dspace|ir\.)/i.test(`${host} ${sourceName}`)
      ? 'institutional_repository'
      : 'repository';
  }
  if (role === 'open_access.oa_url') return 'openalex_content_api';
  if (location?.is_oa === true) return 'publisher_oa_pdf';
  return 'unknown';
}

function scoreOpenAlexPdfCandidate(candidate) {
  let score = 0;
  const host = safeHostname(candidate.url);
  const sourceType = String(candidate.sourceType || '').toLowerCase();
  const sourceName = String(candidate.sourceName || '').toLowerCase();

  if (candidate.isOa) score += 10;
  if (candidate.role === 'best_oa_location') score += 8;
  if (sourceType === 'repository') score += 30;
  if (sourceType === 'journal') score -= 10;

  if (/(arxiv|pubmedcentral|ncbi|pmc|core\.ac\.uk|zenodo|figshare|osf|hal\.science|biorxiv|medrxiv|ssrn)/i.test(host)) {
    score += 25;
  }
  if (/(repository|archive|institutional|university|preprint|pubmed central|arxiv|core)/i.test(sourceName)) {
    score += 15;
  }
  if (/(elsevier|sciencedirect|springer|wiley|tandfonline|ieee|acm|sagepub|oup|cambridge|nature)/i.test(host)) {
    score -= 20;
  }

  return score;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function shouldEnrichOpenAlexPaper(paper) {
  return !paper.abstract ||
    !paper.keywords?.length ||
    (!paper.volume && !paper.pages) ||
    !paper.journal;
}

function mergeOpenAlexPaper(basePaper, detailPaper) {
  if (!detailPaper) return basePaper;

  return {
    ...basePaper,
    ...detailPaper,
    authors: detailPaper.authors?.length ? detailPaper.authors : basePaper.authors,
    keywords: detailPaper.keywords?.length ? detailPaper.keywords : basePaper.keywords,
    topics: detailPaper.topics?.length ? detailPaper.topics : basePaper.topics,
    identifiers: {
      ...(basePaper.identifiers || {}),
      ...(detailPaper.identifiers || {})
    }
  };
}

export default OpenAlexAPI;
